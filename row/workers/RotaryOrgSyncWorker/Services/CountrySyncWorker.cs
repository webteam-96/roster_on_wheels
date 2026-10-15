using ClosedXML.Excel;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Weekly country sync. Fetches ALL Rotary clubs in India / Sri Lanka / Nepal from
/// Rotary.org's search endpoint and reconciles with our local DB so the count of
/// clubs in each district matches Rotary.org exactly.
///
/// Logic:
///  1. Fetch all 3 countries' clubs (one API call per country).
///  2. For each result: if ClubRotaryId already in DB → SKIP (don't touch sync clubs).
///     If not in DB → INSERT as non-sync (IsSyncedFromRotaryOrg=0, ROW_as_vendor_selected=1,
///     AddedByCountrySync=1).
///  3. After processing: any club in our DB that is in a tracked district AND has
///     ROW_as_vendor_selected=1 AND ClubRotaryId set, but is NOT in the search results,
///     gets soft-deleted (isdeleted=1) — it was removed from Rotary.org.
///  4. Send single email summary with district-wise counts.
///
/// Schedule: weekly via Task Scheduler (e.g., Sunday 3 AM).
/// </summary>
public class CountrySyncWorker
{

    private readonly IRotaryOrgApiClient _api;
    private readonly EmailReportSender _emailSender;
    private readonly IConfiguration _config;
    private readonly ILogger<CountrySyncWorker> _logger;
    private readonly string _connectionString;

    public CountrySyncWorker(
        IRotaryOrgApiClient api,
        EmailReportSender emailSender,
        IConfiguration config,
        ILogger<CountrySyncWorker> logger)
    {
        _api = api;
        _emailSender = emailSender;
        _config = config;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection missing");
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // dryRun    → fetch real data and print what WOULD change, but make NO DB writes and send NO email.
    // onlyClubId → restrict the insert decisions to a single ClubRotaryId (used with --dry-run to test one club).
    public async Task RunAsync(CancellationToken ct = default, bool dryRun = false, string? onlyClubId = null)
    {
        var startedAt = DateTime.UtcNow;
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Country Sync START ===");
        if (dryRun) Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] *** DRY RUN — no DB writes, no email ***");
        if (onlyClubId != null) Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] *** Restricted to ClubRotaryId {onlyClubId} ***");

        // Insert log row (skipped on dry-run — no DB writes).
        int logId = 0;
        if (!dryRun)
        {
            await using var conn = CreateConnection();
            await conn.OpenAsync(ct);
            var triggeredBy = int.Parse(_config["RotaryOrgSync:TriggeredByMemberId"] ?? "0");
            logId = await conn.ExecuteScalarAsync<int>(@"
                INSERT INTO rotary_org_sync_log (SyncType, StartedAtUtc, Status, TriggeredBy)
                VALUES ('CountrySync', UTC_TIMESTAMP(), 'Running', @By);
                SELECT LAST_INSERT_ID();",
                new { By = triggeredBy });
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Log row created — logId={logId}");
        }

        var added = new List<ClubChangeRow>();
        var removed = new List<ClubChangeRow>();
        var skippedDistrictMissing = new List<SkippedClubRow>();
        int errorCount = 0;
        int totalFetched = 0;

        try
        {
            // 1a. Fetch /clubs (authoritative sync list — high-priority source of truth).
            //     A club appearing here MUST be kept regardless of country search results.
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching authoritative /clubs list...");
            var syncClubs = await _api.GetClubsAsync(ct);
            var syncClubIds = new HashSet<string>(syncClubs.Select(x => x.ClubId.ToString()), StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   /clubs: {syncClubs.Count} authoritative sync clubs");

            // 1b. Fetch /Clubs/search for each country (supplementary — finds non-sync clubs).
            //     DYNAMIC country list = every ClubCountry in /clubs  ∪  every distinct Country of
            //     our own clubs. This covers all countries automatically — including Nepal (0 clubs
            //     in /clubs, so /clubs alone would miss it) and Taiwan (which the old hardcoded
            //     {India, Sri Lanka, Nepal} list missed entirely, so its ~1000 non-sync clubs were
            //     never added). New countries are picked up on their own. Mirrors ClubTerminator.
            var countrySet = new HashSet<string>(
                syncClubs.Select(c => c.ClubCountry?.Trim())
                         .Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!),
                StringComparer.OrdinalIgnoreCase);
            // DB countries come only from districts OUTSIDE "Other Zones": world clubs imported by the
            // manual --world-clubs mode must not grow this nightly list to ~180 countries. Countries
            // present in /clubs (e.g. Taiwan, Egypt) are still searched via the set above.
            await using (var ccConn = CreateConnection())
            {
                await ccConn.OpenAsync(ct);
                var dbCountries = await ccConn.QueryAsync<string>(@"
                    SELECT DISTINCT TRIM(cm.Country) FROM club_master cm
                    JOIN district_master d ON d.pk_district_id = cm.fk_district_id
                    LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                    WHERE cm.isdeleted = 0 AND IFNULL(cm.ROW_as_vendor_selected,0) = 1
                      AND cm.Country IS NOT NULL AND TRIM(cm.Country) <> ''
                      AND IFNULL(z.ZoneName,'') <> 'Other Zones'");
                foreach (var c in dbCountries) countrySet.Add(c);
            }
            var searchCountries = countrySet.OrderBy(s => s, StringComparer.OrdinalIgnoreCase).ToList();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Countries to search ({searchCountries.Count}): {string.Join(", ", searchCountries)}");

            var allFromRiOrg = new Dictionary<string, RotaryOrgClubSearchDto>(StringComparer.OrdinalIgnoreCase);
            foreach (var country in searchCountries)
            {
                ct.ThrowIfCancellationRequested();
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Fetching clubs for {country}...");
                var list = await _api.SearchClubsByCountryAsync(country, ct);
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   {country}: {list.Count} clubs");
                foreach (var c in list)
                {
                    var key = c.ClubId.ToString();
                    if (!allFromRiOrg.ContainsKey(key)) allFromRiOrg[key] = c;
                }
                totalFetched += list.Count;
            }
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Total unique clubs from /Clubs/search: {allFromRiOrg.Count}");

            // 1c. Combined authoritative set: a club is "still on Rotary.org" if it's in EITHER endpoint.
            //     This prevents accidentally deleting sync clubs that don't appear in country search
            //     (e.g., 214057 — present in /clubs but missing from search due to API filtering edge case).
            var allRiOrgIds = new HashSet<string>(syncClubIds, StringComparer.OrdinalIgnoreCase);
            foreach (var k in allFromRiOrg.Keys) allRiOrgIds.Add(k);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Combined authoritative set: {allRiOrgIds.Count} club IDs");

            await using var dbConn = CreateConnection();
            await dbConn.OpenAsync(ct);

            // 2. Load lookups
            var districts = (await dbConn.QueryAsync<(int pk_id, string districtNumber)>(
                "SELECT pk_district_id AS pk_id, DistrictNumber AS districtNumber FROM district_master WHERE isdeleted = 0"))
                // After --world-ensure, district_master can have duplicate DistrictNumber rows
                // (e.g., "2452" exists in USA + Mexico). GroupBy handles the dup by keeping
                // the lowest pk_id — typically the original Indian district when both exist.
                .GroupBy(x => x.districtNumber, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Min(x => x.pk_id), StringComparer.OrdinalIgnoreCase);
            var districtPkSet = new HashSet<int>(districts.Values);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {districts.Count} local districts");

            var existingByRotaryId = (await dbConn.QueryAsync<(int pk_id, string clubRotaryId, string clubName, int fk_district_id, int rowAsVendor, int isSynced)>(@"
                SELECT pk_club_id AS pk_id, ClubRotaryId AS clubRotaryId, ClubName AS clubName,
                       fk_district_id, IFNULL(ROW_as_vendor_selected, 0) AS rowAsVendor,
                       IFNULL(IsSyncedFromRotaryOrg, 0) AS isSynced
                FROM club_master
                WHERE isdeleted = 0 AND ClubRotaryId IS NOT NULL AND ClubRotaryId <> ''"))
                .ToDictionary(x => x.clubRotaryId, StringComparer.OrdinalIgnoreCase);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Loaded {existingByRotaryId.Count} existing clubs by ClubRotaryId");

            // 3. INSERT new non-sync clubs
            int insertedCount = 0;
            foreach (var (rotaryId, c) in allFromRiOrg)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    // --club-id filter: only consider the one ClubRotaryId when restricted.
                    if (onlyClubId != null && !string.Equals(rotaryId, onlyClubId, StringComparison.OrdinalIgnoreCase))
                        continue;

                    if (existingByRotaryId.ContainsKey(rotaryId))
                        continue;  // already in DB — skip (whether sync or non-sync)

                    if (!districts.TryGetValue(c.District ?? "", out var localDistrictPk))
                    {
                        // District not in DB → AUTO-CREATE with NO zone (fk_zone_id = 0); SuperAdmin
                        // assigns the zone later. Never bucket into "Other Zones". Only skip
                        // when Rotary.org gave no district number at all.
                        if (string.IsNullOrWhiteSpace(c.District))
                        {
                            skippedDistrictMissing.Add(new SkippedClubRow { ClubRotaryId = rotaryId, ClubName = c.ClubName ?? "", DistrictNumber = "", Reason = "Club has no District from Rotary.org" });
                            continue;
                        }
                        if (dryRun)
                        {
                            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [DRY RUN] would create district D{c.District} + insert club {rotaryId} ({c.ClubName})");
                            insertedCount++;
                            added.Add(new ClubChangeRow { ClubRotaryId = rotaryId, ClubName = c.ClubName ?? "", DistrictNumber = c.District ?? "" });
                            continue;
                        }
                        localDistrictPk = await dbConn.ExecuteScalarAsync<int>(@"
                            INSERT INTO district_master (DistrictNumber, fk_zone_id, Country, IsActive, created_date, isdeleted)
                            VALUES (@DistrictNumber, NULL, @Country, 1, NOW(), 0);   -- no zone yet (NULL, not 0 — FK fk_district_zone has no zone 0); SuperAdmin assigns later
                            SELECT LAST_INSERT_ID();",
                            new { DistrictNumber = c.District, Country = Truncate(c.Address?.Country ?? c.Location?.Country, 50) });
                        districts[c.District] = localDistrictPk;
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}]   + created district D{c.District} (no zone) id={localDistrictPk}");
                    }

                    var meetingFromTime = ParseTimeFromHHMM(c.Address?.MeetingTime);
                    var meetingAddress = Truncate(BuildMeetingAddress(c.Address), 500);
                    var country = Truncate(c.Address?.Country ?? c.Location?.Country, 50);
                    var state = Truncate(c.Address?.State ?? c.Location?.State, 50);
                    var city = Truncate(c.Address?.City, 100);
                    var postalCode = Truncate(c.Address?.PostalCode, 10);
                    var meetingDay = Truncate(c.Address?.MeetingDay, 10);
                    var clubName = Truncate(c.ClubName, 200);
                    var activeFrom = c.CharterDate;
                    var activeTo = c.CharterDate?.AddYears(70);

                    if (dryRun)
                    {
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [DRY RUN] would insert club {rotaryId} ({clubName}) into district D{c.District}");
                        insertedCount++;
                        added.Add(new ClubChangeRow { ClubRotaryId = rotaryId, ClubName = c.ClubName ?? "", DistrictNumber = c.District ?? "" });
                        continue;
                    }

                    await dbConn.ExecuteAsync(@"
                        INSERT INTO club_master (
                            fk_district_id, ClubRotaryId, ClubName, Timezone,
                            ClubCharterDate, MeetingDay, MeetingFromTime, MeetingAddress,
                            Country, State, City, Pincode,
                            ActiveFromDate, ActiveToDate,
                            IsAutomaticMeetingReminder, IsFamilyLogin, IsActive,
                            IsSyncedFromRotaryOrg, LastSyncedFromRotaryOrg,
                            ROW_as_vendor_selected, AddedByCountrySync,
                            created_date, isdeleted
                        ) VALUES (
                            @DistrictPk, @ClubRotaryId, @ClubName, @Tz,
                            @CharterDate, @MeetingDay, @MeetingFromTime, @MeetingAddress,
                            @Country, @State, @City, @PinCode,
                            @ActiveFrom, @ActiveTo,
                            1, 0, 1,
                            0, NOW(),
                            1, 1,
                            NOW(), 0
                        )",
                        new
                        {
                            Tz = RotaryApi.Services.Brand.DefaultTimeZone,   // ROW: the brand's zone (the original: Asia/Kolkata)
                            DistrictPk = localDistrictPk,
                            ClubRotaryId = rotaryId,
                            ClubName = clubName,
                            CharterDate = c.CharterDate,
                            MeetingDay = meetingDay,
                            MeetingFromTime = meetingFromTime,
                            MeetingAddress = meetingAddress,
                            Country = country,
                            State = state,
                            City = city,
                            PinCode = postalCode,
                            ActiveFrom = activeFrom,
                            ActiveTo = activeTo,
                        });
                    // Auto-assign default modules for the newly-inserted club
                    await ClubModuleHelper.AssignDefaultClubModulesAsync(dbConn);
                    insertedCount++;
                    added.Add(new ClubChangeRow
                    {
                        ClubRotaryId = rotaryId,
                        ClubName = c.ClubName ?? "",
                        DistrictNumber = c.District ?? "",
                    });
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    errorCount++;
                    _logger.LogError(ex, "Error inserting non-sync club {ClubId}", c.ClubId);
                }
            }
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Inserted {insertedCount} new non-sync clubs");

            // 4. NO soft-delete here. Terminations are owned exclusively by ClubTerminator
            //    (--terminate-clubs, and the audit in --club-reconcile): audit-first, safety
            //    threshold, full club-scoped cascade, covers BOTH sync AND non-sync clubs, and
            //    excludes the 3 manually-managed districts (5656 / 1280 / IFRM India). Country sync
            //    is therefore purely ADDITIVE — it inserts missing non-sync clubs and never deletes.
            //    (Previously this step auto-deleted non-sync clubs weekly with no audit and PROTECTED
            //    sync clubs — which broke the count for a genuinely-terminated sync club. ClubTerminator
            //    is the single, audited authority now.)
            int removedCount = 0;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Soft-delete skipped — terminations owned by ClubTerminator (audit-first). Country sync is insert-only.");

            // 5. District-wise counts (after sync) — only Rotary.org-tracked clubs (ROW_as_vendor_selected = 1)
            var districtCounts = (await dbConn.QueryAsync<(string districtNumber, int clubCount)>(@"
                SELECT d.DistrictNumber AS districtNumber, COUNT(*) AS clubCount
                FROM club_master cm
                JOIN district_master d ON d.pk_district_id = cm.fk_district_id
                WHERE cm.isdeleted = 0
                  AND cm.ROW_as_vendor_selected = 1
                  AND d.isdeleted = 0
                GROUP BY d.DistrictNumber
                ORDER BY d.DistrictNumber")).ToList();

            // 6. Finalize log (skipped on dry-run — no DB writes)
            if (!dryRun)
                await dbConn.ExecuteAsync(@"
                    UPDATE rotary_org_sync_log
                    SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Completed',
                        TotalFetched = @Total, InsertedCount = @Ins, DisabledCount = @Dis,
                        SkippedDistrictMissing = @Skip, ErrorCount = @Err
                    WHERE pk_id = @Id",
                    new
                    {
                        Id = logId,
                        Total = totalFetched,
                        Ins = insertedCount,
                        Dis = removedCount,
                        Skip = skippedDistrictMissing.Count,
                        Err = errorCount,
                    });

            var totalElapsed = DateTime.UtcNow - startedAt;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] === Country Sync DONE in {totalElapsed.TotalMinutes:F1} min ===");
            Console.WriteLine($"  Total rows fetched (raw, w/ dups): {totalFetched}");
            Console.WriteLine($"  Unique clubs (deduped):            {allFromRiOrg.Count}");
            Console.WriteLine($"  Authoritative (clubs ∪ search):    {allRiOrgIds.Count}");
            Console.WriteLine($"  Inserted (non-sync): {insertedCount}");
            Console.WriteLine($"  Removed (soft):      {removedCount}");
            Console.WriteLine($"  Skipped (no district): {skippedDistrictMissing.Count}");
            Console.WriteLine($"  Errors:              {errorCount}");
            Console.WriteLine($"  Districts with clubs: {districtCounts.Count}");

            if (dryRun)
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] [DRY RUN] complete — no rows written, no email sent. Would-insert: {insertedCount}.");
            else
                await SendEmailReportAsync(logId, totalFetched, allFromRiOrg.Count, allRiOrgIds.Count, insertedCount, removedCount,
                    skippedDistrictMissing.Count, errorCount, added, removed, skippedDistrictMissing, districtCounts);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] COUNTRY SYNC FAILED: {ex.Message}");
            _logger.LogError(ex, "Country sync FAILED");
            if (!dryRun && logId > 0)
            {
                try
                {
                    await using var conn = CreateConnection();
                    await conn.OpenAsync(CancellationToken.None);
                    await conn.ExecuteAsync(@"
                        UPDATE rotary_org_sync_log
                        SET FinishedAtUtc = UTC_TIMESTAMP(), Status = 'Failed', ErrorDetail = @Err
                        WHERE pk_id = @Id",
                        new { Id = logId, Err = ex.Message + "\n" + ex.StackTrace });
                }
                catch { }
            }
            throw;
        }
    }

    private async Task SendEmailReportAsync(
        int logId, int totalFetched, int uniqueClubs, int authoritativeUnion, int insertedCount, int removedCount,
        int skippedCount, int errorCount,
        List<ClubChangeRow> added, List<ClubChangeRow> removed, List<SkippedClubRow> skipped,
        List<(string districtNumber, int clubCount)> districtCounts)
    {
        try
        {
            // Build Excel
            using var workbook = new XLWorkbook();

            var summary = workbook.Worksheets.Add("Summary");
            summary.Cell(1, 1).Value = "Rotary.org Country Sync Report";
            summary.Range("A1:B1").Merge().Style.Font.SetBold().Font.SetFontSize(14);
            summary.Cell(3, 1).Value = "Log ID"; summary.Cell(3, 2).Value = logId;
            summary.Cell(4, 1).Value = "Total rows fetched (raw, w/ dups)"; summary.Cell(4, 2).Value = totalFetched;
            summary.Cell(5, 1).Value = "Unique clubs (deduped)"; summary.Cell(5, 2).Value = uniqueClubs;
            summary.Cell(6, 1).Value = "Authoritative (clubs ∪ search)"; summary.Cell(6, 2).Value = authoritativeUnion;
            summary.Cell(7, 1).Value = "New clubs added"; summary.Cell(7, 2).Value = insertedCount;
            summary.Cell(8, 1).Value = "Removed (soft-deleted)"; summary.Cell(8, 2).Value = removedCount;
            summary.Cell(9, 1).Value = "Skipped (district missing)"; summary.Cell(9, 2).Value = skippedCount;
            summary.Cell(10, 1).Value = "Errors"; summary.Cell(10, 2).Value = errorCount;
            summary.Columns().AdjustToContents();

            // District counts sheet
            var dc = workbook.Worksheets.Add("District Counts");
            dc.Cell(1, 1).Value = "District";
            dc.Cell(1, 2).Value = "Club Count";
            dc.Range(1, 1, 1, 2).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
            for (int i = 0; i < districtCounts.Count; i++)
            {
                dc.Cell(i + 2, 1).Value = "D" + districtCounts[i].districtNumber;
                dc.Cell(i + 2, 2).Value = districtCounts[i].clubCount;
            }
            dc.Cell(districtCounts.Count + 3, 1).Value = "TOTAL";
            dc.Cell(districtCounts.Count + 3, 1).Style.Font.SetBold();
            dc.Cell(districtCounts.Count + 3, 2).Value = districtCounts.Sum(x => x.clubCount);
            dc.Cell(districtCounts.Count + 3, 2).Style.Font.SetBold();
            dc.Columns().AdjustToContents();

            AddSimpleClubSheet(workbook, "Added", added);
            AddSimpleClubSheet(workbook, "Removed", removed);
            AddSkippedSheet(workbook, "Skipped (no district)", skipped);

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            var bytes = ms.ToArray();
            var fileName = $"RotaryOrg_CountrySync_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx";

            // HTML body
            var triggeredByName = _config["RotaryOrgSync:TriggeredByName"] ?? "Admin";

            var districtRows = string.Join("",
                districtCounts.Select(d =>
                    $"<tr><td style='padding:4px 12px;'>D{System.Net.WebUtility.HtmlEncode(d.districtNumber)}</td>" +
                    $"<td style='padding:4px 12px;text-align:right;'><b>{d.clubCount}</b></td></tr>"));

            string addedBlock = "";
            if (added.Count > 0)
            {
                var rows = string.Join("", added.Select((c, i) =>
                    $"<tr><td style='padding:2px 8px;color:#64748b;'>{i + 1}.</td>" +
                    $"<td style='padding:2px 8px;'>{System.Net.WebUtility.HtmlEncode(c.ClubName)}</td>" +
                    $"<td style='padding:2px 8px;color:#64748b;'>D{System.Net.WebUtility.HtmlEncode(c.DistrictNumber)}</td>" +
                    $"<td style='padding:2px 8px;color:#64748b;'>RID {System.Net.WebUtility.HtmlEncode(c.ClubRotaryId)}</td></tr>"));
                addedBlock = $@"<h3 style='color:#16a34a;margin-top:20px;'>New clubs added ({insertedCount})</h3>
<table style='border-collapse:collapse;margin:8px 0;font-size:14px;'>{rows}</table>";
            }

            string removedBlock = "";
            if (removed.Count > 0)
            {
                var rows = string.Join("", removed.Select((c, i) =>
                    $"<tr><td style='padding:2px 8px;color:#64748b;'>{i + 1}.</td>" +
                    $"<td style='padding:2px 8px;'>{System.Net.WebUtility.HtmlEncode(c.ClubName)}</td>" +
                    $"<td style='padding:2px 8px;color:#64748b;'>D{System.Net.WebUtility.HtmlEncode(c.DistrictNumber)}</td>" +
                    $"<td style='padding:2px 8px;color:#64748b;'>RID {System.Net.WebUtility.HtmlEncode(c.ClubRotaryId)}</td></tr>"));
                removedBlock = $@"<h3 style='color:#dc2626;margin-top:20px;'>Removed clubs ({removedCount})</h3>
<table style='border-collapse:collapse;margin:8px 0;font-size:14px;'>{rows}</table>";
            }

            int totalDistrictClubs = districtCounts.Sum(x => x.clubCount);
            var body = $@"<div style='font-family:Arial,sans-serif;'>
<h2 style='color:#1a365d;'>Rotary.org Country Sync</h2>
<p>Dear {System.Net.WebUtility.HtmlEncode(triggeredByName)},</p>
<p>Weekly country sync complete. Summary:</p>
<table style='border-collapse:collapse;margin:12px 0;'>
  <tr><td style='padding:4px 12px;'>Total rows fetched <span style='color:#94a3b8;font-size:12px;'>(raw, with duplicates)</span></td><td style='padding:4px 12px;'><b>{totalFetched}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Unique clubs <span style='color:#94a3b8;font-size:12px;'>(deduped)</span></td><td style='padding:4px 12px;'><b>{uniqueClubs}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Authoritative <span style='color:#94a3b8;font-size:12px;'>(clubs ∪ search)</span></td><td style='padding:4px 12px;'><b>{authoritativeUnion}</b></td></tr>
  <tr><td style='padding:4px 12px;'>New clubs added</td><td style='padding:4px 12px;color:#16a34a;'><b>{insertedCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Removed (soft-deleted)</td><td style='padding:4px 12px;color:#dc2626;'><b>{removedCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Skipped (district missing)</td><td style='padding:4px 12px;color:#64748b;'><b>{skippedCount}</b></td></tr>
  <tr><td style='padding:4px 12px;'>Errors</td><td style='padding:4px 12px;color:#dc2626;'><b>{errorCount}</b></td></tr>
</table>

<h3 style='color:#1a365d;margin-top:20px;'>District-wise club count (after sync)</h3>
<table style='border-collapse:collapse;margin:8px 0;font-size:14px;'>
<tr style='background-color:#f1f5f9;font-weight:bold;'>
  <td style='padding:6px 12px;'>District</td>
  <td style='padding:6px 12px;text-align:right;'>Clubs</td>
</tr>
{districtRows}
<tr style='background-color:#e0e7ff;font-weight:bold;'>
  <td style='padding:6px 12px;'>TOTAL</td>
  <td style='padding:6px 12px;text-align:right;'>{totalDistrictClubs}</td>
</tr>
</table>

{addedBlock}
{removedBlock}

<p style='color:#64748b;font-size:13px;'>Sync log id: {logId}. Removed clubs are soft-deleted (isdeleted=1) — recoverable if needed.</p>
<p>Regards,<br/><strong>Team ROW</strong></p>
</div>";

            await _emailSender.SendReportAsync($"[Weekly Sun] ROW Country Sync — {DateTime.Now:dd MMM yyyy}", body, bytes, fileName);
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email sent.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Country sync email FAILED");
            Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] Email failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Truncates a string to at most maxLen characters. Defensive against MySQL
    /// "Data too long for column" errors when Rotary.org sends values longer than
    /// our schema allows (e.g. international postal codes, long meeting addresses).
    /// </summary>
    private static string? Truncate(string? value, int maxLen)
    {
        if (value == null) return null;
        var trimmed = value.Trim();
        if (trimmed.Length == 0) return null;
        return trimmed.Length <= maxLen ? trimmed : trimmed.Substring(0, maxLen);
    }

    private static string? BuildMeetingAddress(RotaryOrgSearchAddressDto? addr)
    {
        if (addr == null) return null;
        var parts = new[] { addr.AddressLine1, addr.AddressLine2 }
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p!.Trim())
            .ToList();
        return parts.Count == 0 ? null : string.Join(", ", parts);
    }

    private static TimeSpan? ParseTimeFromHHMM(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        // Search endpoint returns "HHMM" like "1900". Parse manually.
        var s = raw.Trim();
        if (s.Length == 4 && int.TryParse(s, out _))
        {
            if (int.TryParse(s.Substring(0, 2), out var hh) &&
                int.TryParse(s.Substring(2, 2), out var mm) &&
                hh >= 0 && hh < 24 && mm >= 0 && mm < 60)
                return new TimeSpan(hh, mm, 0);
        }
        // Fallback to standard parser
        if (TimeSpan.TryParse(s, out var t) && t.TotalHours >= 0 && t.TotalHours < 24) return t;
        if (DateTime.TryParse(s, out var dt)) return dt.TimeOfDay;
        return null;
    }

    private static void AddSimpleClubSheet(XLWorkbook wb, string sheetName, List<ClubChangeRow> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "ClubRotaryId";
        ws.Cell(1, 2).Value = "ClubName";
        ws.Cell(1, 3).Value = "District";
        ws.Range(1, 1, 1, 3).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            ws.Cell(i + 2, 1).Value = rows[i].ClubRotaryId;
            ws.Cell(i + 2, 2).Value = rows[i].ClubName;
            ws.Cell(i + 2, 3).Value = "D" + rows[i].DistrictNumber;
        }
        ws.Columns().AdjustToContents();
    }

    private static void AddSkippedSheet(XLWorkbook wb, string sheetName, List<SkippedClubRow> rows)
    {
        var ws = wb.Worksheets.Add(sheetName);
        ws.Cell(1, 1).Value = "ClubRotaryId";
        ws.Cell(1, 2).Value = "ClubName";
        ws.Cell(1, 3).Value = "District (RI.org)";
        ws.Cell(1, 4).Value = "Reason";
        ws.Range(1, 1, 1, 4).Style.Font.SetBold().Fill.SetBackgroundColor(XLColor.LightGray);
        for (int i = 0; i < rows.Count; i++)
        {
            ws.Cell(i + 2, 1).Value = rows[i].ClubRotaryId;
            ws.Cell(i + 2, 2).Value = rows[i].ClubName;
            ws.Cell(i + 2, 3).Value = rows[i].DistrictNumber;
            ws.Cell(i + 2, 4).Value = rows[i].Reason;
        }
        ws.Columns().AdjustToContents();
    }

    private class ClubChangeRow
    {
        public string ClubRotaryId { get; set; } = "";
        public string ClubName { get; set; } = "";
        public string DistrictNumber { get; set; } = "";
    }

    private class SkippedClubRow
    {
        public string ClubRotaryId { get; set; } = "";
        public string ClubName { get; set; } = "";
        public string DistrictNumber { get; set; } = "";
        public string Reason { get; set; } = "";
    }
}
