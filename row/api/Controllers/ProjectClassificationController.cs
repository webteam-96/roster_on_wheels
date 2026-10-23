using System.Text;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Controllers;

// Smart search across a module's Areas of Focus (projects are classified by Area of Focus only).
// Each result carries the area's id + name so the form can set it from a single pick. Also an AI
// suggest endpoint that maps a project's title/description onto the areas of focus (Gemini, free tier).
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

        // Relevance rank on the area name: 0 = starts with the term, 1 = term appears as a whole word,
        // 2 = substring anywhere, then name — so e.g. searching 'nation' surfaces 'Nation Builder
        // Award' (starts-with) above mid-word matches like 'doNATION'.
        const string sql = @"
            SELECT 'area' AS type, a.pk_area_of_focus_id AS areaOfFocusId, a.name AS areaOfFocusName
            FROM area_of_focus_master a
            WHERE a.is_active = 1 AND a.isdeleted = 0
              AND (@ModuleId = 0 OR a.fk_module_id = @ModuleId)
              AND a.name LIKE @Q
            ORDER BY CASE WHEN a.name LIKE @QStart THEN 0 WHEN a.name LIKE @QWord THEN 1 ELSE 2 END, a.name
            LIMIT 50";

        var results = (await conn.QueryAsync<ClassificationSearchResultDto>(sql,
            new { ModuleId = moduleId, Q = $"%{term}%", QStart = $"{term}%", QWord = $"% {term}%" })).ToList();
        return Ok(results);
    }

    // AI suggestion: read a project's title/description and return the best-matching area(s) of focus.
    // The prompt is scoped to the CURRENT module's areas (smaller, sharper, cheaper). The model returns
    // the area BY NAME; we resolve names → ids here, which is far more reliable than asking it to pick an
    // index out of a long flat list. A compact list of the other service avenues drives the optional
    // cross-module "better fit" hint. Uses Google Gemini (free tier).
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

        // Load the CURRENT module's areas of focus. Scoping to the current module keeps the prompt small
        // and the pick sharp. Names (not indices) are sent + returned, then resolved to ids here — models
        // are far more reliable choosing by name than counting to an index in a long list.
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

        // Current module's areas of focus, one per line.
        var sb = new StringBuilder();
        foreach (var a in areas) sb.Append("- ").Append(a.AreaOfFocusName).Append('\n');
        var ob = new StringBuilder();
        foreach (var g in otherAreas.GroupBy(o => o.ModuleName))
            ob.Append("- ").Append(g.Key).Append(": ").Append(string.Join(", ", g.Select(x => x.AreaOfFocusName))).Append('\n');

        var prompt =
            "You classify a Rotary club project into a fixed taxonomy.\n" +
            "The user is filling in the \"" + currentModuleName + "\" project form.\n\n" +
            "AREAS OF FOCUS for \"" + currentModuleName + "\" (choose ONLY from these exact names):\n" + sb + "\n" +
            "OTHER project types and their areas of focus (for the betterModule hint only):\n" + ob + "\n" +
            "Read the project title and description, then return ONLY JSON:\n" +
            "{\"matches\":[{\"areaOfFocus\":\"..\"}],\"betterModule\":null}\n" +
            "- \"matches\": the 1-3 best areas of focus from the \"" + currentModuleName + "\" list above, best first. " +
            "Use the EXACT names shown.\n" +
            "- \"betterModule\": ONLY if the project clearly belongs to a DIFFERENT project type than \"" + currentModuleName +
            "\", set {\"module\":<one OTHER project type>,\"areaOfFocus\":<one of that type's areas>}; otherwise null.\n\n" +
            "Project title: " + title + "\nProject description: " + desc;

        var model = _config["Gemini:Model"] ?? "gemini-2.0-flash";
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
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
            using var gemini = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
            };
            gemini.Headers.Add("x-goog-api-key", apiKey); // a header, not the URL, so request logs never hold the key
            using var resp = await http.SendAsync(gemini);
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
                var seen = new HashSet<int>();
                foreach (var m in matchesEl.EnumerateArray())
                {
                    if (m.ValueKind != JsonValueKind.Object) continue;
                    var dto = ResolveMatch(PropStr(m, "areaOfFocus"), areas, req.ModuleId, currentModuleKey, currentModuleName);
                    if (dto == null) continue;
                    if (seen.Add(dto.AreaOfFocusId)) matches.Add(dto);
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

    // Map the model's area name to a real area of focus in the current module.
    private static ClassificationSearchResultDto? ResolveMatch(
        string? area, List<AreaRow> areas, int moduleId, string moduleKey, string moduleName)
    {
        var a = PickByName(areas, area, x => x.AreaOfFocusName);
        if (a == null) return null;
        return new ClassificationSearchResultDto
        {
            Type = "area", ModuleId = moduleId, ModuleKey = moduleKey, ModuleName = moduleName,
            AreaOfFocusId = a.AreaOfFocusId, AreaOfFocusName = a.AreaOfFocusName,
        };
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
    private sealed class OtherAreaRow { public int ModuleId { get; set; } public string ModuleKey { get; set; } = ""; public string ModuleName { get; set; } = ""; public int AreaOfFocusId { get; set; } public string AreaOfFocusName { get; set; } = ""; }
}
