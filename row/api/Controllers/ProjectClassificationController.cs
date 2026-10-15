using System.Text;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Controllers;

// Unified smart search across the 3-level project classification (Area of Focus → Category →
// Sub Category). One query term matches all three levels; each result carries the full hierarchy
// path so the form can populate + save all three ids from a single pick. Also an AI suggest
// endpoint that maps a project's title/description onto the taxonomy (Gemini, free tier).
[ApiController]
[Authorize]
public class ProjectClassificationController : ControllerBase
{
    private readonly string _conn;
    private readonly IConfiguration _config;
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<ProjectClassificationController> _logger;

    public ProjectClassificationController(IConfiguration config, IHttpClientFactory httpFactory,
        ILogger<ProjectClassificationController> logger)
    {
        _config = config;
        _conn = config.GetConnectionString("DefaultConnection")!;
        _httpFactory = httpFactory;
        _logger = logger;
    }

    // moduleId scopes the area-of-focus tree to a project module (e.g. Community Service); 0 = all.
    [HttpGet("api/project-classification/search")]
    public async Task<ActionResult<List<ClassificationSearchResultDto>>> Search([FromQuery] string? q, [FromQuery] int moduleId = 0)
    {
        var term = (q ?? "").Trim();
        if (term.Length < 1) return Ok(new List<ClassificationSearchResultDto>());

        using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();

        // Relevance rank on the matched level's own name: 0 = starts with the term, 1 = term appears
        // as a whole word, 2 = substring anywhere. Ordered by relevance first, then area → category →
        // sub-category (ord 1/2/3), then name — so e.g. searching 'nation' surfaces 'Nation Builder
        // Award' (starts-with) above mid-word matches like 'doNATION'. Each branch pulls its parents
        // so the full hierarchy path is present regardless of which level matched.
        const string sql = @"
            SELECT type, areaOfFocusId, areaOfFocusName, categoryId, categoryName, subCategoryId, subCategoryName
            FROM (
                SELECT 'area' AS type, a.pk_area_of_focus_id AS areaOfFocusId, a.name AS areaOfFocusName,
                       NULL AS categoryId, NULL AS categoryName, NULL AS subCategoryId, NULL AS subCategoryName,
                       1 AS ord, a.name AS nm,
                       CASE WHEN a.name LIKE @QStart THEN 0 WHEN a.name LIKE @QWord THEN 1 ELSE 2 END AS rnk
                FROM area_of_focus_master a
                WHERE a.is_active = 1 AND a.isdeleted = 0
                  AND (@ModuleId = 0 OR a.fk_module_id = @ModuleId)
                  AND a.name LIKE @Q

                UNION ALL

                SELECT 'category', a.pk_area_of_focus_id, a.name, c.pk_category_id, c.name, NULL, NULL, 2, c.name,
                       CASE WHEN c.name LIKE @QStart THEN 0 WHEN c.name LIKE @QWord THEN 1 ELSE 2 END
                FROM category_master c
                JOIN area_of_focus_master a ON a.pk_area_of_focus_id = c.fk_area_of_focus_id
                WHERE c.is_active = 1 AND c.isdeleted = 0 AND a.is_active = 1 AND a.isdeleted = 0
                  AND (@ModuleId = 0 OR a.fk_module_id = @ModuleId)
                  AND c.name LIKE @Q

                UNION ALL

                SELECT 'subcategory', a.pk_area_of_focus_id, a.name, c.pk_category_id, c.name, s.pk_sub_category_id, s.name, 3, s.name,
                       CASE WHEN s.name LIKE @QStart THEN 0 WHEN s.name LIKE @QWord THEN 1 ELSE 2 END
                FROM sub_category_master s
                JOIN category_master c ON c.pk_category_id = s.fk_category_id
                JOIN area_of_focus_master a ON a.pk_area_of_focus_id = c.fk_area_of_focus_id
                WHERE s.is_active = 1 AND s.isdeleted = 0 AND c.is_active = 1 AND c.isdeleted = 0
                  AND a.is_active = 1 AND a.isdeleted = 0
                  AND (@ModuleId = 0 OR a.fk_module_id = @ModuleId)
                  AND s.name LIKE @Q
            ) u
            ORDER BY u.rnk, u.ord, u.nm
            LIMIT 50";

        var results = (await conn.QueryAsync<ClassificationSearchResultDto>(sql,
            new { ModuleId = moduleId, Q = $"%{term}%", QStart = $"{term}%", QWord = $"% {term}%" })).ToList();
        return Ok(results);
    }

    // AI suggestion: read a project's title/description and return the best-matching taxonomy node(s).
    // The prompt is scoped to the CURRENT module's taxonomy (smaller, sharper, cheaper). The model
    // returns the classification BY NAME (area/category/sub); we resolve names → ids here, which is far
    // more reliable than asking it to pick an index out of a long flat list. A compact list of the other
    // service avenues drives the optional cross-module "better fit" hint. Uses Google Gemini (free tier).
    [HttpPost("api/project-classification/suggest")]
    public async Task<ActionResult<ClassificationSuggestResponseDto>> Suggest([FromBody] ClassificationSuggestRequest req)
    {
        var apiKey = _config["Gemini:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey) || apiKey.Contains("PLACEHOLDER", StringComparison.OrdinalIgnoreCase))
            return StatusCode(501, new { message = "AI suggestions are not configured (missing Gemini API key)." });

        var title = (req.Title ?? "").Trim();
        var desc = (req.Description ?? "").Trim();
        if (title.Length == 0 && desc.Length == 0)
            return BadRequest(new { message = "Enter a title or description first." });

        using var conn = new MySqlConnection(_conn);
        await conn.OpenAsync();

        // Load the CURRENT module's taxonomy as three levels (area → category → sub). Scoping to the
        // current module keeps the prompt small and the pick sharp; the model no longer wades through
        // every other module's entries. Names (not indices) are sent + returned, then resolved to ids
        // here — models are far more reliable choosing by name than counting to an index in a long list.
        var curMod = await conn.QueryFirstOrDefaultAsync(
            "SELECT ModuleKey AS ModuleKey, ModuleName AS ModuleName FROM module_master WHERE pk_module_id = @ModuleId AND isdeleted = 0",
            new { req.ModuleId });
        string currentModuleKey = (string?)curMod?.ModuleKey ?? "";
        string currentModuleName = (string?)curMod?.ModuleName ?? "this";

        var areas = (await conn.QueryAsync<AreaRow>(@"
            SELECT a.pk_area_of_focus_id AS AreaOfFocusId, a.name AS AreaOfFocusName
            FROM area_of_focus_master a
            WHERE a.fk_module_id = @ModuleId AND a.is_active = 1 AND a.isdeleted = 0
            ORDER BY a.name", new { req.ModuleId })).ToList();
        if (areas.Count == 0) return Ok(new ClassificationSuggestResponseDto());

        var cats = (await conn.QueryAsync<CatRow>(@"
            SELECT c.pk_category_id AS CategoryId, c.name AS CategoryName, c.fk_area_of_focus_id AS AreaOfFocusId
            FROM category_master c
            JOIN area_of_focus_master a ON a.pk_area_of_focus_id = c.fk_area_of_focus_id
            WHERE a.fk_module_id = @ModuleId AND c.is_active = 1 AND c.isdeleted = 0
              AND a.is_active = 1 AND a.isdeleted = 0
            ORDER BY c.name", new { req.ModuleId })).ToList();

        var subs = (await conn.QueryAsync<SubRow>(@"
            SELECT s.pk_sub_category_id AS SubCategoryId, s.name AS SubCategoryName, s.fk_category_id AS CategoryId
            FROM sub_category_master s
            JOIN category_master c ON c.pk_category_id = s.fk_category_id
            JOIN area_of_focus_master a ON a.pk_area_of_focus_id = c.fk_area_of_focus_id
            WHERE a.fk_module_id = @ModuleId AND s.is_active = 1 AND s.isdeleted = 0
              AND c.is_active = 1 AND c.isdeleted = 0 AND a.is_active = 1 AND a.isdeleted = 0
            ORDER BY s.name", new { req.ModuleId })).ToList();

        // Compact list of the OTHER routable service avenues + their area names — for the cross-module
        // "better fit" hint only. Just area names (not their full trees) keeps this cheap.
        var otherAreas = (await conn.QueryAsync<OtherAreaRow>(@"
            SELECT m.pk_module_id AS ModuleId, m.ModuleKey AS ModuleKey, m.ModuleName AS ModuleName,
                   a.pk_area_of_focus_id AS AreaOfFocusId, a.name AS AreaOfFocusName
            FROM area_of_focus_master a
            JOIN module_master m ON m.pk_module_id = a.fk_module_id AND m.isdeleted = 0 AND m.IsActive = 1
            WHERE a.is_active = 1 AND a.isdeleted = 0 AND m.pk_module_id <> @ModuleId
              AND m.ModuleKey IN ('community_service','vocational_service','international_service','new_generation_service','public_image_initiative')
            ORDER BY m.ModuleName, a.name", new { req.ModuleId })).ToList();

        // Current module taxonomy as a compact outline (area → categories → sub-categories).
        var sb = new StringBuilder();
        foreach (var a in areas)
        {
            var aCats = cats.Where(c => c.AreaOfFocusId == a.AreaOfFocusId).ToList();
            if (aCats.Count == 0) { sb.Append("- ").Append(a.AreaOfFocusName).Append(" (no categories)\n"); continue; }
            sb.Append("- ").Append(a.AreaOfFocusName).Append('\n');
            foreach (var c in aCats)
            {
                var cSubs = subs.Where(s => s.CategoryId == c.CategoryId).Select(s => s.SubCategoryName).ToList();
                sb.Append("   - ").Append(c.CategoryName);
                if (cSubs.Count == 0) sb.Append(" (no sub-categories)\n");
                else sb.Append(": ").Append(string.Join(" | ", cSubs)).Append('\n');
            }
        }
        var ob = new StringBuilder();
        foreach (var g in otherAreas.GroupBy(o => o.ModuleName))
            ob.Append("- ").Append(g.Key).Append(": ").Append(string.Join(", ", g.Select(x => x.AreaOfFocusName))).Append('\n');

        var prompt =
            "You classify a Rotary club project into a fixed taxonomy.\n" +
            "The user is filling in the \"" + currentModuleName + "\" project form.\n\n" +
            "TAXONOMY for \"" + currentModuleName + "\" (choose ONLY from these exact names):\n" + sb + "\n" +
            "OTHER project types and their areas of focus (for the betterModule hint only):\n" + ob + "\n" +
            "Read the project title and description, then return ONLY JSON:\n" +
            "{\"matches\":[{\"areaOfFocus\":\"..\",\"category\":null,\"subCategory\":null}],\"betterModule\":null}\n" +
            "- \"matches\": the 1-3 best entries from the \"" + currentModuleName + "\" TAXONOMY above, best first. " +
            "Always give areaOfFocus; also give category if the chosen area lists categories, and subCategory if that " +
            "category lists sub-categories. Use the EXACT names shown; use null for a level that does not apply.\n" +
            "- \"betterModule\": ONLY if the project clearly belongs to a DIFFERENT project type than \"" + currentModuleName +
            "\", set {\"module\":<one OTHER project type>,\"areaOfFocus\":<one of that type's areas>}; otherwise null.\n\n" +
            "Project title: " + title + "\nProject description: " + desc;

        var model = _config["Gemini:Model"] ?? "gemini-2.0-flash";
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}";
        var payload = new
        {
            contents = new[] { new { parts = new[] { new { text = prompt } } } },
            generationConfig = new { temperature = 0, responseMimeType = "application/json" },
        };

        string respBody;
        try
        {
            var http = _httpFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(25);
            using var resp = await http.PostAsync(url,
                new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"));
            respBody = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogError("Gemini classify failed: {Status} {Body}", resp.StatusCode, respBody);
                return StatusCode(502, new { message = "The AI service is unavailable right now. Please try again." });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Gemini classify request failed");
            return StatusCode(502, new { message = "The AI service is unavailable right now. Please try again." });
        }

        // Gemini → candidates[0].content.parts[0].text → our JSON with NAMES. Resolve names → ids here.
        var matches = new List<ClassificationSearchResultDto>();
        ClassificationSearchResultDto? better = null;
        try
        {
            using var doc = JsonDocument.Parse(respBody);
            var text = doc.RootElement.GetProperty("candidates")[0]
                .GetProperty("content").GetProperty("parts")[0].GetProperty("text").GetString();
            using var mdoc = JsonDocument.Parse(text!);
            var root = mdoc.RootElement;

            if (root.TryGetProperty("matches", out var matchesEl) && matchesEl.ValueKind == JsonValueKind.Array)
            {
                var seen = new HashSet<string>();
                foreach (var m in matchesEl.EnumerateArray())
                {
                    if (m.ValueKind != JsonValueKind.Object) continue;
                    var dto = ResolveMatch(PropStr(m, "areaOfFocus"), PropStr(m, "category"), PropStr(m, "subCategory"),
                        areas, cats, subs, req.ModuleId, currentModuleKey, currentModuleName);
                    if (dto == null) continue;
                    if (seen.Add($"{dto.AreaOfFocusId}/{dto.CategoryId}/{dto.SubCategoryId}")) matches.Add(dto);
                    if (matches.Count == 3) break;
                }
            }

            if (root.TryGetProperty("betterModule", out var bEl) && bEl.ValueKind == JsonValueKind.Object)
                better = ResolveBetter(PropStr(bEl, "module"), PropStr(bEl, "areaOfFocus"), otherAreas, req.ModuleId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not parse Gemini classification response: {Body}", respBody);
            return StatusCode(502, new { message = "Could not read the AI suggestion. Please try again." });
        }

        return Ok(new ClassificationSuggestResponseDto { Matches = matches, BetterModule = better });
    }

    // ── Name-based resolution helpers ─────────────────────────────────────────────────────────────
    private static string Norm(string? s) =>
        System.Text.RegularExpressions.Regex.Replace((s ?? "").Trim().ToLowerInvariant(), @"\s+", " ");

    private static string? PropStr(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    // Exact (normalized) name match, then a lenient contains-either-way fallback.
    private static T? PickByName<T>(IEnumerable<T> items, string? name, Func<T, string?> sel) where T : class
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var n = Norm(name);
        var list = items.ToList();
        var hit = list.FirstOrDefault(x => Norm(sel(x)) == n);
        if (hit != null) return hit;
        if (n.Length >= 3)
            hit = list.FirstOrDefault(x => { var cn = Norm(sel(x)); return cn.Length >= 3 && (cn.Contains(n) || n.Contains(cn)); });
        return hit;
    }

    // Map the model's {area, category, sub} names to real ids at whatever depth resolves.
    private static ClassificationSearchResultDto? ResolveMatch(
        string? area, string? category, string? sub,
        List<AreaRow> areas, List<CatRow> cats, List<SubRow> subs,
        int moduleId, string moduleKey, string moduleName)
    {
        var a = PickByName(areas, area, x => x.AreaOfFocusName);
        if (a == null) return null;
        var dto = new ClassificationSearchResultDto
        {
            Type = "area", ModuleId = moduleId, ModuleKey = moduleKey, ModuleName = moduleName,
            AreaOfFocusId = a.AreaOfFocusId, AreaOfFocusName = a.AreaOfFocusName,
        };
        var c = PickByName(cats.Where(x => x.AreaOfFocusId == a.AreaOfFocusId).ToList(), category, x => x.CategoryName);
        if (c != null)
        {
            dto.Type = "category"; dto.CategoryId = c.CategoryId; dto.CategoryName = c.CategoryName;
            var s = PickByName(subs.Where(x => x.CategoryId == c.CategoryId).ToList(), sub, x => x.SubCategoryName);
            if (s != null)
            {
                dto.Type = "subcategory"; dto.SubCategoryId = s.SubCategoryId; dto.SubCategoryName = s.SubCategoryName;
            }
        }
        return dto;
    }

    // Map the model's {module, area} names to a real other-module area (the cross-module hint target).
    private static ClassificationSearchResultDto? ResolveBetter(
        string? module, string? area, List<OtherAreaRow> otherAreas, int currentModuleId)
    {
        if (string.IsNullOrWhiteSpace(module)) return null;
        var nm = Norm(module);
        var grp = otherAreas.Where(o => Norm(o.ModuleName) == nm).ToList();
        if (grp.Count == 0) grp = otherAreas.Where(o => { var n = Norm(o.ModuleName); return n.Length >= 3 && (n.Contains(nm) || nm.Contains(n)); }).ToList();
        if (grp.Count == 0) return null;
        var ar = PickByName(grp, area, x => x.AreaOfFocusName) ?? grp[0];
        if (ar.ModuleId == currentModuleId) return null;
        return new ClassificationSearchResultDto
        {
            Type = "area", ModuleId = ar.ModuleId, ModuleKey = ar.ModuleKey, ModuleName = ar.ModuleName,
            AreaOfFocusId = ar.AreaOfFocusId, AreaOfFocusName = ar.AreaOfFocusName,
        };
    }

    private sealed class AreaRow { public int AreaOfFocusId { get; set; } public string AreaOfFocusName { get; set; } = ""; }
    private sealed class CatRow { public int CategoryId { get; set; } public string CategoryName { get; set; } = ""; public int AreaOfFocusId { get; set; } }
    private sealed class SubRow { public int SubCategoryId { get; set; } public string SubCategoryName { get; set; } = ""; public int CategoryId { get; set; } }
    private sealed class OtherAreaRow { public int ModuleId { get; set; } public string ModuleKey { get; set; } = ""; public string ModuleName { get; set; } = ""; public int AreaOfFocusId { get; set; } public string AreaOfFocusName { get; set; } = ""; }
}
