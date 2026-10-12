using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Additive companion to ClubWebsitePublicDataController.
//
// This controller exists because the web-developer feedback (API-GAP-REPORT
// 2026-06-24) flagged two needs the original endpoints can't satisfy WITHOUT
// editing in-flight working code:
//
//   1. Banner + Advertisement image paths on the original endpoints point at
//      /uploads/banner/… and /uploads/advertisement/…, but on the live host
//      the actual files live at /Documents/WebsiteData/Group{clubId}/BANNERS/
//      and /Documents/WebsiteData/Group{clubId}/ADVERTISEMENT/. Hitting the
//      /uploads/* paths 404s. The v2 endpoints below return paths under the
//      correct /Documents/WebsiteData/… tree so the website renders images.
//
//   2. The home page "Impact" stat band needs totals (project_cost, man_hours,
//      direct_beneficiaries) that exist per-project but were never aggregated.
//      /v2/impact sums them for a club (and optionally a single year).
//
// Routes live under /api/public/club/{clubId}/v2/… so the original
// /api/public/club/{clubId}/banners, /…/advertisements, /…/projects remain
// untouched and continue to serve every existing consumer unchanged. The web
// developer can cut the website over to v2 at their pace.
[ApiController]
[Route("api/public/club")]
[AllowAnonymous]
public class ClubWebsitePublicDataV2Controller : ControllerBase
{
    private readonly string _connectionString;
    private readonly IYearTableResolver _yearTables;
    private readonly RotaryApi.Services.ICurrencyRateService _fx;

    public ClubWebsitePublicDataV2Controller(IConfiguration config, IYearTableResolver yearTables, RotaryApi.Services.ICurrencyRateService fx)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _yearTables = yearTables;
        _fx = fx;
    }

    private MySqlConnection CreateConn() => new(_connectionString);

    // Same kill-switch as the v1 controller — any inactive link in the
    // club → district → zone chain takes the public site offline.
    // Duplicated here intentionally to keep this controller self-contained
    // (the v1 helper is private and the additive-only rule forbids edits).
    private static async Task<bool> IsClubServiceableAsync(MySqlConnection conn, int clubId)
    {
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM club_websites w
            JOIN club_master c   ON c.pk_club_id      = w.fk_club_id
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z   ON z.pk_zone_id      = d.fk_zone_id
            WHERE w.fk_club_id = @ClubId
              AND w.isdeleted = 0
              AND c.isdeleted = 0 AND c.IsActive = 1
              AND d.isdeleted = 0 AND d.IsActive = 1
              AND z.isdeleted = 0 AND z.IsActive = 1",
            new { ClubId = clubId });
        return count > 0;
    }

    // Same year-default behaviour as the v1 controller: when caller doesn't
    // pass yearId, fall back to the current rotary year.
    private static async Task<int?> ResolveCurrentYearAsync(MySqlConnection conn)
    {
        return await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
    }

    // ── /v2/banners ──────────────────────────────────────────────────────
    //
    // Same source rows as /banners — same table, same filters — but the
    // returned BannerImagePath points under /Documents/WebsiteData/Group{clubId}/BANNERS/
    // so the image actually resolves on the live media host.
    //
    // The DB column (banner_image_path) generally stores the filename only,
    // but legacy rows may store a full leading-slash path. We:
    //   - leave full paths alone (LIKE '/%')
    //   - extract just the filename for everything else, then build the
    //     canonical /Documents/WebsiteData/Group{clubId}/BANNERS/ URL.
    public class BannerDto
    {
        public int Id { get; set; }
        public string? BannerImagePath { get; set; }
        public string? DocumentPath { get; set; }
        public string? LinkUrl { get; set; }
        public string? Description { get; set; }
        public int SortOrder { get; set; }
    }

    [HttpGet("{clubId:int}/v2/banners")]
    public async Task<ActionResult<IEnumerable<BannerDto>>> GetBannersV2(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var resolvedYearId = yearId ?? await ResolveCurrentYearAsync(conn);

        // SUBSTRING_INDEX(col, '/', -1) returns the last path segment, so a
        // stored "Banners…png" stays "Banners…png" and a stored
        // "/old/path/Banners…png" becomes "Banners…png" — both then prefixed
        // with the correct /Documents/WebsiteData/Group{clubId}/BANNERS/ folder.
        var rows = await conn.QueryAsync<BannerDto>(@"
            SELECT pk_club_website_banner_id AS Id,
                   CASE
                       WHEN banner_image_path IS NULL OR banner_image_path = '' THEN NULL
                       WHEN banner_image_path LIKE '/%' THEN banner_image_path
                       ELSE CONCAT('/Documents/WebsiteData/Group', @ClubId, '/BANNERS/',
                                   SUBSTRING_INDEX(banner_image_path, '/', -1))
                   END AS BannerImagePath,
                   CASE
                       WHEN document_path IS NULL OR document_path = '' THEN NULL
                       WHEN document_path LIKE '/%' THEN document_path
                       ELSE CONCAT('/Documents/WebsiteData/Group', @ClubId, '/BANNERS/',
                                   SUBSTRING_INDEX(document_path, '/', -1))
                   END AS DocumentPath,
                   link_url AS LinkUrl,
                   description AS Description,
                   sort_order  AS SortOrder
            FROM club_website_banner
            WHERE fk_club_id = @ClubId
              AND fk_year_id = @YearId
              AND (isdeleted = 0 OR isdeleted IS NULL)
              AND is_active = 1
            ORDER BY sort_order, pk_club_website_banner_id",
            new { ClubId = clubId, YearId = resolvedYearId ?? 0 });
        return Ok(rows);
    }

    // ── /v2/advertisements ───────────────────────────────────────────────
    //
    // Mirror of /v2/banners for the advertisement table. Both image and
    // document paths get the /Documents/WebsiteData/Group{clubId}/ADVERTISEMENT/
    // prefix (singular "ADVERTISEMENT" — confirmed by user 2026-06-24, matches
    // the legacy /uploads/advertisement/ singular form).
    public class AdvertisementDto
    {
        public int Id { get; set; }
        public string? AdvertisementImagePath { get; set; }
        public string? DocumentPath { get; set; }
        public string? LinkUrl { get; set; }
        public string? Description { get; set; }
        public int SortOrder { get; set; }
    }

    [HttpGet("{clubId:int}/v2/advertisements")]
    public async Task<ActionResult<IEnumerable<AdvertisementDto>>> GetAdvertisementsV2(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var resolvedYearId = yearId ?? await ResolveCurrentYearAsync(conn);

        var rows = await conn.QueryAsync<AdvertisementDto>(@"
            SELECT pk_club_website_advertisement_id AS Id,
                   CASE
                       WHEN advertisement_image_path IS NULL OR advertisement_image_path = '' THEN NULL
                       WHEN advertisement_image_path LIKE '/%' THEN advertisement_image_path
                       ELSE CONCAT('/Documents/WebsiteData/Group', @ClubId, '/ADVERTISEMENT/',
                                   SUBSTRING_INDEX(advertisement_image_path, '/', -1))
                   END AS AdvertisementImagePath,
                   CASE
                       WHEN document_path IS NULL OR document_path = '' THEN NULL
                       WHEN document_path LIKE '/%' THEN document_path
                       ELSE CONCAT('/Documents/WebsiteData/Group', @ClubId, '/ADVERTISEMENT/',
                                   SUBSTRING_INDEX(document_path, '/', -1))
                   END AS DocumentPath,
                   link_url AS LinkUrl,
                   description AS Description,
                   sort_order  AS SortOrder
            FROM club_website_advertisement
            WHERE fk_club_id = @ClubId
              AND fk_year_id = @YearId
              AND COALESCE(isdeleted, 0) = 0
              AND is_active = 1
            ORDER BY sort_order, pk_club_website_advertisement_id",
            new { ClubId = clubId, YearId = resolvedYearId ?? 0 });
        return Ok(rows);
    }

    // ── /v2/impact ───────────────────────────────────────────────────────
    //
    // Aggregate totals for the home-page Impact stat band. Sums three columns
    // that already exist per-project on the year-wise projects tables. The
    // website previously hardcoded these numbers; the report (A4) asked to
    // surface them from real data.
    //
    // Behaviour:
    //   - yearId supplied → sum from THAT year's table only (year-scoped impact).
    //   - yearId omitted  → sum across EVERY existing year-wise table
    //     (lifetime impact — what most clubs want on the home page).
    //
    // Filters match the public /projects endpoint exactly:
    //   isdeleted = 0  AND  is_active = 1
    //   AND approval_status IN ('', 'Approved')   (approved/blank only)
    //
    // TRF / Foundation USD comes from trf_contributions (single non-partitioned
    // table — separate aggregate from the project-table union below).
    public class ImpactDto
    {
        public int? YearId { get; set; }                       // null when lifetime totals
        public string? YearLabel { get; set; }                 // null when lifetime totals
        public int ProjectCount { get; set; }
        public decimal TotalProjectCost { get; set; }
        public string Currency { get; set; } = "INR";          // club's district DefaultCurrency — currency of TotalProjectCost
        public long TotalManHours { get; set; }
        public long TotalDirectBeneficiaries { get; set; }
        public decimal TotalTrfUsd { get; set; }               // sum of trf_contributions.AmountUSD — always USD, unrelated to Currency above
    }

    [HttpGet("{clubId:int}/v2/impact")]
    public async Task<ActionResult<ImpactDto>> GetImpactV2(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        // district_master.DefaultCurrency is backfilled to 'INR' for every district
        // (DatabaseInitializer), so this is never null in practice.
        var currency = await conn.ExecuteScalarAsync<string?>(@"
            SELECT d.DefaultCurrency
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id = @ClubId",
            new { ClubId = clubId }) ?? "INR";

        // Year-wise tables to scan. If yearId is given, that one table; else
        // every existing year-wise table (UNION ALL'd into a single SELECT so
        // we get the sums in a single round-trip).
        List<YearTableInfo> tables;
        string? yearLabel = null;
        if (yearId.HasValue && yearId.Value > 0)
        {
            var info = await _yearTables.ResolveByYearIdAsync(conn, yearId.Value);
            if (info == null)
            {
                // Year exists in the master but has no year-wise table yet — nothing to sum.
                return Ok(new ImpactDto { YearId = yearId, YearLabel = null, Currency = currency });
            }
            tables = new List<YearTableInfo> { info };
            yearLabel = info.YearLabel;
        }
        else
        {
            tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
        }

        if (tables.Count == 0) return Ok(new ImpactDto { YearId = yearId, YearLabel = yearLabel, Currency = currency });

        // One SELECT per year-wise table, UNION ALL'd. Outer aggregate sums
        // across all legs so we end up with one row regardless of how many
        // years are in play.
        // Count/sum the SAME set the public /v2/projects list shows — the 6 project
        // module keys, all types — so impact.projectCount stays consistent with the list.
        var legs = string.Join(" UNION ALL ", tables.Select(t => $@"
            SELECT COALESCE(p.project_cost, 0)         AS cost,
                   CONVERT(COALESCE(p.Currency, 'INR') USING utf8mb4) AS curr,
                   COALESCE(p.man_hours, 0)            AS hours,
                   COALESCE(p.direct_beneficiaries, 0) AS beneficiaries,
                   1 AS cnt
            FROM `{t.ProjectsTable}` p
            JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
            WHERE p.fk_club_id = @ClubId
              AND p.isdeleted  = 0
              AND p.is_active  = 1
              AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
              AND mm.ModuleKey IN ('community_service','vocational_service','international_service','new_generation_service','public_image_initiative','club_service')"));

        var row = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT SUM(CASE WHEN curr='USD' THEN cost ELSE 0 END) AS costUsd,
                   SUM(CASE WHEN curr='NPR' THEN cost ELSE 0 END) AS costNpr,
                   SUM(CASE WHEN curr='LKR' THEN cost ELSE 0 END) AS costLkr,
                   SUM(CASE WHEN curr NOT IN ('USD','NPR','LKR') THEN cost ELSE 0 END) AS costInr,
                   SUM(hours)         AS totalHours,
                   SUM(beneficiaries) AS totalBeneficiaries,
                   SUM(cnt)           AS projectCount
            FROM ({legs}) u",
            new { ClubId = clubId });

        // Convert each currency bucket into the club's district default currency.
        decimal totalCostConverted = 0m;
        if (row != null)
        {
            var rates = await _fx.GetInrRatesAsync();
            totalCostConverted =
                  RotaryApi.Services.CurrencyHelper.Convert(Convert.ToDecimal(row.costInr ?? 0m), "INR", currency, rates)
                + RotaryApi.Services.CurrencyHelper.Convert(Convert.ToDecimal(row.costUsd ?? 0m), "USD", currency, rates)
                + RotaryApi.Services.CurrencyHelper.Convert(Convert.ToDecimal(row.costNpr ?? 0m), "NPR", currency, rates)
                + RotaryApi.Services.CurrencyHelper.Convert(Convert.ToDecimal(row.costLkr ?? 0m), "LKR", currency, rates);
        }

        // TRF lives in a single non-partitioned table — separate aggregate.
        // Optional yearId filter scopes the sum; omitted → lifetime total.
        var trfSql = @"
            SELECT COALESCE(SUM(AmountUSD), 0) AS totalTrf
            FROM trf_contributions
            WHERE fk_club_id = @ClubId AND COALESCE(isdeleted, 0) = 0";
        var trfParams = new DynamicParameters();
        trfParams.Add("ClubId", clubId);
        if (yearId.HasValue && yearId.Value > 0)
        {
            trfSql += " AND fk_year_id = @YearId";
            trfParams.Add("YearId", yearId.Value);
        }
        var totalTrf = await conn.ExecuteScalarAsync<decimal>(trfSql, trfParams);

        return Ok(new ImpactDto
        {
            YearId                   = yearId,
            YearLabel                = yearLabel,
            ProjectCount             = row == null ? 0 : Convert.ToInt32(row.projectCount ?? 0L),
            TotalProjectCost         = totalCostConverted,
            Currency                 = currency,
            TotalManHours            = row == null ? 0L : Convert.ToInt64(row.totalHours ?? 0L),
            TotalDirectBeneficiaries = row == null ? 0L : Convert.ToInt64(row.totalBeneficiaries ?? 0L),
            TotalTrfUsd              = totalTrf,
        });
    }

    // ── /v2/years ────────────────────────────────────────────────────────
    //
    // The v1 /years endpoint UNIONs DISTINCT fk_year_id across board_of_directors,
    // year-wise projects, upcoming_events, AND past_presidents. On prod it 500s
    // with "Unknown column 'fk_year_id' in 'field list'" — one of those tables
    // (almost certainly past_presidents in some legacy schema) doesn't have the
    // column. This v2 queries each safe source SEPARATELY and merges in C#,
    // so a single bad source can't break the whole list.
    public class YearOptionDto
    {
        public int Id { get; set; }
        public string YearLabel { get; set; } = "";
        public bool IsCurrent { get; set; }
    }

    [HttpGet("{clubId:int}/v2/years")]
    public async Task<ActionResult<IEnumerable<YearOptionDto>>> GetYearsV2(int clubId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var yearIds = new HashSet<int>();

        // Source 1 — board_of_directors. Wrap in try/catch so a single bad
        // source can't 500 the whole endpoint (same defensive pattern below).
        try
        {
            foreach (var id in await conn.QueryAsync<int>(
                @"SELECT DISTINCT fk_year_id FROM board_of_directors
                  WHERE fk_club_id = @ClubId AND isdeleted = 0 AND fk_year_id > 0",
                new { ClubId = clubId }))
                yearIds.Add(id);
        }
        catch { /* skip if table missing column */ }

        // Source 2 — year-wise project tables. We KNOW each year table has
        // rows scoped to its own year (the year IS the table), so we just
        // probe each one for existence of any club row.
        try
        {
            var tables = await _yearTables.GetAllExistingYearTablesAsync(conn);
            foreach (var t in tables)
            {
                var hasAny = await conn.ExecuteScalarAsync<int>(
                    $"SELECT COUNT(*) FROM `{t.ProjectsTable}` WHERE fk_club_id = @ClubId AND isdeleted = 0 AND is_active = 1 LIMIT 1",
                    new { ClubId = clubId });
                if (hasAny > 0) yearIds.Add(t.YearId);
            }
        }
        catch { /* skip on schema mismatch */ }

        // Source 3 — upcoming_events.
        try
        {
            foreach (var id in await conn.QueryAsync<int>(
                @"SELECT DISTINCT fk_year_id FROM upcoming_events
                  WHERE fk_club_id = @ClubId AND isdeleted = 0 AND IsActive = 1 AND fk_year_id > 0",
                new { ClubId = clubId }))
                yearIds.Add(id);
        }
        catch { /* skip */ }

        // Source 4 — past_presidents (the suspected culprit of the v1 bug).
        // Try fk_year_id; if the column doesn't exist, silently skip.
        try
        {
            foreach (var id in await conn.QueryAsync<int>(
                @"SELECT DISTINCT fk_year_id FROM past_presidents
                  WHERE fk_club_id = @ClubId AND isdeleted = 0 AND fk_year_id > 0",
                new { ClubId = clubId }))
                yearIds.Add(id);
        }
        catch { /* expected to fail on legacy schemas — that's the whole point */ }

        if (yearIds.Count == 0) return Ok(Array.Empty<YearOptionDto>());

        // Look up labels + IsCurrent flag once.
        var rows = await conn.QueryAsync<YearOptionDto>(
            @"SELECT pk_year_id AS Id, YearLabel AS YearLabel, IsCurrent AS IsCurrent
              FROM rotary_year_master
              WHERE pk_year_id IN @Ids AND isdeleted = 0
              ORDER BY YearLabel DESC",
            new { Ids = yearIds });
        return Ok(rows);
    }

    // ── /v2/about ────────────────────────────────────────────────────────
    //
    // Same payload as v1 /about — but when caller omits yearId we default to
    // the current rotary year (single SELECT, no buggy multi-table resolver).
    // v1 /about (no yearId) → 500 because ResolveYearAsync hits the same broken
    // UNION as /years.
    public class AboutDto
    {
        public string ClubName { get; set; } = "";
        public string? DistrictNumber { get; set; }
        public string? ClubLogoPath { get; set; }
        // Rotary (upper) logo — stored on club_master.RotaryLogoPath as a bare
        // filename; rebuilt to the legacy public path /Documents/WebsiteData/Group{clubId}/LOGO/{file}
        // so the website can render it next to the club logo on the About page / header.
        public string? RotaryLogoPath { get; set; }
        public string? Content { get; set; }
        public List<ContactRow> Contacts { get; set; } = new();
        public List<SocialRow> Socials { get; set; } = new();
        public string? MeetingDay { get; set; }
        public string? MeetingFromTime { get; set; }
        public string? MeetingToTime { get; set; }
        public string? MeetingAddress { get; set; }
        public string? City { get; set; }
        public string? State { get; set; }
        public string? Pincode { get; set; }
        public decimal? Latitude { get; set; }
        public decimal? Longitude { get; set; }
        public string Currency { get; set; } = "INR";   // club's district DefaultCurrency
    }
    public class ContactRow { public int YearId { get; set; } public string Email { get; set; } = ""; public string Phone { get; set; } = ""; }
    public class SocialRow  { public string Platform { get; set; } = ""; public string LinkUrl { get; set; } = ""; }

    [HttpGet("{clubId:int}/v2/about")]
    public async Task<ActionResult<AboutDto>> GetAboutV2(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var resolvedYearId = yearId ?? await ResolveCurrentYearAsync(conn) ?? 0;

        var about = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT c.ClubName AS clubName, d.DistrictNumber AS districtNumber,
                   d.DefaultCurrency AS currency,
                   CASE
                       WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                       WHEN c.ClubLogoPath LIKE 'http%' THEN c.ClubLogoPath
                       WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                       ELSE CONCAT('/Documents/group/', c.ClubLogoPath)
                   END AS clubLogoPath,
                   CASE
                       WHEN c.RotaryLogoPath IS NULL OR c.RotaryLogoPath = '' THEN NULL
                       WHEN c.RotaryLogoPath LIKE 'http%' THEN c.RotaryLogoPath
                       WHEN c.RotaryLogoPath LIKE '/%' THEN c.RotaryLogoPath
                       ELSE CONCAT('/Documents/WebsiteData/Group', c.pk_club_id, '/LOGO/', c.RotaryLogoPath)
                   END AS rotaryLogoPath,
                   c.MeetingDay AS meetingDay,
                   TIME_FORMAT(c.MeetingFromTime, '%H:%i') AS meetingFromTime,
                   TIME_FORMAT(c.MeetingToTime, '%H:%i') AS meetingToTime,
                   c.MeetingAddress AS meetingAddress,
                   c.City AS city, c.State AS state, c.Pincode AS pincode,
                   c.Latitude AS latitude, c.Longitude AS longitude,
                   (SELECT a.content FROM club_website_about a
                      WHERE a.fk_club_id = c.pk_club_id
                        AND a.isdeleted = 0 AND a.is_active = 1
                      ORDER BY a.modified_date DESC, a.created_date DESC
                      LIMIT 1) AS content
            FROM club_master c
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            WHERE c.pk_club_id = @ClubId",
            new { ClubId = clubId, YearId = resolvedYearId });

        if (about == null) return NotFound();

        // Contacts are PURELY year-scoped — if the requested year has no rows,
        // return an empty list. NO fallback to another year (locked by user
        // 2026-06-26: contact for current year only; if admin hasn't set one,
        // the public site shows blank, not stale data from another year).
        var contacts = (await conn.QueryAsync<ContactRow>(@"
            SELECT fk_year_id AS YearId, email AS Email, phone AS Phone
            FROM club_website_contact_detail
            WHERE fk_club_id = @ClubId AND fk_year_id = @YearId
              AND isdeleted = 0 AND is_active = 1
            ORDER BY sort_order, pk_club_website_contact_detail_id",
            new { ClubId = clubId, YearId = resolvedYearId })).ToList();

        var socials = (await conn.QueryAsync<SocialRow>(@"
                SELECT platform AS Platform, link_url AS LinkUrl
                FROM club_website_social_link
                WHERE fk_club_id = @ClubId
                  AND isdeleted = 0 AND is_active = 1
                ORDER BY sort_order, pk_club_website_social_link_id",
                new { ClubId = clubId })).ToList();

        return Ok(new AboutDto
        {
            ClubName        = (string?)about.clubName ?? "",
            DistrictNumber  = (string?)about.districtNumber,
            ClubLogoPath    = (string?)about.clubLogoPath,
            RotaryLogoPath  = (string?)about.rotaryLogoPath,
            Content         = (string?)about.content,
            Contacts        = contacts,
            Socials         = socials,
            MeetingDay      = (string?)about.meetingDay,
            MeetingFromTime = (string?)about.meetingFromTime,
            MeetingToTime   = (string?)about.meetingToTime,
            MeetingAddress  = (string?)about.meetingAddress,
            City            = (string?)about.city,
            State           = (string?)about.state,
            Pincode         = (string?)about.pincode,
            Latitude        = (decimal?)about.latitude,
            Longitude       = (decimal?)about.longitude,
            Currency        = (string?)about.currency ?? "INR",
        });
    }

    // ── /v2/bod ──────────────────────────────────────────────────────────
    //
    // Same payload as v1 /bod — defaults yearId to current rotary year when
    // omitted to avoid the broken multi-table year resolver.
    public class BoardDirectorDto
    {
        public int Id { get; set; }
        public int MemberId { get; set; }
        public string MemberName { get; set; } = "";
        public string? ProfilePhotoPath { get; set; }
        public string Designation { get; set; } = "";
        public int? SortOrder { get; set; }
        public int? DesignationSortOrder { get; set; }
        public string? MemberIntroduction { get; set; }
    }

    [HttpGet("{clubId:int}/v2/bod")]
    public async Task<ActionResult<IEnumerable<BoardDirectorDto>>> GetBoardOfDirectorsV2(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var resolvedYearId = yearId ?? await ResolveCurrentYearAsync(conn) ?? 0;

        var rows = await conn.QueryAsync<BoardDirectorDto>(@"
            SELECT bd.pk_board_director_id AS Id,
                   bd.fk_member_master_profile_id AS MemberId,
                   m.MemberName AS MemberName,
                   CASE
                       WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                       WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                       ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                   END AS ProfilePhotoPath,
                   d.designation_name AS Designation,
                   bd.sort_order AS SortOrder,
                   d.sort_order AS DesignationSortOrder,
                   m.MemberIntroduction AS MemberIntroduction
            FROM board_of_directors bd
            JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
            JOIN designation_master d   ON d.pk_designation_id = bd.fk_designation_id
            WHERE bd.fk_club_id = @ClubId
              AND bd.fk_year_id = @YearId
              AND bd.isdeleted = 0
              AND m.isdeleted = 0
            ORDER BY
                CASE bd.fk_designation_id WHEN 1 THEN 0 WHEN 2 THEN 1 ELSE 2 END,
                COALESCE(bd.sort_order, 9999), d.sort_order, bd.pk_board_director_id",
            new { ClubId = clubId, YearId = resolvedYearId });
        return Ok(rows);
    }

    // ── /v2/gallery ──────────────────────────────────────────────────────
    //
    // v1 /gallery (no yearId) 500s with "Illegal mix of collations" because
    // year-wise project tables were created at different times with different
    // default collations and MySQL refuses to UNION columns of different
    // collations without an explicit CONVERT/COLLATE.
    //
    // v2 normalizes every text column to a single collation
    // (utf8mb4_general_ci) via CONVERT(... USING utf8mb4) so the UNION is
    // legal regardless of underlying table collation.
    public class GalleryPhotoDto
    {
        public int ProjectId { get; set; }
        public string ProjectTitle { get; set; } = "";
        public string ModuleKey { get; set; } = "";
        public string ModuleName { get; set; } = "";
        public string ImagePath { get; set; } = "";
        public bool IsPrimary { get; set; }
        public string? CreatedDate { get; set; }
    }

    public class GalleryPageDto
    {
        public int TotalCount { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
        public List<GalleryPhotoDto> Photos { get; set; } = new();
    }

    [HttpGet("{clubId:int}/v2/gallery")]
    public async Task<ActionResult<GalleryPageDto>> GetGalleryV2(
        int clubId,
        [FromQuery] int? yearId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 24)
    {
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 24;
        if (pageSize > 100) pageSize = 100;

        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        var tables = (yearId.HasValue && yearId.Value > 0)
            ? new List<YearTableInfo> { (await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)) }
                .Where(t => t != null).Cast<YearTableInfo>().ToList()
            : await _yearTables.GetAllExistingYearTablesAsync(conn);

        if (tables.Count == 0)
            return Ok(new GalleryPageDto { TotalCount = 0, Page = page, PageSize = pageSize });

        // CONVERT(... USING utf8mb4) coerces every text column to the same
        // collation so the UNION ALL across year tables with mixed collations
        // doesn't error. Wrapping each column individually is fine — MySQL
        // applies it before the UNION combine step.
        var unionLegs = string.Join(" UNION ALL ", tables.Select(t =>
        {
            var suffix = t.YearLabel.Replace("-", "_");
            return $@"SELECT p.pk_project_id AS ProjectId,
                             CONVERT(p.title USING utf8mb4)        AS ProjectTitle,
                             CONVERT(mm.ModuleKey USING utf8mb4)   AS ModuleKey,
                             CONVERT(mm.ModuleName USING utf8mb4)  AS ModuleName,
                             CONVERT(CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                                    CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                         ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                                    '/', ph.image_path) USING utf8mb4) AS ImagePath,
                             ph.is_primary   AS IsPrimary,
                             ph.created_date AS CreatedDate
                      FROM `{t.PhotosTable}` ph
                      JOIN `{t.ProjectsTable}` p ON p.pk_project_id = ph.fk_project_id
                      JOIN module_master mm     ON mm.pk_module_id = p.fk_module_id
                      WHERE p.fk_club_id = @ClubId
                        AND p.isdeleted = 0 AND p.is_active = 1
                        AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
                        AND ph.image_path IS NOT NULL AND ph.image_path <> ''";
        }));

        var totalCount = await conn.ExecuteScalarAsync<long>(
            $"SELECT COUNT(*) FROM ({unionLegs}) u",
            new { ClubId = clubId });

        var offset = (page - 1) * pageSize;
        var pageSql = $@"
            SELECT * FROM ({unionLegs}) u
            ORDER BY COALESCE(u.CreatedDate, '1900-01-01') DESC, u.IsPrimary DESC, u.ProjectId DESC
            LIMIT @PageSize OFFSET @Offset";

        var raw = await conn.QueryAsync<dynamic>(pageSql,
            new { ClubId = clubId, PageSize = pageSize, Offset = offset });

        var photos = raw.Select(r => new GalleryPhotoDto
        {
            ProjectId    = (int)r.ProjectId,
            ProjectTitle = (string?)r.ProjectTitle ?? "",
            ModuleKey    = (string?)r.ModuleKey ?? "",
            ModuleName   = (string?)r.ModuleName ?? "",
            ImagePath    = (string?)r.ImagePath ?? "",
            IsPrimary    = r.IsPrimary == null ? false : Convert.ToBoolean(r.IsPrimary),
            CreatedDate  = r.CreatedDate is DateTime cd ? cd.ToString("yyyy-MM-ddTHH:mm:ss") : null,
        }).ToList();

        return Ok(new GalleryPageDto
        {
            TotalCount = (int)totalCount,
            Page       = page,
            PageSize   = pageSize,
            Photos     = photos,
        });
    }

    // ── /v2/projects ─────────────────────────────────────────────────────
    //
    // Same data as v1 /projects but adds:
    //   • optional ?projectType=Ongoing|Onetime filter (used by the website's
    //     Community Service + Public Image Initiative listing filters; for
    //     other avenues the website hides the filter UI and omits the param)
    //   • projectType field on every row so the website can render badges and
    //     decide whether to show the filter UI
    //
    // moduleKey filter is optional too — when supplied, only that avenue is
    // returned. Same UNION-across-year-tables pattern as v1.
    public class V2ProjectDto
    {
        public int Id { get; set; }
        public int YearId { get; set; }
        public string YearLabel { get; set; } = "";
        public string ModuleKey { get; set; } = "";
        public string ModuleName { get; set; } = "";
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string? Location { get; set; }
        public string? ProjectDate { get; set; }
        public string? AreaOfFocus { get; set; }
        public string? Category { get; set; }
        public string? ProjectType { get; set; }     // "Ongoing" | "Onetime" | other
        public int? ParentProjectId { get; set; }    // null for main projects; set on repeat-instance children
        public int ChildCount { get; set; }          // # of repeat-instance children under this project
        public string? PrimaryPhotoPath { get; set; }
        public string Currency { get; set; } = "INR"; // this project's own stored currency (project.Currency)
        public string? CreatedDate { get; set; }
        public string? ModifiedDate { get; set; }
    }

    [HttpGet("{clubId:int}/v2/projects")]
    public async Task<ActionResult<IEnumerable<V2ProjectDto>>> GetProjectsV2(
        int clubId,
        [FromQuery] int? yearId,
        [FromQuery] string? projectType,
        [FromQuery] string? moduleKey)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsClubServiceableAsync(conn, clubId)) return NotFound();

        // Year tables to scan — same logic as v1
        List<YearTableInfo> tables = (yearId.HasValue && yearId.Value > 0)
            ? new List<YearTableInfo> { (await _yearTables.ResolveByYearIdAsync(conn, yearId.Value)) }
                .Where(t => t != null).Cast<YearTableInfo>().ToList()
            : await _yearTables.GetAllExistingYearTablesAsync(conn);
        if (tables.Count == 0) return Ok(Array.Empty<V2ProjectDto>());

        // Module-key filter: when caller supplies one, restrict to it; else all
        // 6 project module keys (community/vocational/international/newgen/
        // public-image/club-service).
        var moduleKeys = string.IsNullOrWhiteSpace(moduleKey)
            ? new[] { "community_service", "vocational_service", "international_service",
                      "new_generation_service", "public_image_initiative", "club_service" }
            : new[] { moduleKey };

        // Map user-friendly filter name → actual DB values.
        // DB stores: 'one_time', 'ongoing', 'ongoing_repeat' (lowercase + underscore).
        //   ?projectType=ongoing  → matches ONLY 'ongoing' (parent rows; 'ongoing_repeat'
        //                            are child sub-projects that should only appear nested
        //                            under the parent in the project-detail view).
        //   ?projectType=onetime  → matches 'one_time'.
        //   other / blank         → no type filter, BUT for Community Service +
        //                            Public Image Initiative we still exclude
        //                            'ongoing_repeat' from the listing per user
        //                            spec (children render only inside parent detail).
        string ptFilter = "";
        if (!string.IsNullOrWhiteSpace(projectType))
        {
            var pt = projectType.Trim().ToLowerInvariant().Replace("-", "_");
            if (pt == "ongoing" || pt == "ongoing_repeat")
            {
                ptFilter = " AND p.project_type = 'ongoing'";
            }
            else if (pt == "onetime" || pt == "one_time")
            {
                ptFilter = " AND p.project_type = 'one_time'";
            }
        }
        // No default project_type exclusion: ongoing projects (and their repeat
        // instances) are returned too. The caller distinguishes/groups them via
        // ParentProjectId + ChildCount below. Only an explicit ?projectType=
        // (handled above) narrows the list.

        var unionLegs = string.Join(" UNION ALL ", tables.Select(t =>
        {
            var suffix = t.YearLabel.Replace("-", "_");
            return $@"SELECT p.pk_project_id AS Id,
                             p.fk_year_id   AS YearId,
                             CONVERT('{t.YearLabel}' USING utf8mb4) AS YearLabel,
                             CONVERT(mm.ModuleKey USING utf8mb4)  AS ModuleKey,
                             CONVERT(mm.ModuleName USING utf8mb4) AS ModuleName,
                             CONVERT(p.title USING utf8mb4)       AS Title,
                             CONVERT(p.description USING utf8mb4) AS Description,
                             CONVERT(p.location USING utf8mb4)    AS Location,
                             p.project_date AS ProjectDate,
                             CONVERT(aof.name USING utf8mb4)      AS AreaOfFocus,
                             CONVERT(cat.name USING utf8mb4)      AS Category,
                             CONVERT(p.project_type USING utf8mb4) AS ProjectType,
                             CONVERT(p.Currency USING utf8mb4)    AS Currency,
                             p.parent_project_id AS ParentProjectId,
                             (SELECT COUNT(*) FROM `{t.ProjectsTable}` c
                               WHERE c.parent_project_id = p.pk_project_id AND c.isdeleted = 0) AS ChildCount,
                             CONVERT((SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                                       CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                                            ELSE CONCAT('{suffix}/Album', p.pk_project_id) END,
                                       '/', ph.image_path)
                              FROM `{t.PhotosTable}` ph
                              WHERE ph.fk_project_id = p.pk_project_id
                              ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id
                              LIMIT 1) USING utf8mb4) AS PrimaryPhotoPath,
                             p.created_date  AS CreatedDate,
                             p.modified_date AS ModifiedDate
                      FROM `{t.ProjectsTable}` p
                      JOIN module_master mm ON mm.pk_module_id = p.fk_module_id
                      LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
                      LEFT JOIN category_master cat ON cat.pk_category_id = p.fk_category_id
                      WHERE p.fk_club_id = @ClubId
                        AND p.isdeleted = 0 AND p.is_active = 1
                        AND (COALESCE(p.approval_status, '') = '' OR p.approval_status = 'Approved')
                        AND mm.ModuleKey IN @Keys{ptFilter}";
        }));

        var sql = $"SELECT * FROM ({unionLegs}) u ORDER BY COALESCE(u.ModifiedDate, u.CreatedDate) DESC, u.Id DESC";
        var raw = await conn.QueryAsync<dynamic>(sql,
            new { ClubId = clubId, Keys = moduleKeys });

        return Ok(raw.Select(r => new V2ProjectDto
        {
            Id               = (int)r.Id,
            YearId           = (int)r.YearId,
            YearLabel        = (string?)r.YearLabel ?? "",
            ModuleKey        = (string?)r.ModuleKey ?? "",
            ModuleName       = (string?)r.ModuleName ?? "",
            Title            = (string?)r.Title ?? "",
            Description      = (string?)r.Description,
            Location         = (string?)r.Location,
            ProjectDate      = r.ProjectDate is DateTime pd ? pd.ToString("yyyy-MM-dd") : null,
            AreaOfFocus      = (string?)r.AreaOfFocus,
            Category         = (string?)r.Category,
            ProjectType      = (string?)r.ProjectType,
            Currency         = (string?)r.Currency ?? "INR",
            ParentProjectId  = r.ParentProjectId == null ? (int?)null : Convert.ToInt32(r.ParentProjectId),
            ChildCount       = r.ChildCount == null ? 0 : Convert.ToInt32(r.ChildCount),
            PrimaryPhotoPath = (string?)r.PrimaryPhotoPath,
            CreatedDate      = r.CreatedDate is DateTime cd ? cd.ToString("yyyy-MM-ddTHH:mm:ss") : null,
            ModifiedDate     = r.ModifiedDate is DateTime md ? md.ToString("yyyy-MM-ddTHH:mm:ss") : null,
        }).ToList());
    }
}
