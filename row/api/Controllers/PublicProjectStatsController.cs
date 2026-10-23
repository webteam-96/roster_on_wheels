using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Public, unauthenticated aggregation API for the main-site "Projects" surface.
// Consumed by the (site) landing pages via src/lib/projectStats.ts + src/lib/projectsBrowse.ts
// (through the same-origin /api/rotary/* proxy). Aggregates across the year-partitioned
// rotary_projects_YYYY_YY tables, applying the canonical public filter and the projects-only
// avenue set (club_service excluded — that's "meetings"). All routes [AllowAnonymous].
[ApiController]
[Route("api/public/project-stats")]
[AllowAnonymous]
public class PublicProjectStatsController : ControllerBase
{
    private readonly string _connStr;
    private readonly IYearTableResolver _years;
    private readonly ICurrencyRateService _fx;
    private readonly IProjectCountRules _rules;

    public PublicProjectStatsController(IConfiguration config, IYearTableResolver years,
        ICurrencyRateService fx, IProjectCountRules rules)
    {
        _connStr = config.GetConnectionString("DefaultConnection")!;
        _years = years;
        _fx = fx;
        _rules = rules;
    }

    private MySqlConnection CreateConn() => new(_connStr);

    // Per-currency cost buckets computed in a single scan; summed into one total in C#
    // (in the brand's default currency). Selected in place of SUM(u.ProjectCost).
    // ROW (as the NestJS edition): one cost bucket per brand currency plus "other", each converted into the
    // brand's default currency (the original platform: fixed INR / USD / NPR / LKR buckets, everything else counted as INR).
    private static IEnumerable<string> BucketCurrencies =>
        Brand.Currencies.Select(c => c.Trim().ToUpperInvariant()).Where(c => System.Text.RegularExpressions.Regex.IsMatch(c, "^[A-Z]{3}$")).Distinct();

    private static string CostBuckets
    {
        get
        {
            var cs = BucketCurrencies.ToList();
            var parts = cs.Select(c => $"COALESCE(SUM(CASE WHEN u.Currency='{c}' THEN u.ProjectCost ELSE 0 END),0) AS `cost_{c}`").ToList();
            var other = cs.Count > 0 ? $"u.Currency NOT IN ({string.Join(",", cs.Select(c => $"'{c}'"))}) OR u.Currency IS NULL" : "1=1";
            parts.Add($"COALESCE(SUM(CASE WHEN {other} THEN u.ProjectCost ELSE 0 END),0) AS cost__other");
            return string.Join(",\n                   ", parts);
        }
    }

    /// <summary>A row's cost buckets as one amount in the brand's default currency ("other" is taken as already in it).</summary>
    private static decimal ToDefaultCost(object row, IReadOnlyDictionary<string, decimal> rates)
    {
        var d = (IDictionary<string, object?>)row;
        decimal Val(string k) => d.TryGetValue(k, out var v) && v is not null and not DBNull ? Convert.ToDecimal(v) : 0m;
        return BucketCurrencies.Aggregate(Val("cost__other"), (sum, c) => sum + CurrencyHelper.Convert(Val($"cost_{c}"), c, Brand.DefaultCurrency, rates));
    }

    private async Task<decimal> ToInrCostAsync(dynamic row) => ToDefaultCost((object)row, await _fx.GetInrRatesAsync());

    // The 5 project avenues (club_service is a meeting, excluded from the projects feed) and
    // the club → district → zone chain. BOTH come from ProjectCountFilter, which is also what
    // the daily statistics email counts with — that shared definition is the only reason the
    // two numbers agree (user, 2026-09-28). Rule 3 lives in there too: Zone 0, "Other Zones"
    // and the three exempt districts are outside the organisation and count nowhere.
    private const string ProjectModuleKeys = ProjectCountFilter.ProjectModuleKeys;

    private static readonly string Geo = ProjectCountFilter.Geo("u.ClubId");

    // The relevant year tables: just the requested year, or every existing year.
    private async Task<List<YearTableInfo>> YearTablesAsync(MySqlConnection conn, int? yearId)
    {
        var all = await _years.GetAllExistingYearTablesAsync(conn);
        return yearId is > 0 ? all.Where(x => x.YearId == yearId.Value).ToList() : all;
    }

    // Free-text predicate, built ONCE and referenced by every union leg (the @Qn / @Rn
    // parameters are shared). It sits INSIDE each leg rather than on the finished union.
    //
    // Measured, so nobody re-does this hoping for more: moving the predicate inside
    // the legs took the all-years listing from 10.6s to ~9.5s. Modest, because MySQL
    // was already pushing most of it down. The real cost is the ~27-table union
    // itself — the same listing takes 25.5s with NO search at all, and 1.1s when
    // scoped to a single year. Scope beats predicate placement by 10x.
    //
    // Every word must be a WHOLE word (a plural "s" allowed), any order, of ONE of: the
    // project title, its area of focus (master name or the "other" text), or its club's name,
    // state or district number. So "right to go thane" finds RIGHT TO GO by Thane Hills.
    // Whole words, not substrings — substrings are what made "heart surgery" list
    // "Heartline Surgery". One- and two-letter words ("to", "of") match the title only;
    // against the master names they matched half the list.
    //
    // The matching master-table ids are looked up ONCE here and inlined (they are ints
    // read from the database), rather than left as IN (subquery) in every union leg:
    // measured over all years, that is ~1.4x the title-only search instead of ~2.6x.
    // The SQL is identical for every bag passed in; each bag gets its own @Qn/@Rn.
    private static async Task<string> SearchSqlAsync(MySqlConnection conn, string? q, params DynamicParameters[] bags)
    {
        if (string.IsNullOrWhiteSpace(q)) return "";
        // Split on anything that is not a letter or digit, mirroring the client's
        // /[^\p{L}\p{N}]+/u — so every word is plain alphanumerics and is safe to drop
        // into the REGEXP below without escaping.
        // Apostrophes are dropped first: "children's" is one word, not "children" + "s".
        var words = System.Text.RegularExpressions.Regex.Split(
                q.ToLowerInvariant().Replace("'", "").Replace("’", ""), @"[^\p{L}\p{N}]+")
            .Where(w => w.Length > 0)
            .Take(MaxSearchWords)
            .ToArray();
        // Only punctuation ("---"): match nothing, rather than no filter at all.
        if (words.Length == 0) return " AND 1 = 0";
        var sb = new System.Text.StringBuilder();
        for (int i = 0; i < words.Length; i++)
        {
            // Drop ONE trailing "s" so "donations" reaches "Blood Donation Camp" —
            // but never from a word ending in "ss", where the s is part of the word,
            // not a plural. Without that guard "mass" searched for "mas" and "class"
            // for "clas". (TrimEnd('s'), which this replaced, was worse still: it
            // stripped EVERY trailing s, so "ssss" became "" — LIKE '%%', matching
            // every project while calling itself a search.)
            // Mirrored exactly in the client: see universalSearch.check.mjs.
            var raw = words[i];
            var w = raw.Length > 3 && raw.EndsWith('s') && !raw.EndsWith("ss") ? raw[..^1] : raw;
            var like = $"%{EscapeLike(w)}%";
            var regex = $@"(?i)(^|[^\p{{L}}\p{{N}}]){w}s?([^\p{{L}}\p{{N}}]|$)";
            foreach (var b in bags) { b.Add($"Q{i}", like); b.Add($"R{i}", regex); }
            // The LIKE is a cheap pre-filter so REGEXP only runs on text that contains it.
            var title = $"(p.title LIKE @Q{i} AND p.title REGEXP @R{i})";
            if (raw.Length < 3) { sb.Append($@"
              AND {title}"); continue; }

            var lp = new { R = regex, W = raw };
            async Task<string> Ids(string sql) =>
                string.Join(",", await conn.QueryAsync<long>(sql, lp)) is { Length: > 0 } list ? list : "NULL";
            var areas = await Ids("SELECT pk_area_of_focus_id FROM area_of_focus_master WHERE name REGEXP @R");
            var clubs = await Ids(@"SELECT sc.pk_club_id FROM club_master sc
                JOIN district_master sd ON sd.pk_district_id = sc.fk_district_id
                WHERE sc.isdeleted = 0 AND sc.IsActive = 1
                  AND (sc.ClubName REGEXP @R OR sc.State REGEXP @R OR sd.DistrictNumber = @W)");
            sb.Append($@"
              AND ({title}
                OR p.fk_area_of_focus_id IN ({areas})
                OR (p.other_area_of_focus LIKE @Q{i} AND p.other_area_of_focus REGEXP @R{i})
                OR p.fk_club_id IN ({clubs}))");
        }
        return sb.ToString();
    }

    // Leading ORDER BY key for a search: the exact title first, then titles containing the
    // query as a phrase, then the rest (the caller's date order applies within each).
    // Mirrored in ProjectsHub.tsx searchRank() — see universalSearch.check.mjs.
    private static string SearchRankSql(string? q, DynamicParameters p)
    {
        if (string.IsNullOrWhiteSpace(q)) return "";
        var phrase = q.Trim().ToLowerInvariant();
        p.Add("QExact", phrase);
        p.Add("QPhrase", $"%{EscapeLike(phrase)}%");
        return "CASE WHEN LOWER(TRIM(u.Title)) = @QExact THEN 0 WHEN LOWER(u.Title) LIKE @QPhrase THEN 1 ELSE 2 END, ";
    }

    // One UNION-ALL leg per year table (public filter + avenue set baked in).
    private static string Leg(ProjectCountFilter f, YearTableInfo t, bool withPhoto, string search = "")
    {
        var suffix = t.YearLabel.Replace("-", "_");
        var photo = withPhoto ? $@",
               CONVERT((SELECT CONCAT('/Documents/gallery/Group', p.fk_club_id, '/',
                        CASE WHEN p.old_pk IS NOT NULL THEN CONCAT('Album', p.old_pk)
                             ELSE CONCAT('{suffix}/Album', p.pk_project_id) END, '/', ph.image_path)
                FROM `{t.PhotosTable}` ph WHERE ph.fk_project_id = p.pk_project_id
                ORDER BY ph.is_primary DESC, ph.sort_order, ph.pk_photo_id LIMIT 1) USING utf8mb4) AS PrimaryPhoto" : "";
        return $@"
            SELECT p.pk_project_id AS Id, p.fk_year_id AS YearId, '{t.YearLabel}' AS YearLabel,
                   CONVERT(p.title USING utf8mb4) AS Title, p.project_date AS ProjectDate,
                   COALESCE(p.project_cost, 0) AS ProjectCost,
                   CONVERT(COALESCE(p.Currency, '{RotaryApi.Services.Brand.SqlCurrency}') USING utf8mb4) AS Currency,
                   COALESCE(p.direct_beneficiaries, 0) AS DirectBeneficiaries,
                   COALESCE(p.man_hours, 0) AS ManHours, COALESCE(p.rotarians_involved, 0) AS Rotarians,
                   COALESCE(p.fk_area_of_focus_id, 0) AS AreaId,
                   CONVERT(COALESCE(NULLIF(aof.name,''), NULLIF(p.other_area_of_focus,''), 'Uncategorised') USING utf8mb4) AS AreaName,
                   p.fk_club_id AS ClubId{photo}
            FROM `{t.ProjectsTable}` p
            JOIN module_master mm ON mm.pk_module_id = p.fk_module_id AND mm.ModuleKey IN ({ProjectModuleKeys})
            LEFT JOIN area_of_focus_master aof ON aof.pk_area_of_focus_id = p.fk_area_of_focus_id
            WHERE {f.CountsAsProject(t.ProjectsTable)}{search}";
              // Every rule is in ProjectCountFilter.CountsAsProject: live row and ONE
              // row per project — the ongoing parent, or, when the parent belongs to an
              // earlier year, that project's first entry of this year. An ongoing project's
              // repeat entries are what used to inflate the statistics email, and dropping
              // the parent along with them is what used to deflate this page.
    }

    private static string Union(ProjectCountFilter f, List<YearTableInfo> tables, bool withPhoto, string search = "")
        => "(" + string.Join("\nUNION ALL\n", tables.Select(t => Leg(f, t, withPhoto, search))) + ") u";

    // At most this many words from a free-text query reach the SQL. Each one adds its own
    // predicate over the whole union, and nobody narrows a search with a tenth word.
    private const int MaxSearchWords = 5;

    // LIKE treats % and _ as wildcards, so a query containing either would quietly match
    // far more than it says (a lone "%" matches every project). Escaped against MySQL's
    // default escape character, which is backslash — and the backslash itself goes first,
    // or it would double-escape the escapes added after it.
    private static string EscapeLike(string s) =>
        s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    // Optional geo/area filters appended after the geography join. The free-text
    // search is NOT one of them — see the note at the end of this method.
    private static string FilterSql(string? state, int? districtId, int? clubId, int? areaOfFocusId,
        DynamicParameters p)
    {
        var sb = new System.Text.StringBuilder();
        if (!string.IsNullOrWhiteSpace(state)) { sb.Append(" AND c.State = @State"); p.Add("State", state.Trim()); }
        if (districtId is > 0) { sb.Append(" AND c.fk_district_id = @DistrictId"); p.Add("DistrictId", districtId.Value); }
        if (clubId is > 0) { sb.Append(" AND u.ClubId = @ClubId"); p.Add("ClubId", clubId.Value); }
        if (areaOfFocusId.HasValue) { sb.Append(" AND u.AreaId = @AreaId"); p.Add("AreaId", areaOfFocusId.Value); }

        // The free-text search is deliberately NOT here. It lives inside every union leg
        // (SearchSqlAsync + Leg), so rows that cannot match are never materialised into the
        // derived table at all — the difference between filtering 6.35 lakh rows and
        // never reading most of them.
        return sb.ToString();
    }

    // ── Overview: zone-wide totals + year list + current-year snapshot ────
    [HttpGet("overview")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetOverview()
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        var f = await _rules.GetFilterAsync(conn);
        var all = await _years.GetAllExistingYearTablesAsync(conn);
        if (all.Count == 0)
            return Ok(new { totalProjects = 0, totalCost = 0m, totalBeneficiaries = 0, totalManHours = 0, totalRotarians = 0, years = Array.Empty<object>(), currentYear = (object?)null });

        // Grouped by year in ONE scan: the grand totals, the year list, and the
        // current-year snapshot all fall out of the same result (this used to be
        // two full-union scans). Grouping on the leg's YearLabel constant rather
        // than p.fk_year_id keeps a year table's rows attributed to that table
        // even where a legacy row carries a stale fk_year_id.
        var perYear = (await conn.QueryAsync($@"
            SELECT u.YearLabel AS yearLabel, COUNT(*) AS totalProjects,
                   {CostBuckets},
                   COALESCE(SUM(u.DirectBeneficiaries),0) AS totalBeneficiaries,
                   COALESCE(SUM(u.ManHours),0) AS totalManHours, COALESCE(SUM(u.Rotarians),0) AS totalRotarians
            FROM {Union(f, all, false)} {Geo}
            GROUP BY u.YearLabel")).ToList();

        var rates = await _fx.GetInrRatesAsync();
        long totalProjects = 0, totalBeneficiaries = 0, totalManHours = 0, totalRotarians = 0;
        decimal totalsCost = 0m;
        var byLabel = new Dictionary<string, (long Projects, decimal Cost, long Beneficiaries)>(StringComparer.OrdinalIgnoreCase);

        foreach (var r in perYear)
        {
            long n = Convert.ToInt64(r.totalProjects);
            if (n <= 0) continue;                       // a year table with nothing visible
            var label = (string)r.yearLabel;
            decimal cost = ToDefaultCost((object)r, rates);
            long ben = Convert.ToInt64(r.totalBeneficiaries);

            totalProjects += n;
            totalsCost += cost;
            totalBeneficiaries += ben;
            totalManHours += Convert.ToInt64(r.totalManHours);
            totalRotarians += Convert.ToInt64(r.totalRotarians);
            byLabel[label] = (n, cost, ben);
        }

        // Only years that actually hold projects — and carry a real Rotary-year label —
        // reach the year filter. Empty/future years and typo'd year tables are never offered.
        var curStart = await CurrentStartYearAsync(conn);
        var years = all.Where(t => byLabel.ContainsKey(t.YearLabel) && IsOfferableYearLabel(t.YearLabel, curStart))
                       .Select(t => new { yearId = t.YearId, yearLabel = t.YearLabel })
                       .Reverse().ToList();

        object? currentYear = null;
        var curId = await conn.ExecuteScalarAsync<int?>("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        var curTable = curId.HasValue ? all.FirstOrDefault(t => t.YearId == curId.Value) : null;
        if (curTable != null && byLabel.TryGetValue(curTable.YearLabel, out var cy))
            currentYear = new { yearId = curTable.YearId, yearLabel = curTable.YearLabel, totalProjects = (int)cy.Projects, totalCost = cy.Cost, totalBeneficiaries = cy.Beneficiaries };

        return Ok(new
        {
            totalProjects = (int)totalProjects,
            totalCost = totalsCost,
            totalBeneficiaries,
            totalManHours,
            totalRotarians,
            years,
            currentYear,
        });
    }

    // A public year filter should only ever offer real Rotary years. A project saved with a
    // typo'd date (year "26" or "225", or a date years in the future) spins up its own year
    // table — those labels must never be offered, though the rows still count under "all years".
    private static bool IsOfferableYearLabel(string? label, int currentStartYear)
    {
        var m = System.Text.RegularExpressions.Regex.Match(label ?? "", @"^(\d{4})-\d{2}$");
        return m.Success
            && int.TryParse(m.Groups[1].Value, out var start)
            && start >= 1900 && start <= currentStartYear;
    }

    private static async Task<int> CurrentStartYearAsync(MySqlConnection conn)
    {
        var label = await conn.ExecuteScalarAsync<string?>(
            "SELECT YearLabel FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 LIMIT 1");
        var m = System.Text.RegularExpressions.Regex.Match(label ?? "", @"^(\d{4})");
        return m.Success && int.TryParse(m.Groups[1].Value, out var y) ? y : DateTime.UtcNow.Year;
    }

    // Year tables that actually contain at least one publicly-visible project AND carry a
    // real Rotary-year label (see IsOfferableYearLabel).
    private async Task<List<YearTableInfo>> YearsWithProjectsAsync(MySqlConnection conn, ProjectCountFilter f, List<YearTableInfo> all)
    {
        if (all.Count == 0) return all;
        var curStart = await CurrentStartYearAsync(conn);
        var rows = await conn.QueryAsync($@"
            SELECT u.YearLabel AS yearLabel, COUNT(*) AS n
            FROM {Union(f, all, false)} {Geo}
            GROUP BY u.YearLabel");
        var live = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows)
            if (Convert.ToInt64(r.n) > 0) live.Add((string)r.yearLabel);
        return all.Where(t => live.Contains(t.YearLabel) && IsOfferableYearLabel(t.YearLabel, curStart)).ToList();
    }

    // ── Years that have projects (newest first) ──────────────────────────
    [HttpGet("years")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any)]
    public async Task<ActionResult> GetYears()
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        var f = await _rules.GetFilterAsync(conn);
        var all = await _years.GetAllExistingYearTablesAsync(conn);
        var live = await YearsWithProjectsAsync(conn, f, all);
        return Ok(live.Select(t => new { yearId = t.YearId, yearLabel = t.YearLabel }).Reverse());
    }

    // ── Per-state project/club counts ────────────────────────────────────
    [HttpGet("states")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetStates([FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        var f = await _rules.GetFilterAsync(conn);
        var tables = await YearTablesAsync(conn, yearId);
        if (tables.Count == 0) return Ok(Array.Empty<object>());
        var rows = await conn.QueryAsync($@"
            SELECT CONVERT(c.State USING utf8mb4) AS state, COUNT(*) AS projects, COUNT(DISTINCT u.ClubId) AS clubs
            FROM {Union(f, tables, false)} {Geo}
            WHERE c.State IS NOT NULL AND c.State <> ''
            GROUP BY c.State ORDER BY c.State");
        return Ok(rows);
    }

    // ── Districts within a state ─────────────────────────────────────────
    [HttpGet("states/{state}/districts")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetStateDistricts(string state, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        var f = await _rules.GetFilterAsync(conn);
        var tables = await YearTablesAsync(conn, yearId);
        if (tables.Count == 0) return Ok(Array.Empty<object>());
        var rows = await conn.QueryAsync($@"
            SELECT c.fk_district_id AS districtId, CONVERT(d.DistrictNumber USING utf8mb4) AS districtNumber,
                   COUNT(*) AS projects, COUNT(DISTINCT u.ClubId) AS clubs
            FROM {Union(f, tables, false)} {Geo}
            WHERE c.State = @State
            GROUP BY c.fk_district_id, d.DistrictNumber
            ORDER BY d.DistrictNumber", new { State = state });
        return Ok(rows);
    }

    // ── All districts (optionally within a state) — for the browser's jump menu ─
    [HttpGet("districts")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetAllDistricts([FromQuery] string? state, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        var f = await _rules.GetFilterAsync(conn);
        var tables = await YearTablesAsync(conn, yearId);
        if (tables.Count == 0) return Ok(Array.Empty<object>());
        var p = new DynamicParameters();
        var filter = string.IsNullOrWhiteSpace(state) ? "" : " AND c.State = @State";
        if (!string.IsNullOrWhiteSpace(state)) p.Add("State", state.Trim());
        var rows = await conn.QueryAsync($@"
            SELECT c.fk_district_id AS districtId, CONVERT(d.DistrictNumber USING utf8mb4) AS districtNumber,
                   COUNT(*) AS projects, COUNT(DISTINCT u.ClubId) AS clubs
            FROM {Union(f, tables, false)} {Geo}
            WHERE 1=1 {filter}
            GROUP BY c.fk_district_id, d.DistrictNumber
            ORDER BY d.DistrictNumber", p);
        return Ok(rows);
    }

    // ── Clubs within a district (that have ≥1 project) ───────────────────
    [HttpGet("districts/{districtId:int}/clubs")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetDistrictClubs(int districtId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        var f = await _rules.GetFilterAsync(conn);
        var tables = await YearTablesAsync(conn, yearId);
        if (tables.Count == 0) return Ok(Array.Empty<object>());
        var rows = await conn.QueryAsync($@"
            SELECT u.ClubId AS clubId, CONVERT(c.ClubName USING utf8mb4) AS clubName,
                   CONVERT(c.City USING utf8mb4) AS city, COUNT(*) AS projects
            FROM {Union(f, tables, false)} {Geo}
            WHERE c.fk_district_id = @DistrictId
            GROUP BY u.ClubId, c.ClubName, c.City
            ORDER BY c.ClubName", new { DistrictId = districtId });
        return Ok(rows);
    }

    // ── Area-of-focus breakdown for one club ─────────────────────────────
    [HttpGet("clubs/{clubId:int}/areas")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetClubAreas(int clubId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        var f = await _rules.GetFilterAsync(conn);
        var tables = await YearTablesAsync(conn, yearId);
        if (tables.Count == 0) return Ok(Array.Empty<object>());
        var rows = await conn.QueryAsync($@"
            SELECT u.AreaId AS areaOfFocusId, u.AreaName AS name, COUNT(*) AS projects
            FROM {Union(f, tables, false)} {Geo}
            WHERE u.ClubId = @ClubId
            GROUP BY u.AreaId, u.AreaName ORDER BY projects DESC, name", new { ClubId = clubId });
        return Ok(rows);
    }

    // ── Area-of-focus breakdown for a scope (zone-wide / state / district) ─
    [HttpGet("areas")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetAreas([FromQuery] string? state, [FromQuery] int? districtId, [FromQuery] int? yearId)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        var f = await _rules.GetFilterAsync(conn);
        var tables = await YearTablesAsync(conn, yearId);
        if (tables.Count == 0) return Ok(Array.Empty<object>());
        var p = new DynamicParameters();
        var filter = FilterSql(state, districtId, null, null, p);
        var rows = await conn.QueryAsync($@"
            SELECT u.AreaId AS areaOfFocusId, u.AreaName AS name, COUNT(*) AS projects
            FROM {Union(f, tables, false)} {Geo}
            WHERE 1=1 {filter}
            GROUP BY u.AreaId, u.AreaName ORDER BY projects DESC, name", p);
        return Ok(rows);
    }

    // ── Filtered totals (for the projects-browser stats strip) ───────────
    [HttpGet("summary")]
    [ResponseCache(Duration = 120, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetSummary([FromQuery] int? yearId, [FromQuery] string? state,
        [FromQuery] int? districtId, [FromQuery] int? clubId, [FromQuery] int? areaOfFocusId,
        [FromQuery] string? q = null)
    {
        using var conn = CreateConn();
        await conn.OpenAsync();
        var f = await _rules.GetFilterAsync(conn);
        var tables = await YearTablesAsync(conn, yearId);
        if (tables.Count == 0) return Ok(new { totalProjects = 0, clubsInvolved = 0, valueInr = 0m, beneficiaries = 0, manHours = 0 });
        var p = new DynamicParameters();
        // Same filter as the listing, so the tiles can never describe a different set
        // of projects than the cards underneath them.
        var filter = FilterSql(state, districtId, clubId, areaOfFocusId, p);
        // Built once; every leg of the union references the same @Qn parameters.
        var search = await SearchSqlAsync(conn, q, p);
        var row = await conn.QueryFirstAsync($@"
            SELECT COUNT(*) AS totalProjects, COUNT(DISTINCT u.ClubId) AS clubsInvolved,
                   {CostBuckets},
                   COALESCE(SUM(u.DirectBeneficiaries),0) AS beneficiaries,
                   COALESCE(SUM(u.ManHours),0) AS manHours
            FROM {Union(f, tables, false, search)} {Geo} WHERE 1=1 {filter}", p);
        decimal valueInr = await ToInrCostAsync(row);
        return Ok(new { totalProjects = (int)row.totalProjects, clubsInvolved = (int)row.clubsInvolved, valueInr, beneficiaries = (long)row.beneficiaries, manHours = (long)row.manHours });
    }

    // ── Paged project cards (the lazy-loaded list) ───────────────────────
    [HttpGet("projects")]
    [ResponseCache(Duration = 120, Location = ResponseCacheLocation.Any, VaryByQueryKeys = new[] { "*" })]
    public async Task<ActionResult> GetProjects([FromQuery] int? yearId, [FromQuery] string? state,
        [FromQuery] int? districtId, [FromQuery] int? clubId, [FromQuery] int? areaOfFocusId,
        [FromQuery] string? q = null, [FromQuery] int page = 1, [FromQuery] int pageSize = 24)
    {
        page = page < 1 ? 1 : page;
        pageSize = pageSize < 1 ? 24 : Math.Min(pageSize, 48);
        using var conn = CreateConn();
        using var countConn = CreateConn(); // Dapper opens it for the count query below
        await conn.OpenAsync();
        var f = await _rules.GetFilterAsync(conn);
        var tables = await YearTablesAsync(conn, yearId);
        if (tables.Count == 0) return Ok(new { items = Array.Empty<object>(), totalCount = 0, page, pageSize, totalPages = 0 });

        // One filter string AND one search string feed BOTH the count and the page below,
        // so totalCount and items can never disagree about what the search matched.
        // Each query gets its own parameter bag: the two run at the same time, on their
        // own connections — every one a full scan of the year union, so running them
        // one after the other doubled the wait for every search.
        var p = new DynamicParameters();
        var cp = new DynamicParameters();
        var filter = FilterSql(state, districtId, clubId, areaOfFocusId, p);
        FilterSql(state, districtId, clubId, areaOfFocusId, cp);
        var search = await SearchSqlAsync(conn, q, p, cp);

        var totalTask = countConn.ExecuteScalarAsync<int>($@"
            SELECT COUNT(*) FROM {Union(f, tables, false, search)} {Geo} WHERE 1=1 {filter}", cp);

        p.Add("Offset", (page - 1) * pageSize);
        p.Add("PageSize", pageSize);
        var itemsTask = conn.QueryAsync($@"
            SELECT u.Id AS id, u.YearId AS yearId, u.Title AS title, u.ProjectDate AS projectDate,
                   u.ProjectCost AS projectCost, u.Currency AS currency, u.DirectBeneficiaries AS directBeneficiaries,
                   u.AreaName AS areaOfFocus, u.ClubId AS clubId, CONVERT(c.ClubName USING utf8mb4) AS clubName,
                   CONVERT(c.City USING utf8mb4) AS city, CONVERT(c.State USING utf8mb4) AS state,
                   CONVERT(d.DistrictNumber USING utf8mb4) AS districtNumber,
                   CONVERT(z.ZoneName USING utf8mb4) AS zoneName, u.PrimaryPhoto AS primaryPhoto
            FROM {Union(f, tables, true, search)} {Geo} WHERE 1=1 {filter}
            ORDER BY {SearchRankSql(q, p)}u.ProjectDate DESC, u.Id DESC LIMIT @Offset, @PageSize", p);

        await Task.WhenAll(totalTask, itemsTask);
        var total = totalTask.Result;
        var items = itemsTask.Result;
        return Ok(new { items, totalCount = total, page, pageSize, totalPages = (int)Math.Ceiling((double)total / pageSize) });
    }
}
