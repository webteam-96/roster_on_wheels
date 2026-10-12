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
    private async Task<bool> IsDistrictServiceableAsync(MySqlConnection conn, int districtId)
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
}
