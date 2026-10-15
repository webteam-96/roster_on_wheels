using ClosedXML.Excel;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;
using RotaryApi.Services.RotaryOrg;

namespace RotaryApi.Controllers;

/// <summary>
/// SuperAdmin manual sync between ROW DB and Rotary.org. Two flows:
///   1. Club Sync — compare clubs in a district side-by-side, add/edit/delete one-by-one.
///   2. Member Sync — compare members in a club side-by-side, add/edit/delete one-by-one.
/// All write actions are SuperAdmin-only and soft-delete by default.
/// </summary>
[ApiController]
[Authorize]
[Route("api/admin/rotary-org-manual-sync")]
public class RotaryOrgManualSyncController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IRotaryOrgApiClient _api;
    private readonly ILogger<RotaryOrgManualSyncController> _logger;
    private readonly IConfiguration _config;
    private readonly IClubService _clubService;
    private readonly IClubCacheRefreshService _cacheRefresh;

    public RotaryOrgManualSyncController(IConfiguration config, IRotaryOrgApiClient api, ILogger<RotaryOrgManualSyncController> logger, IClubService clubService, IClubCacheRefreshService cacheRefresh)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("DefaultConnection missing");
        _api = api;
        _logger = logger;
        _config = config;
        _clubService = clubService;
        _cacheRefresh = cacheRefresh;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // Free `mobile` from any SOFT-DELETED profile (other than excludeId) that still owns it, so a
    // reused number doesn't trip UNIQUE(PrimaryMobileNumber) on INSERT / re-activation. Moves that
    // deleted row's Primary -> Secondary (only when Secondary is empty) and nulls its Primary.
    // ACTIVE rows are never touched — a live duplicate still fails, as it should.
    private static async Task ReleaseSoftDeletedMobileAsync(MySqlConnection conn, string? mobile, int excludeId = 0)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return;
        await conn.ExecuteAsync(@"
            UPDATE member_master_profile
            SET SecondaryMobileNumber = CASE WHEN SecondaryMobileNumber IS NULL OR SecondaryMobileNumber = ''
                                             THEN PrimaryMobileNumber ELSE SecondaryMobileNumber END,
                PrimaryMobileNumber = NULL,
                modified_date = NOW()
            WHERE TRIM(PrimaryMobileNumber) = TRIM(@Mobile)
              AND isdeleted = 1
              AND pk_member_master_profile_id <> @ExcludeId",
            new { Mobile = mobile.Trim(), ExcludeId = excludeId });
    }
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int GetUserId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    // Any short weekday form ("Thu", "Thurs", "Thursday", any casing) → "Thursday".
    // Returns null for null/blank so callers don't overwrite the DB value with "".
    private static string? NormalizeMeetingDay(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var trimmed = raw.Trim();
        return trimmed.ToLowerInvariant() switch
        {
            "mon" or "monday" => "Monday",
            "tue" or "tues" or "tuesday" => "Tuesday",
            "wed" or "weds" or "wednesday" => "Wednesday",
            "thu" or "thur" or "thurs" or "thursday" => "Thursday",
            "fri" or "friday" => "Friday",
            "sat" or "saturday" => "Saturday",
            "sun" or "sunday" => "Sunday",
            _ => trimmed,
        };
    }

    // ════════════════════════════════════════════════════════════════════════
    // CLUB SYNC
    // ════════════════════════════════════════════════════════════════════════

    [HttpGet("clubs/compare")]
    public async Task<ActionResult> CompareClubs([FromQuery] int districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (districtId <= 0) return BadRequest(new { message = "districtId required" });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Fetch the district number to filter Rotary.org search results
        var districtNumber = await conn.ExecuteScalarAsync<string?>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id AND isdeleted = 0",
            new { Id = districtId });
        if (string.IsNullOrEmpty(districtNumber))
            return NotFound(new { message = "District not found" });

        // ROW side — clubs in DB for this district
        var indiaClubs = (await conn.QueryAsync<dynamic>(@"
            SELECT cm.pk_club_id AS clubId, cm.ClubRotaryId AS clubRotaryId, cm.ClubName AS clubName,
                   cm.MeetingAddress AS meetingAddress, cm.MeetingDay AS meetingDay,
                   IFNULL(cm.MeetingFromTime, '') AS meetingTime, cm.City AS city, cm.State AS state,
                   cm.ClubCharterDate AS charterDate, cm.IsSyncedFromRotaryOrg AS isSynced,
                   (SELECT COUNT(DISTINCT clm.fk_member_master_profile_id)
                    FROM club_members clm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = clm.fk_member_master_profile_id
                    WHERE clm.fk_club_id = cm.pk_club_id AND clm.IsActive = 1 AND clm.isdeleted = 0 AND m.isdeleted = 0
                   ) AS memberCount
            FROM club_master cm
            WHERE cm.fk_district_id = @D AND cm.isdeleted = 0
            ORDER BY cm.ClubName",
            new { D = districtId })).ToList();

        // Rotary.org side — read from cache table (populated by /clubs/refresh-cache endpoint).
        // Cache filtered by DistrictNumber (string match — Rotary.org returns it as a string).
        var orgRows = (await conn.QueryAsync<dynamic>(@"
            SELECT RotaryClubId AS rotaryClubId, ClubName AS clubName, ClubType AS clubType,
                   CharterDate AS charterDate, NumberOfActiveMembers AS memberCount,
                   AddressLine1 AS meetingAddress, City AS city, State AS state,
                   Latitude AS latitude, Longitude AS longitude, Website AS website, Email AS email,
                   LastFetchedUtc AS lastFetchedUtc
            FROM rotary_org_clubs_cache
            WHERE DistrictNumber = @D
            ORDER BY ClubName",
            new { D = districtNumber })).ToList();

        var orgClubs = orgRows.Select(r => new
        {
            rotaryClubId = (int)r.rotaryClubId,
            clubName = (string?)r.clubName ?? "",
            clubType = (string?)r.clubType ?? "Rotary Club",
            charterDate = r.charterDate,
            memberCount = r.memberCount ?? 0,
            meetingAddress = (string?)r.meetingAddress ?? "",
            city = (string?)r.city ?? "",
            state = (string?)r.state ?? "",
            latitude = r.latitude,
            longitude = r.longitude,
            website = (string?)r.website,
            email = (string?)r.email,
        }).ToList();

        // Pull cache freshness for the UI to display
        // Mark as UTC so JSON serializes with a 'Z' suffix — otherwise the browser reads the UTC
        // value as local time and shows the wrong clock. (The cache stores DateTime.UtcNow.)
        var lastFetched = orgRows.Count > 0
            ? (DateTime?)DateTime.SpecifyKind((DateTime)orgRows[0].lastFetchedUtc, DateTimeKind.Utc)
            : null;

        // Build matched/onlyIndia/onlyOrg sets via ClubRotaryId
        var indiaByRotaryId = indiaClubs
            .Where(c => !string.IsNullOrWhiteSpace((string?)c.clubRotaryId))
            .ToDictionary(c => ((string)c.clubRotaryId).Trim(), c => c, StringComparer.OrdinalIgnoreCase);
        var orgByClubId = orgClubs.ToDictionary(c => c.rotaryClubId.ToString(), c => c, StringComparer.OrdinalIgnoreCase);

        var matched = indiaByRotaryId.Keys.Intersect(orgByClubId.Keys, StringComparer.OrdinalIgnoreCase).Count();
        var onlyIndia = indiaClubs.Count(c => string.IsNullOrWhiteSpace((string?)c.clubRotaryId)
            || !orgByClubId.ContainsKey(((string)c.clubRotaryId).Trim()));
        var onlyOrg = orgClubs.Count(c => !indiaByRotaryId.ContainsKey(c.rotaryClubId.ToString()));

        return Ok(new
        {
            districtNumber,
            indiaClubs,
            orgClubs,
            lastFetchedUtc = lastFetched,
            // Next automatic refresh = the daily 08:00 India-time run.
            nextRefreshUtc = ClubCacheRefreshService.GetNextScheduledRunUtc(),
            counts = new
            {
                local = indiaClubs.Count,
                rotaryOrg = orgClubs.Count,
                matched,
                onlyIndia,
                onlyOrg,
            }
        });
    }

    // Manual "Refresh from Rotary.org" (one-off corrections). Same guarded refresh the auto scheduler
    // uses — a 0-club response leaves the cache untouched. Writing LastFetchedUtc here also resets the
    // 5-hour auto-refresh clock (the scheduler measures the next run from MAX LastFetchedUtc).
    [HttpPost("clubs/refresh-cache")]
    public async Task<ActionResult> RefreshClubsCache()
    {
        if (!IsSuperAdmin()) return Forbid();
        try
        {
            var (upserted, _, skippedEmpty) = await _cacheRefresh.RefreshAsync();
            if (skippedEmpty)
                return Ok(new { message = "Rotary.org returned no clubs — cache left unchanged (nothing deleted). Please try again shortly.", lastFetchedUtc = (DateTime?)null });

            var nowUtc = DateTime.UtcNow;
            return Ok(new
            {
                message = $"Cache refreshed: {upserted} clubs from /clubs",
                lastFetchedUtc = nowUtc,
                // Auto-refresh is a fixed daily 08:00 run (brand time zone) — independent of this manual refresh.
                nextRefreshUtc = ClubCacheRefreshService.GetNextScheduledRunUtc(),
            });
        }
        catch (Exception ex)
        {
            return StatusCode(502, new { message = $"Rotary.org API error: {ex.Message}" });
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // SYNC OVERVIEW — landing-card counts + downloadable report
    // ════════════════════════════════════════════════════════════════════════

    // The 3 permanently-exempt districts (never treated as sync/non-sync in these overview
    // numbers). Must match NonSyncLoginGuardHelper.ExemptDistrictNumbers /
    // ClubNonSyncCascadeWorker.ExemptDistrictNumbers.
    private static string[] ExemptDistrictNumbers => RotaryApi.Services.Brand.ExemptDistricts;   // ROW: Brand:Scope:ExemptDistricts

    // Placeholder catch-all zone (seeded alongside Zone 4/5/6/7) — clubs not in a real zone land
    // here; excluded from the sync overview. No-zone districts (fk_zone_id 0/NULL → blank zone) are
    // left in, since they're not this named zone.
    private const string PlaceholderZoneName = "Zone 0";

    // Landing-page counts: total sync clubs, non-sync clubs, and distinct active members.
    // Drives the Club Sync + Member Sync cards on /settings/rotary-org. The 3 exempt
    // districts are excluded from every number.
    [HttpGet("summary")]
    public async Task<ActionResult> GetSyncSummary()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var syncClubs = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE c.IsSyncedFromRotaryOrg = 1 AND c.isdeleted = 0
              AND d.DistrictNumber NOT IN @Exempt
              AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0)",
            new { Exempt = ExemptDistrictNumbers, Zone0 = PlaceholderZoneName });
        var nonSyncClubs = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE (c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL) AND c.isdeleted = 0
              AND d.DistrictNumber NOT IN @Exempt
              AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0)",
            new { Exempt = ExemptDistrictNumbers, Zone0 = PlaceholderZoneName });
        var totalMembers = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.DistrictNumber NOT IN @Exempt
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
            WHERE cm.IsActive = 1 AND cm.isdeleted = 0
              AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0)",
            new { Exempt = ExemptDistrictNumbers, Zone0 = PlaceholderZoneName });

        // Per-country-group sync / non-sync club counts. India / Nepal / Sri Lanka get their own row;
        // everything else is "Other Zones". Same exclusions apply everywhere (3 exempt districts + Zone 0).
        var breakdownRows = (await conn.QueryAsync<dynamic>(@"
            SELECT
              CASE
                WHEN LOWER(TRIM(c.Country)) = 'india' THEN 'India'
                WHEN LOWER(TRIM(c.Country)) = 'nepal' THEN 'Nepal'
                WHEN LOWER(TRIM(c.Country)) = 'sri lanka' THEN 'Sri Lanka'
                ELSE 'Other'
              END AS CountryGroup,
              CAST(SUM(c.IsSyncedFromRotaryOrg = 1) AS SIGNED) AS SyncClubs,
              CAST(SUM(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL) AS SIGNED) AS NonSyncClubs
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE c.isdeleted = 0
              AND d.DistrictNumber NOT IN @Exempt
              AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0)
            GROUP BY CountryGroup",
            new { Exempt = ExemptDistrictNumbers, Zone0 = PlaceholderZoneName })).ToList();

        var order = new[] { "India", "Nepal", "Sri Lanka", "Other" };
        var countryBreakdown = order.Select(name =>
        {
            var r = breakdownRows.FirstOrDefault(x => string.Equals((string)x.CountryGroup, name, StringComparison.OrdinalIgnoreCase));
            return new
            {
                country = name == "Other" ? "Other Zones" : name,
                syncClubs = r == null ? 0 : Convert.ToInt32(r.SyncClubs),
                nonSyncClubs = r == null ? 0 : Convert.ToInt32(r.NonSyncClubs),
            };
        }).ToList();

        return Ok(new { syncClubs, nonSyncClubs, totalMembers, countryBreakdown });
    }

    private class SyncSummaryRow
    {
        public string? ZoneName { get; set; }
        public string? DistrictNumber { get; set; }
        public int SyncClubs { get; set; }
        public int NonSyncClubs { get; set; }
        public int MemberCount { get; set; }
    }
    private class SyncClubRow
    {
        public string? ZoneName { get; set; }
        public string? DistrictNumber { get; set; }
        public string? ClubName { get; set; }
        public string? ClubRotaryId { get; set; }
        public string? City { get; set; }
        public string? State { get; set; }
        public int MemberCount { get; set; }
    }

    // Excel report: Sheet1 per-district summary (Zone, District, sync/non-sync club counts, members),
    // Sheet2 the sync clubs list, Sheet3 the non-sync clubs list.
    // District dropdown for the Club Sync report download — only districts that have clubs,
    // same exclusions as the report (3 exempt districts + Zone 0).
    [HttpGet("clubs/sync-districts")]
    public async Task<ActionResult> GetClubSyncDistricts()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rows = await conn.QueryAsync(@"
            SELECT d.pk_district_id AS id, d.DistrictNumber AS districtNumber, z.ZoneName AS zoneName
            FROM district_master d
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            JOIN club_master c ON c.fk_district_id = d.pk_district_id AND c.isdeleted = 0
            WHERE d.isdeleted = 0
              AND d.DistrictNumber NOT IN @Exempt
              AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0)
            GROUP BY d.pk_district_id, d.DistrictNumber, z.ZoneName
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber",
            new { Exempt = ExemptDistrictNumbers, Zone0 = PlaceholderZoneName });
        return Ok(rows);
    }

    [HttpGet("clubs/sync-report")]
    public async Task<ActionResult> GetClubSyncReport([FromQuery] int? districtId = null)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Optional district scope: null = all districts (the default), else just that one.
        var dParams = new { Exempt = ExemptDistrictNumbers, Zone0 = PlaceholderZoneName, DistrictId = districtId };

        var summary = (await conn.QueryAsync<SyncSummaryRow>(@"
            SELECT z.ZoneName AS ZoneName, d.DistrictNumber AS DistrictNumber,
                   CAST(SUM(c.IsSyncedFromRotaryOrg = 1) AS SIGNED) AS SyncClubs,
                   CAST(SUM(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL) AS SIGNED) AS NonSyncClubs,
                   (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                    FROM club_members cm
                    JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                    WHERE c2.fk_district_id = d.pk_district_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS MemberCount
            FROM district_master d
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            LEFT JOIN club_master c ON c.fk_district_id = d.pk_district_id AND c.isdeleted = 0
            WHERE d.isdeleted = 0
              AND d.DistrictNumber NOT IN @Exempt
              AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0)
              AND (@DistrictId IS NULL OR d.pk_district_id = @DistrictId)
            GROUP BY d.pk_district_id, z.ZoneName, d.DistrictNumber
            HAVING (SyncClubs + NonSyncClubs) > 0
            ORDER BY CAST(d.DistrictNumber AS UNSIGNED), d.DistrictNumber",
            dParams)).ToList();

        const string clubListSql = @"
            SELECT z.ZoneName AS ZoneName, d.DistrictNumber AS DistrictNumber, c.ClubName AS ClubName,
                   c.ClubRotaryId AS ClubRotaryId, c.City AS City, c.State AS State,
                   (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                    FROM club_members cm
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                    WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0) AS MemberCount
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE c.isdeleted = 0 AND d.DistrictNumber NOT IN @Exempt
              AND (z.ZoneName IS NULL OR z.ZoneName <> @Zone0)
              AND (@DistrictId IS NULL OR d.pk_district_id = @DistrictId) AND {0}
            ORDER BY c.ClubName";

        var syncList = (await conn.QueryAsync<SyncClubRow>(
            string.Format(clubListSql, "c.IsSyncedFromRotaryOrg = 1"), dParams)).ToList();
        var nonSyncList = (await conn.QueryAsync<SyncClubRow>(
            string.Format(clubListSql, "(c.IsSyncedFromRotaryOrg = 0 OR c.IsSyncedFromRotaryOrg IS NULL)"), dParams)).ToList();

        using var wb = new XLWorkbook();

        // Shared "report" formatting: coloured/bold header, thin borders on every cell, zebra banding,
        // right-aligned number columns, frozen header + auto-filter. totalRow (1-based) is styled as a
        // bold highlighted footer when provided.
        static void StyleSheet(IXLWorksheet ws, int colCount, int lastDataRow, int[] numberCols, int? totalRow)
        {
            int lastRow = totalRow ?? lastDataRow;

            // Header band.
            var header = ws.Range(1, 1, 1, colCount);
            header.Style.Fill.BackgroundColor = XLColor.FromHtml("#1F4E79");
            header.Style.Font.FontColor = XLColor.White;
            header.Style.Font.Bold = true;
            header.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            header.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
            ws.Row(1).Height = 22;

            // Borders + vertical centering across the whole used block.
            var all = ws.Range(1, 1, lastRow, colCount);
            all.Style.Border.OutsideBorder = XLBorderStyleValues.Thin;
            all.Style.Border.InsideBorder = XLBorderStyleValues.Thin;
            all.Style.Border.OutsideBorderColor = XLColor.FromHtml("#8EAADB");
            all.Style.Border.InsideBorderColor = XLColor.FromHtml("#D9E1F2");
            all.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;

            // Zebra banding on even data rows.
            for (int rr = 2; rr <= lastDataRow; rr++)
                if (rr % 2 == 0)
                    ws.Range(rr, 1, rr, colCount).Style.Fill.BackgroundColor = XLColor.FromHtml("#EAF1FB");

            // Right-align numeric columns (data rows only).
            if (lastDataRow >= 2)
                foreach (var nc in numberCols)
                    ws.Range(2, nc, lastDataRow, nc).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;

            // Bold, highlighted totals footer.
            if (totalRow.HasValue)
            {
                var tr = ws.Range(totalRow.Value, 1, totalRow.Value, colCount);
                tr.Style.Font.Bold = true;
                tr.Style.Fill.BackgroundColor = XLColor.FromHtml("#CFE0F4");
                tr.Style.Border.TopBorder = XLBorderStyleValues.Medium;
                tr.Style.Border.TopBorderColor = XLColor.FromHtml("#1F4E79");
            }

            ws.SheetView.FreezeRows(1);
            ws.Range(1, 1, lastDataRow < 1 ? 1 : lastDataRow, colCount).SetAutoFilter();
            ws.Columns().AdjustToContents();
        }

        // Sheet 1 — per-district summary (District first, then Zone) + totals row.
        var ws1 = wb.Worksheets.Add("Summary");
        string[] sumHeaders = { "District Number", "Zone Name", "Sync Club Count", "Non-Sync Club Count", "Member Count" };
        for (int i = 0; i < sumHeaders.Length; i++) ws1.Cell(1, i + 1).Value = sumHeaders[i];
        int row = 2;
        foreach (var s in summary)
        {
            ws1.Cell(row, 1).Value = s.DistrictNumber ?? "";
            ws1.Cell(row, 2).Value = s.ZoneName ?? "";
            ws1.Cell(row, 3).Value = s.SyncClubs;
            ws1.Cell(row, 4).Value = s.NonSyncClubs;
            ws1.Cell(row, 5).Value = s.MemberCount;
            row++;
        }
        int totalRowIdx = row;
        ws1.Cell(totalRowIdx, 1).Value = "TOTAL";
        ws1.Cell(totalRowIdx, 3).Value = summary.Sum(x => x.SyncClubs);
        ws1.Cell(totalRowIdx, 4).Value = summary.Sum(x => x.NonSyncClubs);
        ws1.Cell(totalRowIdx, 5).Value = summary.Sum(x => x.MemberCount);
        StyleSheet(ws1, 5, totalRowIdx - 1, new[] { 3, 4, 5 }, totalRowIdx);

        // Sheets 2 & 3 — club lists (District first, then Zone), sorted by club name.
        void AddClubSheet(string name, System.Collections.Generic.List<SyncClubRow> rows)
        {
            var ws = wb.Worksheets.Add(name);
            string[] headers = { "District Number", "Zone Name", "Club Name", "Club Rotary ID", "City", "State", "Member Count" };
            for (int i = 0; i < headers.Length; i++) ws.Cell(1, i + 1).Value = headers[i];
            int rr = 2;
            foreach (var c in rows)
            {
                ws.Cell(rr, 1).Value = c.DistrictNumber ?? "";
                ws.Cell(rr, 2).Value = c.ZoneName ?? "";
                ws.Cell(rr, 3).Value = c.ClubName ?? "";
                ws.Cell(rr, 4).Value = c.ClubRotaryId ?? "";
                ws.Cell(rr, 5).Value = c.City ?? "";
                ws.Cell(rr, 6).Value = c.State ?? "";
                ws.Cell(rr, 7).Value = c.MemberCount;
                rr++;
            }
            StyleSheet(ws, 7, rr - 1, new[] { 7 }, null);
        }
        AddClubSheet("Sync Clubs", syncList);
        AddClubSheet("Non-Sync Clubs", nonSyncList);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return File(ms.ToArray(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "RotaryOrg_ClubSync_Report.xlsx");
    }

    [HttpPost("clubs")]
    public async Task<ActionResult> AddClubFromOrg([FromBody] AddClubFromOrgRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.RotaryClubId <= 0 || req.DistrictId <= 0)
            return BadRequest(new { message = "rotaryClubId and districtId required" });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Validate district
        var districtNumber = await conn.ExecuteScalarAsync<string?>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id = @Id AND isdeleted = 0",
            new { Id = req.DistrictId });
        if (string.IsNullOrEmpty(districtNumber))
            return NotFound(new { message = "District not found" });

        // Refuse if already exists with same ClubRotaryId
        var existingId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_club_id FROM club_master WHERE ClubRotaryId = @Rid AND isdeleted = 0 LIMIT 1",
            new { Rid = req.RotaryClubId.ToString() });
        if (existingId.HasValue)
            return Conflict(new { message = "Club already exists in ROW", clubId = existingId.Value });

        // Fetch club detail from Rotary.org
        RotaryOrgClubDetailDto? detail;
        try { detail = await _api.GetClubDetailAsync("Rotary Club", req.RotaryClubId); }
        catch (Exception ex)
        {
            // A 400 "Records do not exist" means this club is no longer on Rotary.org (removed/terminated)
            // but is still a STALE row in rotary_org_clubs_cache. Give a clear message + hint to refresh.
            if (ex.Message.Contains("Records do not exist", StringComparison.OrdinalIgnoreCase)
                || ex.Message.Contains(": 400", StringComparison.OrdinalIgnoreCase))
                return NotFound(new { message = $"Club {req.RotaryClubId} is no longer on Rotary.org (likely terminated) — it's a stale cache entry. Click \"Refresh from Rotary.org\" to remove it from the list." });
            return StatusCode(502, new { message = $"Rotary.org API error: {ex.Message}" });
        }
        if (detail == null)
            return NotFound(new { message = $"Club {req.RotaryClubId} is no longer on Rotary.org — refresh the cache to remove it." });

        // ONLY "Meeting Location" per user 2026-07-10. No fallback — a club with no
        // Meeting Location address is inserted with a blank MeetingAddress/Day.
        var meetAddr = detail.Addresses?.FirstOrDefault(a => string.Equals(a.AddressType, "Meeting Location", StringComparison.OrdinalIgnoreCase));

        var clubName = detail.ClubName ?? "";
        // MeetingAddress = MeetingName + AddressLine1 + AddressLine2 + AddressLine3
        // (city/state/pin live in their own dedicated columns; keeping them out of
        // MeetingAddress avoids duplication in the display).
        var meetingAddress = meetAddr == null ? "" : string.Join(", ",
            new[] { meetAddr.MeetingName, meetAddr.AddressLine1, meetAddr.AddressLine2, meetAddr.AddressLine3 }
                .Where(s => !string.IsNullOrWhiteSpace(s)));
        var meetingDay = NormalizeMeetingDay(meetAddr?.MeetingDay);

        var newClubId = await conn.ExecuteScalarAsync<int>(@"
            INSERT INTO club_master
                (ClubRotaryId, ClubName, fk_district_id, MeetingAddress, MeetingDay,
                 City, State, ClubCharterDate, IsActive, IsSyncedFromRotaryOrg, created_date, isdeleted)
            VALUES
                (@Rid, @Name, @DistrictId, @Addr, @Day, @City, @State, @Charter, 1, 1, NOW(), 0);
            SELECT LAST_INSERT_ID();",
            new
            {
                Rid = req.RotaryClubId.ToString(),
                Name = clubName,
                DistrictId = req.DistrictId,
                Addr = meetingAddress,
                Day = meetingDay,
                City = meetAddr?.City,
                State = RotaryApi.Services.RotaryOrg.IndianStateResolver.NormalizeForCountry(meetAddr?.State, meetAddr?.Country),
                Charter = detail.CharterDate,
            });

        // Assign default club modules
        await conn.ExecuteAsync(@"
            INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy, AssignedDate)
            SELECT @C, pk_module_id, 1, @U, NOW()
            FROM module_master
            WHERE IsDefaultForClub = 1 AND ModuleLevel IN ('Club','Both') AND IsActive = 1 AND isdeleted = 0",
            new { C = newClubId, U = GetUserId() });

        // Auto-sync this club's members
        int membersAdded = 0, memberErrors = 0;
        try
        {
            var orgMembers = await _api.GetClubMembersAsync("Rotary Club", req.RotaryClubId);
            foreach (var m in orgMembers)
            {
                try
                {
                    var ok = await AddMemberFromOrgAsync(conn, newClubId, m);
                    if (ok) membersAdded++;
                }
                catch (Exception ex)
                {
                    memberErrors++;
                    _logger.LogWarning(ex, "Auto-sync member {Mid} for new club {Cid} failed", m.MemberId, newClubId);
                }
            }
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Auto-sync members failed for new club {Cid}", newClubId); }

        return Ok(new { clubId = newClubId, message = "Club added.", membersAdded, memberErrors });
    }

    [HttpPut("clubs/{clubId:int}")]
    public async Task<ActionResult> UpdateClubFromManualEdit(int clubId, [FromBody] UpdateClubManualRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var exists = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_club_id FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0",
            new { Id = clubId });
        if (exists == null) return NotFound(new { message = "Club not found" });

        await conn.ExecuteAsync(@"
            UPDATE club_master
            SET ClubName = COALESCE(@Name, ClubName),
                MeetingAddress = COALESCE(@Addr, MeetingAddress),
                MeetingDay = COALESCE(@Day, MeetingDay),
                City = COALESCE(@City, City),
                State = COALESCE(@State, State),
                ClubCharterDate = COALESCE(@Charter, ClubCharterDate),
                modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_id = @Id",
            new
            {
                Id = clubId,
                Name = req.ClubName,
                Addr = req.MeetingAddress,
                Day = req.MeetingDay,
                City = req.City,
                State = req.State,
                Charter = req.CharterDate,
                UserId = GetUserId(),
            });

        return Ok(new { message = "Club updated." });
    }

    [HttpDelete("clubs/{clubId:int}")]
    public async Task<ActionResult> DeleteClub(int clubId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var userId = GetUserId();
        using var tx = await conn.BeginTransactionAsync();
        try
        {
            // Soft-delete club + cascade
            await conn.ExecuteAsync(@"
                UPDATE club_master SET isdeleted = 1, deleted_by = @U, deleted_date = NOW()
                WHERE pk_club_id = @Id", new { Id = clubId, U = userId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE club_members SET isdeleted = 1, deleted_by = @U, deleted_date = NOW()
                WHERE fk_club_id = @Id AND isdeleted = 0", new { Id = clubId, U = userId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE member_roles SET isdeleted = 1, IsActive = 0, RevokedDate = NOW(), modified_date = NOW()
                WHERE fk_club_id = @Id AND isdeleted = 0", new { Id = clubId }, tx);

            await conn.ExecuteAsync(@"
                UPDATE board_of_directors SET isdeleted = 1, deleted_by = @U, deleted_date = NOW()
                WHERE fk_club_id = @Id AND isdeleted = 0", new { Id = clubId, U = userId }, tx);

            // Mirror into the DC auto-groups: this club's Club Presidents / Club Secretaries rows (every
            // year) go too. Manual DC groups are untouched.
            await conn.ExecuteAsync(@"
                UPDATE district_committee_group_member m
                JOIN district_committee_group g ON g.id = m.fk_group_id
                SET m.isdeleted = 1, m.modified_date = NOW()
                WHERE m.fk_club_id = @Id AND m.isdeleted = 0 AND g.isdeleted = 0
                  AND (g.group_name = 'Club Presidents' OR g.group_name LIKE 'Club Presidents ____-__'
                    OR g.group_name = 'Club Secretaries' OR g.group_name LIKE 'Club Secretaries ____-__')",
                new { Id = clubId }, tx);

            await conn.ExecuteAsync(@"
                DELETE FROM club_modules WHERE fk_club_id = @Id", new { Id = clubId }, tx);

            await tx.CommitAsync();
            return Ok(new { message = "Club deleted (soft)." });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            _logger.LogError(ex, "Failed to delete club {Cid}", clubId);
            return StatusCode(500, new { message = ex.Message });
        }
    }

    [HttpGet("clubs/org-detail/{rotaryClubId:int}")]
    public async Task<ActionResult> GetClubOrgDetail(int rotaryClubId)
    {
        if (!IsSuperAdmin()) return Forbid();
        try
        {
            var detail = await _api.GetClubDetailAsync("Rotary Club", rotaryClubId);
            if (detail == null) return NotFound(new { message = "Not found on Rotary.org" });
            return Ok(detail);
        }
        catch (Exception ex) { return StatusCode(502, new { message = ex.Message }); }
    }

    [HttpGet("clubs/india-detail/{clubId:int}")]
    public async Task<ActionResult> GetClubIndiaDetail(int clubId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_club_id AS clubId, ClubRotaryId AS clubRotaryId, ClubName AS clubName,
                   MeetingAddress AS meetingAddress, MeetingDay AS meetingDay,
                   IFNULL(MeetingFromTime, '') AS meetingTime, City AS city, State AS state,
                   ClubCharterDate AS charterDate, IsActive AS isActive,
                   IsSyncedFromRotaryOrg AS isSynced, created_date AS createdDate
            FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0",
            new { Id = clubId });
        return club == null ? NotFound() : Ok(club);
    }

    // Helper used by both AddClubFromOrg (auto-sync members) and AddMemberFromOrg.
    private async Task<bool> AddMemberFromOrgAsync(MySqlConnection conn, int clubId, RotaryOrgClubMemberDto api)
    {
        var rid = api.MemberId.ToString();
        // Skip if already in club
        var alreadyInClub = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @C AND m.RotaryId = @R AND cm.isdeleted = 0 AND m.isdeleted = 0",
            new { C = clubId, R = rid });
        if (alreadyInClub > 0) return false;

        // Try fetch full profile for richer fields
        RotaryOrgIndividualProfileResponse? profile = null;
        try { profile = await _api.GetIndividualProfileAsync(api.MemberId); } catch { }

        var ind = profile?.Individual;
        var name = !string.IsNullOrWhiteSpace(ind?.LocalizedName) ? ind!.LocalizedName!.Trim() :
                   string.Join(" ", new[] { api.Prefix, api.FirstName, api.MiddleName, api.LastName, api.Suffix }
                       .Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!.Trim()));

        var email = profile?.Email?.FirstOrDefault(e => e.IsPrimary == true)?.EmailAddress
                 ?? profile?.Email?.FirstOrDefault()?.EmailAddress;
        var phone = profile?.Phone?.FirstOrDefault(p => p.IsPrimary == true)?.PhoneNumber
                 ?? profile?.Phone?.FirstOrDefault(p => string.Equals(p.PhoneType, "Mobile", StringComparison.OrdinalIgnoreCase))?.PhoneNumber
                 ?? profile?.Phone?.FirstOrDefault()?.PhoneNumber;

        DateTime? dob = null;
        // Rotary.org always sends DOB as US "MM/dd/yyyy" — parse with a FIXED format + InvariantCulture,
        // NEVER DateTime.TryParse(current culture), which swaps day/month (08/01→Jan 8) or drops the year to 1900.
        if (!string.IsNullOrWhiteSpace(ind?.DateOfBirth) &&
            (DateTime.TryParseExact(ind!.DateOfBirth.Trim(), "MM/dd/yyyy", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d)
             || DateTime.TryParse(ind!.DateOfBirth, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out d)))
            dob = d;

        var gender = !string.IsNullOrWhiteSpace(ind?.Gender) ? ind!.Gender : ind?.GenderDescription;
        var lang = ind?.PrimaryLanguage;
        int isYouth = 0;
        if (ind?.YouthFlag == true) isYouth = 1;
        else if (dob.HasValue)
        {
            var age = DateTime.Today.Year - dob.Value.Year;
            if (dob.Value.Date > DateTime.Today.AddYears(-age)) age--;
            isYouth = (age >= 18 && age <= 40) ? 1 : 0;
        }

        // Find existing soft-deleted member (re-activation) by RotaryId/email/phone
        var existingId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT pk_member_master_profile_id FROM member_master_profile
            WHERE isdeleted = 1 AND (RotaryId = @Rid
                OR (@Email IS NOT NULL AND @Email <> '' AND EmailId = @Email)
                OR (@Phone IS NOT NULL AND @Phone <> '' AND PrimaryMobileNumber = @Phone))
            ORDER BY pk_member_master_profile_id DESC LIMIT 1",
            new { Rid = rid, Email = email ?? "", Phone = phone ?? "" });

        int memberId;
        if (existingId.HasValue && existingId.Value > 0)
        {
            memberId = existingId.Value;
            // Free the number from any OTHER soft-deleted row so the COALESCE fill doesn't hit the unique key.
            await ReleaseSoftDeletedMobileAsync(conn, phone, excludeId: memberId);
            await conn.ExecuteAsync(@"
                UPDATE member_master_profile SET
                    isdeleted = 0, deleted_by = NULL, deleted_date = NULL,
                    RotaryId = @Rid, MemberName = @Name,
                    EmailId = COALESCE(@Email, EmailId),
                    PrimaryMobileNumber = COALESCE(@Phone, PrimaryMobileNumber),
                    BirthDate = COALESCE(@Dob, BirthDate),
                    Gender = COALESCE(@Gender, Gender),
                    PrimaryLanguage = COALESCE(@Lang, PrimaryLanguage),
                    IsYouth = @IsYouth, modified_date = NOW()
                WHERE pk_member_master_profile_id = @Id",
                new { Id = memberId, Rid = rid, Name = name, Email = email, Phone = phone, Dob = dob, Gender = gender, Lang = lang, IsYouth = isYouth });
        }
        else
        {
            // Free the number from any soft-deleted row so the INSERT doesn't hit the unique key.
            await ReleaseSoftDeletedMobileAsync(conn, phone, excludeId: 0);
            memberId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO member_master_profile
                    (MemberName, RotaryId, EmailId, PrimaryMobileNumber, BirthDate, Gender, PrimaryLanguage, IsYouth, IsPersonalDetailsVisible, created_date, isdeleted)
                VALUES (@Name, @Rid, @Email, @Phone, @Dob, @Gender, @Lang, @IsYouth, 1, NOW(), 0);
                SELECT LAST_INSERT_ID();",
                new
                {
                    Name = name,
                    Rid = rid,
                    Email = email,
                    Phone = phone,
                    Dob = dob,
                    Gender = gender,
                    Lang = lang,
                    IsYouth = isYouth,
                });
        }
        // Honorary status moved to club_members 2026-06-26 — applied per-club below
        // when we upsert this member's club_members row.
        var isHonForClub = string.Equals(api.MemberType, "Honorary Member", StringComparison.OrdinalIgnoreCase) ? 1 : 0;

        // club_members upsert
        var existingCm = await conn.QueryFirstOrDefaultAsync<(int pk_id, int isdeleted)>(@"
            SELECT pk_club_member_id AS pk_id, isdeleted
            FROM club_members
            WHERE fk_club_id = @C AND fk_member_master_profile_id = @M
            ORDER BY pk_club_member_id DESC LIMIT 1",
            new { C = clubId, M = memberId });

        var joined = api.AdmissionDate ?? DateTime.Today;
        if (existingCm.pk_id == 0)
        {
            await conn.ExecuteAsync(@"
                INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, IsHonoraryMember, created_date, isdeleted)
                VALUES (@C, @M, @J, 1, @IsHon, NOW(), 0)",
                new { C = clubId, M = memberId, J = joined, IsHon = isHonForClub });
        }
        else if (existingCm.isdeleted == 1)
        {
            await conn.ExecuteAsync(@"
                UPDATE club_members SET isdeleted = 0, IsActive = 1, JoinedDate = @J,
                    IsHonoraryMember = @IsHon,
                    TerminationDate = NULL, TerminationReason = NULL,
                    deleted_by = NULL, deleted_date = NULL, modified_date = NOW()
                WHERE pk_club_member_id = @Id",
                new { Id = existingCm.pk_id, J = joined, IsHon = isHonForClub });
        }
        else
        {
            // Active club_members row — refresh honorary status; backfill Joining Date
            // (AdmissionDate) when it's currently blank. COALESCE(JoinedDate, @J) keeps an
            // existing date (never overwrites with the DateTime.Today fallback).
            await conn.ExecuteAsync(@"
                UPDATE club_members SET IsHonoraryMember = @IsHon,
                    JoinedDate = COALESCE(JoinedDate, @J),
                    modified_date = NOW()
                WHERE pk_club_member_id = @Id",
                new { Id = existingCm.pk_id, IsHon = isHonForClub, J = joined });
        }

        // Default Member role
        await conn.ExecuteAsync(@"
            INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, AssignedBy, IsActive, isdeleted, AssignedDate)
            SELECT @M, 1, @M, 1, 0, NOW() FROM DUAL
            WHERE NOT EXISTS (
                SELECT 1 FROM member_roles
                WHERE fk_member_master_profile_id = @M AND fk_role_id = 1 AND IsActive = 1 AND isdeleted = 0)",
            new { M = memberId });

        return true;
    }

    // ════════════════════════════════════════════════════════════════════════
    // MEMBER SYNC
    // ════════════════════════════════════════════════════════════════════════

    [HttpGet("members/compare")]
    public async Task<ActionResult> CompareMembers([FromQuery] int clubId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (clubId <= 0) return BadRequest(new { message = "clubId required" });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var club = await conn.QueryFirstOrDefaultAsync<(string ClubRotaryId, string ClubName)>(
            "SELECT IFNULL(ClubRotaryId, '') AS ClubRotaryId, ClubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0",
            new { Id = clubId });
        if (string.IsNullOrEmpty(club.ClubName))
            return NotFound(new { message = "Club not found" });
        if (string.IsNullOrEmpty(club.ClubRotaryId) || !int.TryParse(club.ClubRotaryId, out var rotaryClubId))
            return BadRequest(new { message = "This club has no Rotary.org ID — cannot sync." });

        // Pull India side with both Residential and Business addresses.
        var indiaMembers = (await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.RotaryId AS rotaryId,
                   m.MemberName AS memberName, m.EmailId AS email,
                   m.PrimaryMobileNumber AS mobile, m.SecondaryMobileNumber AS secondaryMobile,
                   m.BirthDate AS birthDate, m.Gender AS gender, m.PrimaryLanguage AS language,
                   m.IsYouth AS isYouth,
                   cm.JoinedDate AS joinedDate,
                   resAddr.Address AS resAddress, resAddr.City AS resCity, resAddr.State AS resState, resAddr.PinCode AS resPinCode,
                   busAddr.Address AS busAddress, busAddr.City AS busCity, busAddr.State AS busState, busAddr.PinCode AS busPinCode
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            LEFT JOIN (
                SELECT fk_member_master_profile_id, MAX(pk_member_address_details_id) AS pk_id
                FROM member_address_details
                WHERE AddressType IN ('Residence','Residential') AND isdeleted = 0
                GROUP BY fk_member_master_profile_id
            ) latest_res ON latest_res.fk_member_master_profile_id = m.pk_member_master_profile_id
            LEFT JOIN member_address_details resAddr ON resAddr.pk_member_address_details_id = latest_res.pk_id
            LEFT JOIN (
                SELECT fk_member_master_profile_id, MAX(pk_member_address_details_id) AS pk_id
                FROM member_address_details
                WHERE AddressType = 'Business' AND isdeleted = 0
                GROUP BY fk_member_master_profile_id
            ) latest_bus ON latest_bus.fk_member_master_profile_id = m.pk_member_master_profile_id
            LEFT JOIN member_address_details busAddr ON busAddr.pk_member_address_details_id = latest_bus.pk_id
            WHERE cm.fk_club_id = @C AND cm.isdeleted = 0 AND m.isdeleted = 0
            ORDER BY m.MemberName",
            new { C = clubId })).ToList();

        // Read members from cache — full profile fields populated by POST members/refresh-cache
        var orgRows = (await conn.QueryAsync<dynamic>(@"
            SELECT RotaryMemberId AS rotaryMemberId,
                   IFNULL(LocalizedName,
                       TRIM(CONCAT_WS(' ', NULLIF(Prefix,''), NULLIF(FirstName,''), NULLIF(MiddleName,''), NULLIF(LastName,''), NULLIF(Suffix,''))))
                       AS memberName,
                   AdmissionDate AS admissionDate, TerminationDate AS terminationDate,
                   BirthYear AS birthYear, MemberType AS memberType,
                   Email AS email, Mobile AS mobile, DateOfBirth AS dateOfBirth,
                   Gender AS gender, PrimaryLanguage AS language,
                   AddressLine AS address, City AS city, State AS state,
                   Country AS country, PostalCode AS postalCode,
                   LastFetchedUtc AS lastFetchedUtc
            FROM rotary_org_club_members_cache
            WHERE fk_rotary_club_id = @C
            ORDER BY memberName",
            new { C = rotaryClubId })).ToList();

        var orgMembers = orgRows.Select(r => new
        {
            rotaryMemberId = (long)r.rotaryMemberId,
            memberName = (string?)r.memberName ?? "",
            admissionDate = r.admissionDate,
            terminationDate = r.terminationDate,
            birthYear = (string?)r.birthYear,
            memberType = (string?)r.memberType,
            email = (string?)r.email,
            mobile = (string?)r.mobile,
            dateOfBirth = (string?)r.dateOfBirth,
            gender = (string?)r.gender,
            language = (string?)r.language,
            address = (string?)r.address,
            city = (string?)r.city,
            state = (string?)r.state,
            country = (string?)r.country,
            postalCode = (string?)r.postalCode,
        }).ToList();
        // Mark as UTC so JSON serializes with a 'Z' suffix — otherwise the browser reads the UTC
        // value as local time and shows the wrong clock. (The cache stores DateTime.UtcNow.)
        var lastFetched = orgRows.Count > 0
            ? (DateTime?)DateTime.SpecifyKind((DateTime)orgRows[0].lastFetchedUtc, DateTimeKind.Utc)
            : null;

        var indiaByRotaryId = indiaMembers
            .Where(m => !string.IsNullOrWhiteSpace((string?)m.rotaryId))
            .ToDictionary(m => ((string)m.rotaryId).Trim(), m => m, StringComparer.OrdinalIgnoreCase);
        var orgByRotaryId = orgMembers.ToDictionary(m => m.rotaryMemberId.ToString(), m => m, StringComparer.OrdinalIgnoreCase);

        var matched = indiaByRotaryId.Keys.Intersect(orgByRotaryId.Keys, StringComparer.OrdinalIgnoreCase).Count();
        var onlyIndia = indiaMembers.Count(m => string.IsNullOrWhiteSpace((string?)m.rotaryId)
            || !orgByRotaryId.ContainsKey(((string)m.rotaryId).Trim()));
        var onlyOrg = orgMembers.Count(m => !indiaByRotaryId.ContainsKey(m.rotaryMemberId.ToString()));

        return Ok(new
        {
            clubId,
            clubName = club.ClubName,
            rotaryClubId,
            indiaMembers,
            orgMembers,
            lastFetchedUtc = lastFetched,
            counts = new
            {
                local = indiaMembers.Count,
                rotaryOrg = orgMembers.Count,
                matched,
                onlyIndia,
                onlyOrg,
            }
        });
    }

    [HttpPost("members/refresh-cache")]
    public async Task<ActionResult> RefreshMembersCache([FromQuery] int clubId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (clubId <= 0) return BadRequest(new { message = "clubId required" });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var rotaryClubIdStr = await conn.ExecuteScalarAsync<string?>(
            "SELECT ClubRotaryId FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0",
            new { Id = clubId });
        if (string.IsNullOrEmpty(rotaryClubIdStr) || !int.TryParse(rotaryClubIdStr, out var rotaryClubId))
            return BadRequest(new { message = "Club has no Rotary.org ID" });

        // Cache = ACTIVE + HONORARY members (the /Active endpoint excludes honorary, which used to
        // make this page under-count vs the real club membership). Deduped by MemberId.
        List<RotaryOrgClubMemberDto> list;
        try
        {
            var active = await _api.GetClubMembersAsync("Rotary Club", rotaryClubId);
            var honorary = await _api.GetClubHonoraryMembersAsync("Rotary Club", rotaryClubId);
            var seen = new HashSet<long>(active.Select(a => a.MemberId));
            list = active.Concat(honorary.Where(h => seen.Add(h.MemberId))).ToList();
        }
        catch (Exception ex) { return StatusCode(502, new { message = $"Rotary.org API error: {ex.Message}" }); }

        // Fetch /individuals/{id}/profile for richer data (email, mobile, address, dob, gender, language).
        // One call per member — done 6 at a time (same as the sync worker's --concurrency default) so a
        // 500-member club takes about a minute instead of 6-8. A failed call gets one retry.
        var profiles = new RotaryOrgIndividualProfileResponse?[list.Count];
        int profileFetched = 0, profileFailed = 0;
        using (var gate = new SemaphoreSlim(6))
        {
            await Task.WhenAll(list.Select(async (m, i) =>
            {
                await gate.WaitAsync();
                try
                {
                    for (var attempt = 1; attempt <= 2; attempt++)
                    {
                        try { profiles[i] = await _api.GetIndividualProfileAsync(m.MemberId); break; }
                        catch when (attempt == 1) { await Task.Delay(1500); }
                        catch { }
                    }
                    if (profiles[i] != null) Interlocked.Increment(ref profileFetched);
                    else Interlocked.Increment(ref profileFailed);
                }
                finally { gate.Release(); }
            }));
        }

        // Replace cache for this club in ONE transaction — every Rotary.org call is already done, so the
        // club's cache is never left half-empty if something fails part-way.
        using var tx = await conn.BeginTransactionAsync();
        await conn.ExecuteAsync(
            "DELETE FROM rotary_org_club_members_cache WHERE fk_rotary_club_id = @C",
            new { C = rotaryClubId }, tx);

        var nowUtc = DateTime.UtcNow;
        for (var i = 0; i < list.Count; i++)
        {
            var m = list[i];
            var profile = profiles[i];

            var ind = profile?.Individual;
            var email = profile?.Email?.FirstOrDefault(e => e.IsPrimary == true)?.EmailAddress
                     ?? profile?.Email?.FirstOrDefault()?.EmailAddress;
            var phone = profile?.Phone?.FirstOrDefault(p => p.IsPrimary == true)?.PhoneNumber
                     ?? profile?.Phone?.FirstOrDefault(p => string.Equals(p.PhoneType, "Mobile", StringComparison.OrdinalIgnoreCase))?.PhoneNumber
                     ?? profile?.Phone?.FirstOrDefault()?.PhoneNumber;
            var addr = profile?.Address?.FirstOrDefault(a => a.IsPrimary == true) ?? profile?.Address?.FirstOrDefault();
            var addrLine = addr == null ? null : string.Join(", ", new[] { addr.AddressLine1, addr.AddressLine2, addr.AddressLine3 }
                .Where(s => !string.IsNullOrWhiteSpace(s)));

            await conn.ExecuteAsync(@"
                INSERT INTO rotary_org_club_members_cache
                    (fk_rotary_club_id, RotaryMemberId, LocalizedName, Prefix, FirstName, MiddleName, LastName, Suffix,
                     AdmissionDate, TerminationDate, BirthYear, MemberType,
                     Email, Mobile, DateOfBirth, Gender, PrimaryLanguage,
                     AddressLine, City, State, Country, PostalCode, LastFetchedUtc)
                VALUES (@C, @M, @LName, @Pre, @F, @Mid, @L, @Suf, @Adm, @Term, @By, @Type,
                    @Email, @Mobile, @Dob, @Gender, @Lang,
                    @Addr, @City, @State, @Country, @Postal, @Now)",
                new
                {
                    C = rotaryClubId,
                    M = m.MemberId,
                    LName = m.LocalizedName,
                    Pre = m.Prefix,
                    F = m.FirstName,
                    Mid = m.MiddleName,
                    L = m.LastName,
                    Suf = m.Suffix,
                    Adm = m.AdmissionDate,
                    Term = m.TerminationDate,
                    By = m.BirthYear,
                    Type = m.MemberType,
                    Email = email,
                    Mobile = phone,
                    Dob = ind?.DateOfBirth,
                    Gender = !string.IsNullOrWhiteSpace(ind?.Gender) ? ind!.Gender : ind?.GenderDescription,
                    Lang = ind?.PrimaryLanguage,
                    Addr = addrLine,
                    City = addr?.City,
                    State = addr?.State,
                    Country = addr?.Country,
                    Postal = addr?.PostalCode,
                    Now = nowUtc,
                }, tx);
        }
        await tx.CommitAsync();

        return Ok(new
        {
            message = $"Members cache refreshed: {list.Count} members ({profileFetched} with full profile, {profileFailed} profile fetch failed)",
            lastFetchedUtc = nowUtc,
            profileFetched,
            profileFailed,
        });
    }

    [HttpPost("members")]
    public async Task<ActionResult> AddMemberFromOrg([FromBody] AddMemberFromOrgRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.RotaryMemberId <= 0 || req.ClubId <= 0)
            return BadRequest(new { message = "rotaryMemberId and clubId required" });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var club = await conn.QueryFirstOrDefaultAsync<(string ClubRotaryId, string ClubName)>(
            "SELECT IFNULL(ClubRotaryId, '') AS ClubRotaryId, ClubName FROM club_master WHERE pk_club_id = @Id AND isdeleted = 0",
            new { Id = req.ClubId });
        if (string.IsNullOrEmpty(club.ClubName)) return NotFound(new { message = "Club not found" });
        if (!int.TryParse(club.ClubRotaryId, out var rotaryClubId))
            return BadRequest(new { message = "Club has no Rotary.org ID" });

        // Find this member in Rotary.org club listing to get AdmissionDate + names
        var orgList = await _api.GetClubMembersAsync("Rotary Club", rotaryClubId);
        var match = orgList.FirstOrDefault(m => m.MemberId == req.RotaryMemberId);
        if (match == null) return NotFound(new { message = "Member not found in this club on Rotary.org" });

        var inserted = await AddMemberFromOrgAsync(conn, req.ClubId, match);
        return inserted
            ? Ok(new { message = "Member added." })
            : Conflict(new { message = "Member already in this club" });
    }

    [HttpPut("members/{memberId:int}")]
    public async Task<ActionResult> UpdateMemberManual(int memberId, [FromBody] UpdateMemberManualRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var exists = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_member_master_profile_id FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = memberId });
        if (exists == null) return NotFound(new { message = "Member not found" });

        // Free the number from any soft-deleted row so the update doesn't hit UNIQUE(PrimaryMobileNumber).
        await ReleaseSoftDeletedMobileAsync(conn, req.Mobile, excludeId: memberId);

        await conn.ExecuteAsync(@"
            UPDATE member_master_profile
            SET MemberName = COALESCE(@Name, MemberName),
                RotaryId = COALESCE(@Rid, RotaryId),
                EmailId = COALESCE(@Email, EmailId),
                PrimaryMobileNumber = COALESCE(@Mobile, PrimaryMobileNumber),
                SecondaryMobileNumber = COALESCE(@SecMobile, SecondaryMobileNumber),
                BirthDate = COALESCE(@Dob, BirthDate),
                Gender = COALESCE(@Gender, Gender),
                PrimaryLanguage = COALESCE(@Lang, PrimaryLanguage),
                modified_by = @U, modified_date = NOW()
            WHERE pk_member_master_profile_id = @Id",
            new
            {
                Id = memberId,
                Name = req.MemberName,
                Rid = req.RotaryId,
                Email = req.Email,
                Mobile = req.Mobile,
                SecMobile = req.SecondaryMobile,
                Dob = req.BirthDate,
                Gender = req.Gender,
                Lang = req.PrimaryLanguage,
                U = GetUserId(),
            });

        await UpsertAddressIfPresentAsync(conn, memberId, "Residential", req.ResAddress, req.ResCity, req.ResState, req.ResPinCode);
        await UpsertAddressIfPresentAsync(conn, memberId, "Business", req.BusAddress, req.BusCity, req.BusState, req.BusPinCode);

        return Ok(new { message = "Member updated." });
    }

    private async Task UpsertAddressIfPresentAsync(MySqlConnection conn, int memberId, string type, string? address, string? city, string? state, string? pinCode)
    {
        // Skip if all 4 fields are blank — avoids blanking-out an existing address on a partial save
        if (string.IsNullOrWhiteSpace(address) && string.IsNullOrWhiteSpace(city)
            && string.IsNullOrWhiteSpace(state) && string.IsNullOrWhiteSpace(pinCode)) return;

        var existingId = await conn.ExecuteScalarAsync<int?>(@"
            SELECT MAX(pk_member_address_details_id) FROM member_address_details
            WHERE fk_member_master_profile_id = @M AND AddressType = @T AND isdeleted = 0",
            new { M = memberId, T = type });

        if (existingId.HasValue)
        {
            await conn.ExecuteAsync(@"
                UPDATE member_address_details
                SET Address = COALESCE(@Addr, Address),
                    City = COALESCE(@City, City),
                    State = COALESCE(@State, State),
                    PinCode = COALESCE(@Pin, PinCode),
                    modified_date = NOW()
                WHERE pk_member_address_details_id = @Id",
                new { Id = existingId.Value, Addr = address, City = city, State = state, Pin = pinCode });
        }
        else
        {
            await conn.ExecuteAsync(@"
                INSERT INTO member_address_details
                    (fk_member_master_profile_id, AddressType, fk_country_id, Address, City, State, PinCode, created_date, isdeleted)
                VALUES (@M, @T, 1, @Addr, @City, @State, @Pin, NOW(), 0)",
                new { M = memberId, T = type, Addr = address, City = city, State = state, Pin = pinCode });
        }
    }

    [HttpDelete("members/{memberId:int}/from-club/{clubId:int}")]
    public async Task<ActionResult> DeleteMemberFromClub(int memberId, int clubId)
    {
        if (!IsSuperAdmin()) return Forbid();
        // Delegate to the SAME removal logic used by the Club Dashboard "Remove member"
        // (ClubService.RemoveMemberAsync): club-scoped soft-delete of club_members / roles / BOD /
        // DC / AG / moderator, and — when this is the member's LAST club — free the primary mobile
        // (Primary -> Secondary) + soft-delete address & family, while KEEPING the profile.
        // Calling the shared method (instead of duplicating SQL) guarantees every delete surface
        // stays identical and can't drift.
        try
        {
            await _clubService.RemoveMemberAsync(clubId, memberId, GetUserId());
            return Ok(new { message = "Member removed from club." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Delete member {Mid} from club {Cid} failed", memberId, clubId);
            return StatusCode(500, new { message = ex.Message });
        }
    }

    [HttpGet("members/org-detail/{rotaryMemberId:long}")]
    public async Task<ActionResult> GetMemberOrgDetail(long rotaryMemberId)
    {
        if (!IsSuperAdmin()) return Forbid();
        try
        {
            var profile = await _api.GetIndividualProfileAsync(rotaryMemberId);
            if (profile == null) return NotFound(new { message = "Not found on Rotary.org" });
            return Ok(profile);
        }
        catch (Exception ex) { return StatusCode(502, new { message = ex.Message }); }
    }

    [HttpGet("members/india-detail/{memberId:int}")]
    public async Task<ActionResult> GetMemberIndiaDetail(int memberId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId, m.RotaryId AS rotaryId,
                   m.MemberName AS memberName, m.EmailId AS email, m.PrimaryMobileNumber AS mobile,
                   m.SecondaryMobileNumber AS secondaryMobile, m.BirthDate AS birthDate,
                   m.Gender AS gender, m.PrimaryLanguage AS language, m.IsYouth AS isYouth,
                   m.created_date AS createdDate
            FROM member_master_profile m
            WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0",
            new { Id = memberId });
        if (member == null) return NotFound();
        var addresses = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_member_address_details_id AS id, AddressType AS addressType, Address AS address,
                   City AS city, State AS state, PinCode AS pinCode, fk_country_id AS countryId
            FROM member_address_details
            WHERE fk_member_master_profile_id = @Id AND isdeleted = 0", new { Id = memberId })).ToList();
        return Ok(new { profile = member, addresses });
    }

    // ─── DTOs ───
    public class AddClubFromOrgRequest
    {
        public int RotaryClubId { get; set; }
        public int DistrictId { get; set; }
    }

    public class UpdateClubManualRequest
    {
        public string? ClubName { get; set; }
        public string? MeetingAddress { get; set; }
        public string? MeetingDay { get; set; }
        public string? City { get; set; }
        public string? State { get; set; }
        public DateTime? CharterDate { get; set; }
    }

    // ════════════════════════════════════════════════════════════════════════
    // SYNC EXCEPTION LOG (added 2026-06-30 after mobile-overwrite incident)
    // ════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// List sync exceptions for admin review (paginated). Filter by type or
    /// resolved status. Used by SuperAdmin to triage mobile/email collisions,
    /// insert errors, missing RotaryId, etc. logged by the sweep worker.
    /// </summary>
    [HttpGet("sync-exceptions")]
    public async Task<ActionResult> ListSyncExceptions(
        [FromQuery] string? type,
        [FromQuery] int? resolved,
        [FromQuery] int? inserted,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 200) pageSize = 50;

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var whereClauses = new List<string>();
        var p = new DynamicParameters();
        if (!string.IsNullOrWhiteSpace(type))
        {
            whereClauses.Add("e.exception_type = @Type");
            p.Add("Type", type.Trim());
        }
        if (resolved.HasValue)
        {
            whereClauses.Add("e.is_resolved = @Resolved");
            p.Add("Resolved", resolved.Value == 0 ? 0 : 1);
        }
        // inserted filter: 0 = only rows where the member did NOT land (the ones to review), 1 = only landed.
        if (inserted.HasValue)
        {
            whereClauses.Add("COALESCE(e.inserted, 0) = @Inserted");
            p.Add("Inserted", inserted.Value == 0 ? 0 : 1);
        }
        var whereSql = whereClauses.Count > 0 ? "WHERE " + string.Join(" AND ", whereClauses) : "";
        p.Add("Limit", pageSize);
        p.Add("Offset", (page - 1) * pageSize);

        var rows = await conn.QueryAsync<dynamic>($@"
            SELECT e.pk_id AS id,
                   e.exception_type AS exceptionType,
                   e.rotary_id AS rotaryId,
                   e.rotary_org_name AS rotaryOrgName,
                   e.field_name AS fieldName,
                   e.conflict_value AS conflictValue,
                   e.conflict_with_member_pk AS conflictMemberId,
                   e.conflict_with_member_name AS conflictMemberName,
                   e.admin_message AS adminMessage,
                   e.error_message AS errorMessage,
                   e.fk_club_id AS clubId,
                   c.ClubRotaryId AS clubRotaryId,
                   c.ClubName AS clubName,
                   e.fk_member_master_profile_id AS memberId,
                   COALESCE(e.inserted, 0) AS inserted,
                   e.is_resolved AS isResolved,
                   e.resolved_by AS resolvedBy,
                   e.resolved_date AS resolvedDate,
                   e.resolution_notes AS resolutionNotes,
                   e.created_date AS createdDate
            FROM sync_exception_log e
            LEFT JOIN club_master c ON c.pk_club_id = e.fk_club_id
            {whereSql}
            ORDER BY e.created_date DESC
            LIMIT @Limit OFFSET @Offset", p);

        var totalCount = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM sync_exception_log e {whereSql}", p);

        var summary = await conn.QueryAsync<dynamic>(@"
            SELECT exception_type AS type,
                   SUM(CASE WHEN is_resolved = 0 THEN 1 ELSE 0 END) AS unresolved,
                   SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) AS resolved,
                   COUNT(*) AS total
            FROM sync_exception_log
            GROUP BY exception_type
            ORDER BY exception_type");

        return Ok(new { items = rows, totalCount, page, pageSize, summary });
    }

    /// <summary>
    /// Mark a sync exception as resolved (admin has fixed the underlying data).
    /// </summary>
    [HttpPost("sync-exceptions/{id:long}/resolve")]
    public async Task<ActionResult> ResolveSyncException(long id, [FromBody] ResolveExceptionRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var rows = await conn.ExecuteAsync(@"
            UPDATE sync_exception_log
            SET is_resolved = 1,
                resolved_by = @By,
                resolved_date = NOW(),
                resolution_notes = @Notes
            WHERE pk_id = @Id AND is_resolved = 0",
            new { Id = id, By = GetUserId(), Notes = req?.Notes });

        if (rows == 0) return NotFound(new { message = "Exception not found or already resolved." });
        return Ok(new { message = "Resolved." });
    }

    public class ResolveExceptionRequest
    {
        public string? Notes { get; set; }
    }

    public class AddMemberFromOrgRequest
    {
        public long RotaryMemberId { get; set; }
        public int ClubId { get; set; }
    }

    public class UpdateMemberManualRequest
    {
        public string? MemberName { get; set; }
        public string? RotaryId { get; set; }
        public string? Email { get; set; }
        public string? Mobile { get; set; }
        public string? SecondaryMobile { get; set; }
        public DateTime? BirthDate { get; set; }
        public string? Gender { get; set; }
        public string? PrimaryLanguage { get; set; }
        // Residential address
        public string? ResAddress { get; set; }
        public string? ResCity { get; set; }
        public string? ResState { get; set; }
        public string? ResPinCode { get; set; }
        // Business address
        public string? BusAddress { get; set; }
        public string? BusCity { get; set; }
        public string? BusState { get; set; }
        public string? BusPinCode { get; set; }
    }

    // ════════════════════════════════════════════════════════════════════════
    // MEMBER MATCH — district → sync clubs → ROW vs Rotary.org member counts.
    // Rotary.org count = live /Active + /Honorary (NOT the /clubs list number).
    // "Sync" runs the exact --member-sweep logic by launching the worker exe.
    // ════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// List a district's SYNC clubs with the ROW (DB) member count. The Rotary.org
    /// count is loaded per-club via GetClubOrgMemberCount so this list returns fast.
    /// </summary>
    [HttpGet("members/district-clubs")]
    public async Task<ActionResult> GetDistrictSyncClubs([FromQuery] int districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var items = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id                                 AS clubId,
                   c.ClubRotaryId                               AS clubRotaryId,
                   IFNULL(c.ClubName, '')                       AS clubName,
                   IFNULL(NULLIF(c.ClubType,''),'Rotary Club')  AS clubType,
                   (SELECT COUNT(*) FROM club_members cm
                      WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0) AS localCount
            FROM club_master c
            WHERE c.fk_district_id = @D AND c.isdeleted = 0
              AND IFNULL(c.IsSyncedFromRotaryOrg,0) = 1
              AND c.ClubRotaryId IS NOT NULL AND c.ClubRotaryId <> ''
            ORDER BY c.ClubName",
            new { D = districtId });
        return Ok(new { items });
    }

    /// <summary>
    /// Live Rotary.org member count for ONE club = /Active + /Honorary (deduped by MemberId).
    /// Deliberately does NOT use the /clubs list count.
    /// </summary>
    [HttpGet("members/club-org-count")]
    public async Task<ActionResult> GetClubOrgMemberCount([FromQuery] int clubId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT ClubRotaryId AS clubRotaryId, IFNULL(NULLIF(ClubType,''),'Rotary Club') AS clubType FROM club_master WHERE pk_club_id=@C LIMIT 1",
            new { C = clubId });
        if (club == null) return NotFound(new { message = "Club not found." });
        if (!int.TryParse((string?)club.clubRotaryId, out var rid) || rid <= 0)
            return Ok(new { orgActive = 0, orgHonorary = 0, orgTotal = 0, error = "Club has no Rotary.org id." });
        // Use "Rotary Club" to match exactly what the --member-sweep worker fetches
        // (ClubMemberSweepWorker hardcodes "Rotary Club"), so this count reconciles with a sync.
        const string clubType = "Rotary Club";
        try
        {
            var active = await _api.GetClubMembersAsync(clubType, rid);
            var honorary = await _api.GetClubHonoraryMembersAsync(clubType, rid);
            var activeIds = new HashSet<long>(active.Select(m => m.MemberId));
            int honOnly = honorary.Count(h => !activeIds.Contains(h.MemberId));
            return Ok(new { orgActive = active.Count, orgHonorary = honOnly, orgTotal = active.Count + honOnly });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "club-org-count failed for club {C}", clubId);
            return Ok(new { orgActive = 0, orgHonorary = 0, orgTotal = 0, error = ex.Message });
        }
    }

    // The "COG" catch-all club (pk_club_id) — its members and honorary members are protected
    // from the no-Rotary-ID cleanup (they're legitimately hand-managed, not Rotary.org-sourced).
    private static int CogClubId => RotaryApi.Services.Brand.CogClubId;

    private static string OrgMemberName(RotaryApi.Services.RotaryOrg.RotaryOrgClubMemberDto m) =>
        string.Join(" ", new[] { m.FirstName, m.MiddleName, m.LastName }
            .Where(s => !string.IsNullOrWhiteSpace(s))).Trim();

    /// <summary>
    /// Per-member diff for one club: exactly which members differ between ROW and the live
    /// Rotary.org list, and what will happen to each — ADD (on Rotary.org, missing locally),
    /// REMOVE (has a Rotary ID but gone from Rotary.org → the sweep terminates it), or
    /// NO-ROTARY-ID (locally added; soft-deleted by the cleanup UNLESS honorary or in the COG club).
    /// </summary>
    [HttpGet("members/club-diff")]
    public async Task<ActionResult> GetClubDiff([FromQuery] int clubId)
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var club = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT ClubName AS clubName, ClubRotaryId AS clubRotaryId FROM club_master WHERE pk_club_id=@C AND isdeleted=0 LIMIT 1",
            new { C = clubId });
        if (club == null) return NotFound(new { message = "Club not found." });
        if (!int.TryParse((string?)club.clubRotaryId, out var rid) || rid <= 0)
            return Ok(new { clubId, error = "Club has no Rotary.org id." });

        // ROW side (same set the count uses): member + Rotary ID + honorary(this club) + COG membership.
        var localMembers = (await conn.QueryAsync<(int MemberId, string? RotaryId, string? MemberName, int Honorary, int InCog)>(@"
            SELECT m.pk_member_master_profile_id AS MemberId, m.RotaryId, m.MemberName,
                   COALESCE(cm.IsHonoraryMember,0) AS Honorary,
                   (SELECT COUNT(*) FROM club_members x WHERE x.fk_member_master_profile_id=m.pk_member_master_profile_id AND x.fk_club_id=@Cog AND x.isdeleted=0) AS InCog
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 AND m.isdeleted = 0",
            new { ClubId = clubId, Cog = CogClubId })).ToList();

        // Rotary.org side (Active + Honorary, deduped) — same fetch as club-org-count.
        List<RotaryApi.Services.RotaryOrg.RotaryOrgClubMemberDto> active, honorary;
        try
        {
            active = await _api.GetClubMembersAsync("Rotary Club", rid);
            honorary = await _api.GetClubHonoraryMembersAsync("Rotary Club", rid);
        }
        catch (Exception ex) { return Ok(new { clubId, error = ex.Message }); }

        var activeIds = new HashSet<long>(active.Select(m => m.MemberId));
        var org = new List<(long MemberId, string Name, bool Honorary)>();
        foreach (var m in active) org.Add((m.MemberId, OrgMemberName(m), false));
        foreach (var h in honorary) if (!activeIds.Contains(h.MemberId)) org.Add((h.MemberId, OrgMemberName(h), true));

        var localRids = new HashSet<string>(localMembers.Where(r => !string.IsNullOrWhiteSpace(r.RotaryId))
            .Select(r => r.RotaryId!.Trim()), StringComparer.OrdinalIgnoreCase);
        var orgIds = new HashSet<string>(org.Select(o => o.MemberId.ToString()), StringComparer.OrdinalIgnoreCase);

        var toAdd = org.Where(o => !localRids.Contains(o.MemberId.ToString()))
            .Select(o => new { rotaryId = o.MemberId.ToString(), name = o.Name, isHonorary = o.Honorary }).ToList();

        var toRemove = localMembers.Where(r => !string.IsNullOrWhiteSpace(r.RotaryId) && !orgIds.Contains(r.RotaryId!.Trim()))
            .Select(r => new { memberId = r.MemberId, rotaryId = r.RotaryId, name = r.MemberName ?? "" }).ToList();

        var noRotaryId = localMembers.Where(r => string.IsNullOrWhiteSpace(r.RotaryId))
            .Select(r =>
            {
                var keep = r.Honorary == 1 || r.InCog > 0;
                return new
                {
                    memberId = r.MemberId,
                    name = r.MemberName ?? "",
                    honorary = r.Honorary == 1,
                    inCog = r.InCog > 0,
                    willSoftDelete = !keep,
                    keepReason = keep ? (r.Honorary == 1 ? "Honorary" : "COG member") : (string?)null,
                };
            }).ToList();

        return Ok(new
        {
            clubId,
            clubName = (string?)club.clubName,
            clubRotaryId = (string?)club.clubRotaryId,
            localCount = localMembers.Count,
            orgCount = org.Count,
            toAdd,
            toRemove,
            noRotaryId,
        });
    }

    /// <summary>
    /// Soft-delete no-Rotary-ID members from a club (member-match cleanup). Mirrors the sweep's
    /// per-club termination (club_members + club-scoped roles/BOD/committee rows; the person's
    /// member_master_profile is intentionally preserved). Server re-validates each member is
    /// no-Rotary-ID, non-honorary, and not in the COG club — a stale client can't remove the wrong one.
    /// </summary>
    [HttpPost("members/soft-delete-club-links")]
    public async Task<ActionResult> SoftDeleteClubLinks([FromBody] SoftDeleteLinksRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req == null || req.ClubId <= 0 || req.MemberIds == null || req.MemberIds.Count == 0)
            return BadRequest(new { message = "clubId and memberIds are required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var eligible = (await conn.QueryAsync<int>(@"
            SELECT cm.fk_member_master_profile_id
            FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @ClubId AND cm.isdeleted = 0 AND m.isdeleted = 0
              AND cm.fk_member_master_profile_id IN @Ids
              AND (m.RotaryId IS NULL OR TRIM(m.RotaryId) = '')
              AND COALESCE(cm.IsHonoraryMember,0) = 0
              AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id = @Cog AND isdeleted = 0)",
            new { req.ClubId, Ids = req.MemberIds, Cog = CogClubId })).ToList();

        if (eligible.Count == 0) return Ok(new { softDeleted = 0, message = "No eligible members to soft-delete." });

        using var tx = await conn.BeginTransactionAsync();
        var p = new { ClubId = req.ClubId, Ids = eligible, Reason = "Removed: no Rotary ID (member-match cleanup)" };
        await conn.ExecuteAsync(@"UPDATE club_members SET isdeleted=1, deleted_date=NOW(), TerminationDate=CURDATE(), TerminationReason=@Reason
            WHERE fk_club_id=@ClubId AND fk_member_master_profile_id IN @Ids AND isdeleted=0", p, tx);
        await conn.ExecuteAsync(@"UPDATE member_roles SET isdeleted=1, IsActive=0, RevokedDate=NOW(), modified_date=NOW()
            WHERE fk_club_id=@ClubId AND fk_member_master_profile_id IN @Ids AND isdeleted=0", p, tx);
        await conn.ExecuteAsync(@"UPDATE board_of_directors SET isdeleted=1, deleted_date=NOW()
            WHERE fk_club_id=@ClubId AND fk_member_master_profile_id IN @Ids AND isdeleted=0", p, tx);
        await conn.ExecuteAsync(@"UPDATE district_committee_member SET isdeleted=1, modified_date=NOW()
            WHERE fk_club_id=@ClubId AND fk_member_id IN @Ids AND isdeleted=0", p, tx);
        await conn.ExecuteAsync(@"UPDATE district_committee_group_member SET isdeleted=1, modified_date=NOW()
            WHERE fk_club_id=@ClubId AND fk_member_id IN @Ids AND isdeleted=0", p, tx);
        await conn.ExecuteAsync(@"UPDATE district_committee_sub_group_member SET isdeleted=1, modified_date=NOW()
            WHERE fk_club_id=@ClubId AND fk_member_id IN @Ids AND isdeleted=0", p, tx);
        await conn.ExecuteAsync(@"UPDATE district_ag SET isdeleted=1, is_active=0, modified_date=NOW()
            WHERE fk_club_id=@ClubId AND fk_member_id IN @Ids AND isdeleted=0", p, tx);
        await conn.ExecuteAsync(@"UPDATE district_club_moderator SET isdeleted=1, is_active=0, modified_date=NOW()
            WHERE fk_club_id=@ClubId AND fk_member_id IN @Ids AND isdeleted=0", p, tx);
        await tx.CommitAsync();

        _logger.LogInformation("Member-match cleanup: soft-deleted {N} no-Rotary-ID members from club {Club}", eligible.Count, req.ClubId);
        return Ok(new { softDeleted = eligible.Count, message = $"{eligible.Count} no-Rotary-ID member(s) soft-deleted from the club." });
    }

    public class SoftDeleteLinksRequest
    {
        public int ClubId { get; set; }
        public List<int> MemberIds { get; set; } = new();
    }

    /// <summary>
    /// Run the member sweep for ONE club — same logic as
    /// <c>RotaryOrgSyncWorker.exe --member-sweep --club-id &lt;ClubRotaryId&gt;</c>.
    /// </summary>
    [HttpPost("members/sweep-club")]
    public async Task<ActionResult> SweepClub([FromBody] SweepClubRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req == null || req.ClubId <= 0) return BadRequest(new { message = "clubId required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rid = await conn.ExecuteScalarAsync<string?>(
            "SELECT ClubRotaryId FROM club_master WHERE pk_club_id=@C AND isdeleted=0 LIMIT 1", new { C = req.ClubId });
        if (string.IsNullOrWhiteSpace(rid)) return NotFound(new { message = "Club not found or has no Rotary.org id." });
        return LaunchSweep(rid.Trim());
    }

    /// <summary>
    /// Run the member sweep for ALL sync clubs in a district — same logic as
    /// <c>--member-sweep --club-id &lt;id1,id2,...&gt;</c>.
    /// </summary>
    [HttpPost("members/sweep-district")]
    public async Task<ActionResult> SweepDistrict([FromBody] SweepDistrictRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req == null || req.DistrictId <= 0) return BadRequest(new { message = "districtId required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rids = (await conn.QueryAsync<string>(@"
            SELECT ClubRotaryId FROM club_master
            WHERE fk_district_id=@D AND isdeleted=0 AND IFNULL(IsSyncedFromRotaryOrg,0)=1
              AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''",
            new { D = req.DistrictId })).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0).ToList();
        if (rids.Count == 0) return NotFound(new { message = "No sync clubs in this district." });
        return LaunchSweep(string.Join(",", rids));
    }

    /// <summary>
    /// Reconcile members for ONLY the mismatched sync clubs in a district — launches
    /// <c>--member-count-reconcile --districts &lt;DistrictNumber&gt;</c>. The worker itself
    /// compares each club's ROW count vs the Rotary.org /clubs count and sweeps (add missing +
    /// remove departed, profiles kept) only the ones that differ. Matched clubs are skipped.
    /// This is the club-page "Sync all mismatched — this district" button.
    /// </summary>
    [HttpPost("members/reconcile-district")]
    public async Task<ActionResult> ReconcileDistrict([FromBody] SweepDistrictRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req == null || req.DistrictId <= 0) return BadRequest(new { message = "districtId required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var districtNumber = await conn.ExecuteScalarAsync<string?>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id=@D AND isdeleted=0 LIMIT 1", new { D = req.DistrictId });
        if (string.IsNullOrWhiteSpace(districtNumber)) return NotFound(new { message = "District not found." });
        return LaunchWorker(
            $"--member-count-reconcile --districts {districtNumber.Trim()}",
            "Member reconcile started for this district. Only clubs whose member count differs are swept (missing members added, departed removed; profiles kept). It emails a report when done — refresh the counts in a minute.");
    }

    // Launches RotaryOrgSyncWorker.exe --member-sweep --club-id <ids> as a detached background
    // process. The worker writes progress to rotary_org_sync_log and emails a report on completion.
    private ActionResult LaunchSweep(string clubRotaryIdsCsv)
        => LaunchWorker(
            $"--member-sweep --club-id {clubRotaryIdsCsv}",
            "Member sync started in the background. It writes to the sync log and emails a report when done. Refresh the counts in a minute.",
            new { clubRotaryIds = clubRotaryIdsCsv });

    // Shared launcher: starts the sync worker exe detached with the given arguments. Used by the
    // per-club/district member sweep AND the mismatch-only district reconcile.
    private ActionResult LaunchWorker(string arguments, string startedMessage, object? extra = null)
    {
        var exePath = _config["RotaryOrgSync:WorkerExePath"];
        if (string.IsNullOrWhiteSpace(exePath) || !System.IO.File.Exists(exePath))
        {
            _logger.LogError("Worker launch requested but RotaryOrgSync:WorkerExePath is missing/invalid: '{Path}'", exePath);
            return StatusCode(500, new { message = "Worker executable is not configured on the server (RotaryOrgSync:WorkerExePath). Run it from the server console instead." });
        }
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = exePath,
                Arguments = arguments,
                WorkingDirectory = System.IO.Path.GetDirectoryName(exePath)!,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            var proc = System.Diagnostics.Process.Start(psi);
            _logger.LogInformation("Launched worker (pid {Pid}): {Args}", proc?.Id, arguments);
            return Ok(new { started = true, pid = proc?.Id, message = startedMessage, extra });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to launch worker: {Args}", arguments);
            return StatusCode(500, new { message = "Failed to launch the sync worker: " + ex.Message });
        }
    }

    /// <summary>
    /// Mark a ROW club as synced (IsSyncedFromRotaryOrg=1) and run the full member sweep.
    /// For clubs that ARE sync on Rotary.org but show as non-sync in ROW. The flag MUST flip
    /// FIRST — the member sweep only processes IsSyncedFromRotaryOrg=1 clubs.
    /// </summary>
    [HttpPost("clubs/mark-synced")]
    public async Task<ActionResult> MarkClubSynced([FromBody] SweepClubRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req == null || req.ClubId <= 0) return BadRequest(new { message = "clubId required." });
        using var conn = CreateConnection();
        await conn.OpenAsync();
        var rid = await conn.ExecuteScalarAsync<string?>(
            "SELECT ClubRotaryId FROM club_master WHERE pk_club_id=@C AND isdeleted=0 LIMIT 1", new { C = req.ClubId });
        if (string.IsNullOrWhiteSpace(rid)) return NotFound(new { message = "Club not found or has no Rotary.org id." });
        await conn.ExecuteAsync(
            "UPDATE club_master SET IsSyncedFromRotaryOrg=1, modified_date=NOW() WHERE pk_club_id=@C AND isdeleted=0",
            new { C = req.ClubId });
        return LaunchSweep(rid.Trim());
    }

    public class SweepClubRequest { public int ClubId { get; set; } }
    public class SweepDistrictRequest { public int DistrictId { get; set; } }
}
