using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

// Public (anonymous) read feed for the DISTRICT website — mirrors ClubWebsitePublicDataController
// but scoped by fk_district_id. District menus live in the SHARED club_website_menu /
// club_website_submenu tables tagged with fk_district_id = <district> and fk_club_id = 0 (see the
// admin CRUD in DistrictModulesController). This endpoint lets the district site render its menu
// dynamically instead of a static hard-coded list. Kill-switch aware: an inactive/soft-deleted
// district website (or an inactive district/zone) returns 404 so the public site goes dark.
[ApiController]
[Route("api/public/district")]
[AllowAnonymous]
public class DistrictWebsitePublicDataController : ControllerBase
{
    private readonly string _connectionString;

    public DistrictWebsitePublicDataController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConn() => new(_connectionString);

    // True only if the district has a live website row AND its district + zone are active.
    internal static async Task<bool> IsDistrictServiceableAsync(MySqlConnection conn, int districtId)
    {
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM district_websites w
            JOIN district_master d ON d.pk_district_id = w.fk_district_id
            JOIN zone_master z     ON z.pk_zone_id     = d.fk_zone_id
            WHERE w.fk_district_id = @DistrictId
              AND w.isdeleted = 0
              AND d.isdeleted = 0 AND d.IsActive = 1
              AND z.isdeleted = 0 AND z.IsActive = 1",
            new { DistrictId = districtId });
        return count > 0;
    }

    // ── Menus (8 default + custom) with sub-menus ──────────────────────────
    public class MenuDto
    {
        public int Id { get; set; }
        public string MenuName { get; set; } = "";
        public string LinkType { get; set; } = "page";   // 'page' | 'url' | 'html' | 'external' | 'document'
        public string LinkValue { get; set; } = "";
        public string? ContentHtml { get; set; }          // populated when LinkType='html'
        public bool IsDefault { get; set; }
        public int SortOrder { get; set; }
        public List<SubMenuDto> SubMenus { get; set; } = new();
    }
    public class SubMenuDto
    {
        public int Id { get; set; }
        public string SubMenuName { get; set; } = "";
        public string LinkType { get; set; } = "page";
        public string LinkValue { get; set; } = "";
        public int SortOrder { get; set; }
    }

    [HttpGet("{districtId:int}/menus")]
    public async Task<ActionResult<IEnumerable<MenuDto>>> GetMenus(int districtId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();

        // Document link_value is stored as a bare filename; the district admin GET serves it via
        // /uploads/menu/<file>, so match that here for parity.
        var menus = (await conn.QueryAsync<MenuDto>(@"
            SELECT pk_club_website_menu_id AS Id,
                   menu_name AS MenuName,
                   link_type AS LinkType,
                   CASE
                       WHEN link_value IS NULL OR link_value = '' THEN link_value
                       WHEN link_type = 'document'
                            AND link_value NOT LIKE '/%'
                            AND link_value NOT LIKE 'http%'
                            THEN CONCAT('/uploads/menu/', link_value)
                       ELSE link_value
                   END AS LinkValue,
                   content_html AS ContentHtml,
                   COALESCE(is_default, 0) AS IsDefault,
                   sort_order AS SortOrder
            FROM club_website_menu
            WHERE fk_district_id = @DistrictId
              AND fk_club_id = 0
              AND isdeleted = 0 AND is_active = 1
            ORDER BY sort_order, pk_club_website_menu_id",
            new { DistrictId = districtId })).ToList();

        foreach (var m in menus) m.ContentHtml = RotaryApi.Services.PublicHtml.Clean(m.ContentHtml);
        if (menus.Count == 0) return Ok(menus);

        var menuIds = menus.Select(m => m.Id).ToArray();
        var subs = await conn.QueryAsync<dynamic>(@"
            SELECT sm.pk_club_website_submenu_id AS id,
                   sm.fk_menu_id AS menuId,
                   sm.submenu_name AS submenuName,
                   sm.link_type AS linkType,
                   CASE
                       WHEN sm.link_value IS NULL OR sm.link_value = '' THEN sm.link_value
                       WHEN sm.link_type = 'document'
                            AND sm.link_value NOT LIKE '/%'
                            AND sm.link_value NOT LIKE 'http%'
                            THEN CONCAT('/uploads/menu/', sm.link_value)
                       ELSE sm.link_value
                   END AS linkValue,
                   sm.sort_order AS sortOrder
            FROM club_website_submenu sm
            WHERE sm.fk_menu_id IN @Ids
              AND sm.isdeleted = 0 AND sm.is_active = 1
            ORDER BY sm.sort_order, sm.pk_club_website_submenu_id",
            new { Ids = menuIds });

        var byMenu = subs
            .Select(s => new { MenuId = (int)s.menuId, Sub = new SubMenuDto
            {
                Id          = (int)s.id,
                SubMenuName = (string?)s.submenuName ?? "",
                LinkType    = (string?)s.linkType ?? "page",
                LinkValue   = (string?)s.linkValue ?? "",
                SortOrder   = (int)(s.sortOrder ?? 0),
            }})
            .GroupBy(x => x.MenuId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Sub).ToList());

        foreach (var m in menus)
            if (byMenu.TryGetValue(m.Id, out var list)) m.SubMenus = list;

        return Ok(menus);
    }

    // ── District Citation "Performance Index" ──────────────────────────────
    // For a district + year, return each citation category (district_citation_category)
    // with THIS district's clubs ranked by their points in that category. Points = auto +
    // manual club entries (points_earned + bonus_earned), mapped to the category via the
    // question → category link. Public read for the district website; kill-switch aware.
    [HttpGet("{districtId:int}/citation/performance")]
    public async Task<ActionResult> GetCitationPerformance(int districtId, [FromQuery] int yearId)
    {
        if (yearId <= 0) return BadRequest(new { message = "yearId is required." });
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();

        var district = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT DistrictNumber FROM district_master WHERE pk_district_id=@D", new { D = districtId });
        var yearLabel = await conn.ExecuteScalarAsync<string?>(
            "SELECT YearLabel FROM rotary_year_master WHERE pk_year_id=@Y", new { Y = yearId });

        var categories = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_id AS categoryId, category_name AS categoryName, sort_order AS sortOrder
            FROM district_citation_category
            WHERE fk_district_id=@D AND fk_year_id=@Y AND isdeleted=0
            ORDER BY sort_order, pk_id", new { D = districtId, Y = yearId })).ToList();

        var clubs = (await conn.QueryAsync<dynamic>(@"
            SELECT pk_club_id AS clubId, ClubName AS clubName, ClubRotaryId AS clubRotaryId
            FROM club_master WHERE fk_district_id=@D AND isdeleted=0", new { D = districtId }))
            .ToDictionary(c => (int)c.clubId, c => c);

        // Per-club, per-category points — auto + manual, keyed to the category via the question link.
        var entries = (await conn.QueryAsync<dynamic>(@"
            SELECT clubId, categoryId, SUM(score) AS points FROM (
                SELECT e.fk_club_id AS clubId, q.fk_category_id AS categoryId, (e.points_earned + e.bonus_earned) AS score
                FROM district_citation_club_entry e
                JOIN district_citation_auto_question q ON q.pk_id = e.fk_question_id
                     AND q.fk_district_id=@D AND q.fk_year_id=@Y AND q.isdeleted=0
                WHERE e.fk_district_id=@D AND e.fk_year_id=@Y AND e.entry_type='auto' AND e.isdeleted=0
                UNION ALL
                SELECT e.fk_club_id, mc.fk_category_id, (e.points_earned + e.bonus_earned)
                FROM district_citation_club_entry e
                JOIN district_citation_manual_sub_criteria sc ON sc.pk_id = e.fk_question_id AND sc.isdeleted=0
                JOIN district_citation_manual_criteria mc ON mc.pk_id = sc.fk_criteria_id
                     AND mc.fk_district_id=@D AND mc.fk_year_id=@Y AND mc.isdeleted=0
                WHERE e.fk_district_id=@D AND e.fk_year_id=@Y AND e.entry_type='manual' AND e.isdeleted=0
            ) t
            GROUP BY clubId, categoryId", new { D = districtId, Y = yearId })).ToList();

        var byCat = entries.Where(e => e.categoryId != null)
                           .GroupBy(e => (int)e.categoryId)
                           .ToDictionary(g => g.Key, g => g.ToList());

        var result = categories.Select(cat =>
        {
            int catId = (int)cat.categoryId;
            var rows = byCat.TryGetValue(catId, out var list) ? list : new List<dynamic>();
            var ranked = rows
                .Where(r => Convert.ToDecimal(r.points) > 0 && clubs.ContainsKey((int)r.clubId))
                .Select(r => new
                {
                    clubId = (int)r.clubId,
                    clubName = (string?)clubs[(int)r.clubId].clubName,
                    clubRotaryId = (string?)clubs[(int)r.clubId].clubRotaryId,
                    points = (long)Math.Round(Convert.ToDecimal(r.points)),
                })
                .OrderByDescending(x => x.points).ThenBy(x => x.clubName)
                .ToList();
            return new
            {
                categoryId = catId,
                categoryName = (string?)cat.categoryName,
                sortOrder = (int)(cat.sortOrder ?? 0),
                clubs = ranked,
            };
        }).ToList();

        return Ok(new { districtId, districtNumber = (string?)district?.DistrictNumber, yearId, yearLabel, categories = result });
    }

    // Available citation years for the district-website year dropdown (years that have categories).
    [HttpGet("{districtId:int}/citation/years")]
    public async Task<ActionResult> GetCitationYears(int districtId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT y.pk_year_id AS id, y.YearLabel AS label
            FROM rotary_year_master y
            WHERE y.pk_year_id IN (
                SELECT DISTINCT fk_year_id FROM district_citation_category
                WHERE fk_district_id=@D AND isdeleted=0)
            ORDER BY y.StartDate DESC", new { D = districtId });
        return Ok(years);
    }

    // ── District website pages (ROW, 2026-10-21) ───────────────────────────
    // Read-only and anonymous, so every query returns public fields only: names, photos, titles and dates of
    // office holders and events. No member lists, phone numbers or emails except the District Governor's office
    // email (as on the club website). Every route goes dark when the district website is off.

    private static Task<int?> CurrentYearAsync(MySqlConnection conn, int? yearId) => yearId.HasValue
        ? Task.FromResult(yearId)
        : conn.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");

    // Host → district, same lookup order as the club website: ClientDomain, then Subdomain FQDN, then its first label.
    [HttpGet("by-host")]
    public async Task<ActionResult> ResolveByHost([FromQuery] string? host)
    {
        var normalized = ClubWebsitePublicController.NormalizeHost(host);
        if (string.IsNullOrEmpty(normalized)) return NotFound();
        var cd = ClubWebsitePublicController.NormCol("w.ClientDomain");
        var sd = ClubWebsitePublicController.NormCol("w.Subdomain");
        using var conn = CreateConn();
        await conn.OpenAsync();
        var row = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT w.fk_district_id AS districtId, d.DistrictNumber AS districtNumber
            FROM district_websites w
            JOIN district_master d ON d.pk_district_id = w.fk_district_id
            JOIN zone_master z     ON z.pk_zone_id     = d.fk_zone_id
            WHERE w.isdeleted = 0 AND d.isdeleted = 0 AND d.IsActive = 1 AND z.isdeleted = 0 AND z.IsActive = 1
              AND ({cd} = @host OR {sd} = @host OR {sd} = @label)
            ORDER BY CASE WHEN {cd} = @host THEN 0 WHEN {sd} = @host THEN 1 ELSE 2 END, w.created_date DESC
            LIMIT 1",
            new { host = normalized, label = normalized.Split('.')[0] });
        return row == null ? NotFound() : Ok(new { districtId = (int)row.districtId, districtNumber = (string?)row.districtNumber });
    }

    // Header and footer data in one call: number, logo, current year, contacts and social links.
    [HttpGet("{districtId:int}/site")]
    public async Task<ActionResult> GetSite(int districtId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();
        var district = await conn.QueryFirstAsync<dynamic>(@"
            SELECT DistrictNumber AS districtNumber,
                   CASE WHEN DistrictLogoPath IS NULL OR DistrictLogoPath = '' THEN NULL
                        WHEN DistrictLogoPath LIKE '/%' THEN DistrictLogoPath
                        ELSE CONCAT('/uploads/district/', DistrictLogoPath) END AS logoPath
            FROM district_master WHERE pk_district_id = @D", new { D = districtId });
        var year = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT pk_year_id AS id, YearLabel AS label FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        int yearId = year == null ? 0 : (int)year.id;
        var contacts = await conn.QueryAsync<dynamic>(@"
            SELECT email, phone FROM club_website_contact_detail
            WHERE fk_district_id = @D AND fk_club_id = 0 AND fk_year_id = @Y AND isdeleted = 0 AND is_active = 1
            ORDER BY sort_order", new { D = districtId, Y = yearId });
        var social = await conn.QueryAsync<dynamic>(@"
            SELECT platform, link_url AS linkUrl FROM club_website_social_link
            WHERE fk_district_id = @D AND fk_club_id = 0 AND is_active = 1 AND COALESCE(isdeleted, 0) = 0
            ORDER BY sort_order", new { D = districtId });
        return Ok(new
        {
            districtId,
            districtNumber = (string?)district.districtNumber,
            logoPath = (string?)district.logoPath,
            yearId = year == null ? (int?)null : yearId,
            yearLabel = year == null ? null : (string?)year.label,
            contacts,
            socialLinks = social,
        });
    }

    // kind: "banners" or "advertisements" (district rows of the shared club website tables).
    [HttpGet("{districtId:int}/{kind:regex(^(banners|advertisements)$)}")]
    public async Task<ActionResult> GetImages(int districtId, string kind, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();
        var (table, idCol, imgCol, folder) = kind == "banners"
            ? ("club_website_banner", "pk_club_website_banner_id", "banner_image_path", "/uploads/banner/")
            : ("club_website_advertisement", "pk_club_website_advertisement_id", "advertisement_image_path", "/uploads/advertisement/");
        var rows = await conn.QueryAsync<dynamic>($@"
            SELECT {idCol} AS id,
                   CASE WHEN {imgCol} IS NULL OR {imgCol} = '' THEN NULL
                        WHEN {imgCol} LIKE '/%' THEN {imgCol}
                        ELSE CONCAT('{folder}', {imgCol}) END AS imagePath,
                   link_url AS linkUrl, description
            FROM {table}
            WHERE fk_district_id = @D AND fk_club_id = 0 AND fk_year_id = @Y
              AND is_active = 1 AND COALESCE(isdeleted, 0) = 0
            ORDER BY sort_order",
            new { D = districtId, Y = await CurrentYearAsync(conn, yearId) ?? 0 });
        return Ok(rows.Where(r => r.imagePath != null));
    }

    [HttpGet("{districtId:int}/about")]
    public async Task<ActionResult> GetAbout(int districtId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();
        var content = await conn.ExecuteScalarAsync<string?>(@"
            SELECT content FROM club_website_about
            WHERE fk_district_id = @D AND fk_club_id = 0 AND is_active = 1 AND COALESCE(isdeleted, 0) = 0
            ORDER BY modified_date DESC, created_date DESC, pk_club_website_about_id DESC LIMIT 1", new { D = districtId });
        return Ok(new { content = RotaryApi.Services.PublicHtml.Clean(content) });
    }

    // RI President and this district's Governor for the year.
    [HttpGet("{districtId:int}/dignitaries")]
    public async Task<ActionResult> GetDignitaries(int districtId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();
        var y = await CurrentYearAsync(conn, yearId) ?? 0;
        var president = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT p.Name AS name, p.Designation AS designation, p.Description AS description,
                   CASE WHEN p.ProfilePhotoPath IS NULL OR p.ProfilePhotoPath = '' THEN NULL
                        WHEN p.ProfilePhotoPath LIKE '/Documents/directory/%' THEN p.ProfilePhotoPath
                        ELSE CONCAT('/Documents/WebsiteData/International_President/', p.ProfilePhotoPath) END AS photoPath
            FROM international_president p WHERE p.fk_year_id = @Y AND p.isdeleted = 0 LIMIT 1", new { Y = y });
        var governor = await conn.QueryFirstOrDefaultAsync<dynamic>($@"
            SELECT {RotaryApi.Services.DistrictGovernorSql.Name}  AS name,
                   'District Governor'                             AS designation,
                   g.description                                   AS description,
                   {RotaryApi.Services.DistrictGovernorSql.Photo} AS photoPath,
                   {RotaryApi.Services.DistrictGovernorSql.Email} AS email
            FROM district_governors g
            {RotaryApi.Services.DistrictGovernorSql.JoinMember}
            WHERE g.fk_district_id = @D AND g.fk_year_id = @Y AND g.isdeleted = 0 LIMIT 1", new { D = districtId, Y = y });
        // descriptions are admin rich text
        if (president != null) president.description = RotaryApi.Services.PublicHtml.Clean((string?)president.description);
        if (governor != null) governor.description = RotaryApi.Services.PublicHtml.Clean((string?)governor.description);
        return Ok(new { president, governor });
    }

    public class CalendarEventDto
    {
        public int Id { get; set; }
        public string Title { get; set; } = "";
        public DateTime Date { get; set; }
        public string? Venue { get; set; }
        public string Source { get; set; } = "";
        public string? ClubName { get; set; }
    }

    // Calendar month: district events plus upcoming events published by the district's clubs (one query each,
    // not one per club).
    [HttpGet("{districtId:int}/events")]
    public async Task<ActionResult> GetEvents(int districtId, [FromQuery] int year, [FromQuery] int month,
        [FromServices] RotaryApi.Services.IYearTableResolver yearTables)
    {
        if (month < 1 || month > 12 || year < 2000 || year > 2100) return BadRequest(new { message = "Invalid month." });
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();
        var from = new DateTime(year, month, 1);
        var to = from.AddMonths(1);
        var events = new List<CalendarEventDto>();
        foreach (var t in await yearTables.GetAllExistingYearTablesAsync(conn))
            events.AddRange(await conn.QueryAsync<CalendarEventDto>($@"
                SELECT p.pk_project_id AS Id, p.title AS Title, p.project_date AS Date, p.location AS Venue,
                       'district' AS Source, NULL AS ClubName
                FROM `{t.ProjectsTable}` p
                WHERE p.fk_district_id = @D AND p.DistrictProjectType = 'Event' AND p.isdeleted = 0
                  AND p.project_date >= @From AND p.project_date < @To",
                new { D = districtId, From = from, To = to }));
        events.AddRange(await conn.QueryAsync<CalendarEventDto>(@"
            SELECT e.pk_upcoming_event_id AS Id, e.Title AS Title, e.EventDate AS Date, e.EventVenue AS Venue,
                   'club' AS Source, c.ClubName AS ClubName
            FROM upcoming_events e
            JOIN club_master c ON c.pk_club_id = e.fk_club_id
            WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
              AND e.isdeleted = 0 AND e.IsActive = 1 AND e.PublishDate <= NOW()
              AND e.EventDate >= @From AND e.EventDate < @To",
            new { D = districtId, From = from, To = to }));
        return Ok(events.OrderBy(e => e.Date));
    }

    // variant "governor": the district's own newsletters; "club": newsletters of the district's clubs.
    [HttpGet("{districtId:int}/newsletters")]
    public async Task<ActionResult> GetNewsletters(int districtId, [FromQuery] string variant = "governor", [FromQuery] int? yearId = null)
    {
        if (variant != "governor" && variant != "club") return BadRequest(new { message = "Unknown variant." });
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();
        var scope = variant == "governor"
            ? "n.fk_district_id = @D AND COALESCE(n.fk_club_id, 0) = 0"
            : "n.fk_club_id IN (SELECT pk_club_id FROM club_master WHERE fk_district_id = @D AND isdeleted = 0 AND IsActive = 1)";
        var rows = await conn.QueryAsync<dynamic>($@"
            SELECT n.pk_newsletter_id AS id, n.Title AS title, n.PublishDateTime AS publishedAt,
                   CASE WHEN n.FilePath IS NULL OR n.FilePath = '' THEN NULL
                        WHEN n.FilePath LIKE '/%' THEN n.FilePath
                        WHEN n.fk_district_id IS NOT NULL AND n.fk_district_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_district_id, '/', n.FilePath)
                        WHEN n.fk_club_id IS NOT NULL AND n.fk_club_id > 0 THEN CONCAT('/Documents/ebulletin/Group', n.fk_club_id, '/', n.FilePath)
                        ELSE NULL END AS filePath,
                   n.LinkUrl AS linkUrl,
                   (SELECT ClubName FROM club_master WHERE pk_club_id = n.fk_club_id) AS clubName
            FROM newsletters n
            WHERE {scope} AND COALESCE(n.isdeleted, 0) = 0
              AND n.PublishDateTime <= NOW()
              AND (n.ExpiryDateTime IS NULL OR n.ExpiryDateTime <= n.PublishDateTime OR n.ExpiryDateTime >= NOW())
              AND (@Y IS NULL OR n.fk_year_id = @Y)
            ORDER BY n.PublishDateTime DESC LIMIT 60",
            new { D = districtId, Y = yearId });
        return Ok(rows);
    }

    // District committee for the year: groups with their members (name, title, club, photo).
    [HttpGet("{districtId:int}/committee")]
    public async Task<ActionResult> GetCommittee(int districtId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();
        var y = await CurrentYearAsync(conn, yearId) ?? 0;
        var groups = (await conn.QueryAsync<(int Id, string Name)>(@"
            SELECT id, group_name FROM district_committee_group
            WHERE fk_district_id = @D AND fk_year_id = @Y AND is_active = 1 AND isdeleted = 0
            ORDER BY sort_order, id", new { D = districtId, Y = y })).ToList();
        if (groups.Count == 0) return Ok(Array.Empty<object>());
        var members = (await conn.QueryAsync<(int GroupId, string? Name, string? Designation, string? ClubName, string? PhotoPath)>(@"
            SELECT gm.fk_group_id,
                   CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 THEN m.MemberName ELSE gm.name END,
                   gm.district_designation,
                   CASE WHEN COALESCE(gm.fk_member_id, 0) > 0 THEN c.ClubName ELSE gm.club_name END,
                   CASE
                       WHEN COALESCE(gm.fk_member_id, 0) > 0 AND m.ProfilePhotoPath IS NOT NULL AND m.ProfilePhotoPath <> '' THEN
                            CASE WHEN m.ProfilePhotoPath LIKE '/%' OR m.ProfilePhotoPath LIKE 'http%' THEN m.ProfilePhotoPath
                                 ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END
                       WHEN COALESCE(gm.fk_member_id, 0) > 0 THEN NULL
                       WHEN gm.profile_photo IS NULL OR gm.profile_photo = '' THEN NULL
                       WHEN gm.profile_photo LIKE '/%' THEN gm.profile_photo
                       ELSE CONCAT('/Documents/DistrictCommittee/Group', COALESCE(gm.fk_club_id, 0), '/', gm.profile_photo)
                   END
            FROM district_committee_group_member gm
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = gm.fk_member_id AND m.isdeleted = 0
            LEFT JOIN club_master c ON c.pk_club_id = gm.fk_club_id
            WHERE gm.fk_group_id IN @Ids AND gm.is_active = 1 AND gm.isdeleted = 0
            ORDER BY gm.sort_order, gm.id", new { Ids = groups.Select(g => g.Id).ToArray() })).ToList();
        return Ok(groups.Select(g => new
        {
            id = g.Id,
            name = g.Name,
            members = members.Where(m => m.GroupId == g.Id)
                .Select(m => new { name = m.Name, designation = m.Designation, clubName = m.ClubName, photoPath = m.PhotoPath }),
        }));
    }

    // Club finder: the district's active clubs with their meeting details and club website, if any.
    [HttpGet("{districtId:int}/clubs")]
    public async Task<ActionResult> GetClubs(int districtId, [FromQuery] string? search)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id AS id, c.ClubName AS name, c.ClubType AS clubType, c.City AS city,
                   c.MeetingDay AS meetingDay,
                   TIME_FORMAT(c.MeetingFromTime, '%H:%i') AS meetingFrom, TIME_FORMAT(c.MeetingToTime, '%H:%i') AS meetingTo,
                   c.MeetingAddress AS meetingAddress,
                   (SELECT COALESCE(NULLIF(w.ClientDomain, ''), w.Subdomain) FROM club_websites w
                    WHERE w.fk_club_id = c.pk_club_id AND w.isdeleted = 0 ORDER BY w.created_date DESC LIMIT 1) AS website
            FROM club_master c
            WHERE c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
              AND (@Q IS NULL OR c.ClubName LIKE CONCAT('%', @Q, '%') OR c.City LIKE CONCAT('%', @Q, '%'))
            ORDER BY c.ClubName",
            new { D = districtId, Q = string.IsNullOrWhiteSpace(search) ? null : search.Trim() });
        return Ok(rows);
    }

    // One club's board for the year (office holders are public; the member list is not).
    [HttpGet("{districtId:int}/clubs/{clubId:int}/board")]
    public async Task<ActionResult> GetClubBoard(int districtId, int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        if (!await IsDistrictServiceableAsync(conn, districtId)) return NotFound();
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT m.MemberName AS name, d.designation_name AS designation,
                   CASE WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1)) END AS photoPath
            FROM board_of_directors bd
            JOIN club_master c ON c.pk_club_id = bd.fk_club_id
            JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
            JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
            WHERE bd.fk_club_id = @C AND c.fk_district_id = @D AND c.isdeleted = 0 AND c.IsActive = 1
              AND bd.fk_year_id = @Y AND bd.isdeleted = 0 AND m.isdeleted = 0
            ORDER BY d.sort_order, bd.sort_order",
            new { C = clubId, D = districtId, Y = await CurrentYearAsync(conn, yearId) ?? 0 });
        return Ok(rows);
    }
}
