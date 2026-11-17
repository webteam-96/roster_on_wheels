using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Extensions.Caching.Memory;
using MySqlConnector;

namespace RotaryApi.Services.Assistant.Tools;

// One read-only data tool the models can call. Handlers return compact JSON; anything they throw as
// ToolDeniedException / ToolInputException becomes a tool error the model can explain to the user.
public sealed record AssistantTool(
    ToolSpec Spec,
    DataArea Area,
    Func<AssistantToolContext, ToolArgs, Task<object>> Handler,
    bool Cacheable = true,
    bool ReadsContactData = false);

public sealed class ToolDeniedException(string message) : Exception(message);
public sealed class ToolInputException(string message) : Exception(message);

// Everything a tool handler needs for one question. Created per request by the orchestrator.
public sealed class AssistantToolContext
{
    public required AssistantScope Scope { get; init; }
    public required AssistantSettings Settings { get; init; }
    public required HierarchyLookup Hierarchy { get; init; }
    public required RotaryYears Years { get; init; }
    public required AssistantStore Store { get; init; }
    public required IServiceProvider Services { get; init; }
    public bool UsedContactData { get; set; }

    public async Task<MySqlConnection> OpenReadOnlyAsync()
    {
        var conn = RowDb.Connect(Settings.ReadOnlyConnectionString);
        await conn.OpenAsync();
        return conn;
    }

    // Throws unless the member may see this target. Every tool calls this before reading data.
    public void Require(ScopeTarget target, ScopeDepth depth, DataArea area, int? yearId, string what)
    {
        if (!ScopeGuard.CanSee(Scope, target, depth, area, yearId))
            throw new ToolDeniedException($"not_permitted: this user has no access to {what}.");
    }

    // SQL predicate that keeps only rows under zones the member may see at all - drops the RI
    // Director placeholder zones from org-wide totals. zoneIdExpr = the zone id column at the call site.
    public string ExcludedZonesSql(string zoneIdExpr) =>
        Scope.ExcludedZones.Count == 0 ? "1 = 1"
            : $"COALESCE({zoneIdExpr}, 0) NOT IN ({string.Join(",", Scope.ExcludedZones.OrderBy(z => z))})";
}

// Reads tool arguments with friendly errors instead of exceptions the model can't act on.
public sealed class ToolArgs(JsonElement root)
{
    public JsonElement Root { get; } = root;

    public string? String(string name)
    {
        if (Root.ValueKind != JsonValueKind.Object || !Root.TryGetProperty(name, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.String => string.IsNullOrWhiteSpace(v.GetString()) ? null : v.GetString()!.Trim(),
            JsonValueKind.Number => v.GetRawText(),
            _ => null,
        };
    }

    public int? Int(string name)
    {
        if (Root.ValueKind != JsonValueKind.Object || !Root.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i)) return i;
        if (v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out var s)) return s;
        return null;
    }

    public int RequiredInt(string name) =>
        Int(name) ?? throw new ToolInputException($"'{name}' is required (a number). Use resolve_entity to find ids.");

    public string RequiredString(string name) =>
        String(name) ?? throw new ToolInputException($"'{name}' is required.");

    public string Enum(string name, string[] allowed, string? fallback = null)
    {
        var v = String(name)?.ToLowerInvariant() ?? fallback;
        if (v == null || !allowed.Contains(v))
            throw new ToolInputException($"'{name}' must be one of: {string.Join(", ", allowed)}.");
        return v;
    }

    public int Limit(int dflt = 25, int max = 100) => Math.Clamp(Int("limit") ?? dflt, 1, max);
}

// Builds the strict JSON Schemas both providers accept: object, additionalProperties:false, plain
// keywords only (no minimum/maxLength - Anthropic strict mode and Gemini both reject some of those).
public static class Schema
{
    public static JsonObject Object(params (string Name, JsonObject Schema, bool Required)[] props)
    {
        var properties = new JsonObject();
        var required = new JsonArray();
        foreach (var (name, schema, req) in props)
        {
            properties[name] = schema;
            if (req) required.Add(name);
        }
        return new JsonObject
        {
            ["type"] = "object",
            ["properties"] = properties,
            ["required"] = required,
            ["additionalProperties"] = false,
        };
    }

    public static JsonObject Str(string description) => new() { ["type"] = "string", ["description"] = description };
    public static JsonObject Int(string description) => new() { ["type"] = "integer", ["description"] = description };

    public static JsonObject Enum(string description, params string[] values)
    {
        var arr = new JsonArray();
        foreach (var v in values) arr.Add(v);
        return new JsonObject { ["type"] = "string", ["enum"] = arr, ["description"] = description };
    }

    // The arguments most tools share.
    public static (string, JsonObject, bool) Level(params string[] levels) =>
        ("level", Enum("Which kind of unit 'id' refers to.", levels), true);
    public static (string, JsonObject, bool) Id(bool required = true) =>
        ("id", Int("Id of the zone / district / club from resolve_entity."), required);
    public static (string, JsonObject, bool) Year() =>
        ("year", Str("Rotary year label such as \"2025-26\" (July to June). Omit for the current year."), false);
    public static (string, JsonObject, bool) LimitArg() =>
        ("limit", Int("Max rows to return (default 25, max 100)."), false);
}

public sealed class HierarchyRef
{
    public int? ZoneId { get; init; }
    public string? ZoneName { get; init; }
    public int? DistrictId { get; init; }
    public string? DistrictNumber { get; init; }
    public int? ClubId { get; init; }
    public string? ClubName { get; init; }

    public ScopeTarget Target => new(ZoneId, DistrictId, ClubId);
    public string Label => ClubName != null ? $"club {ClubName}"
        : DistrictNumber != null ? $"district {DistrictNumber}" : ZoneName != null ? ZoneName : "all zones";
}

// Resolves an id to its place in the hierarchy (club -> district -> zone), live rows only: an
// inactive zone / district / club is "not found" for everyone, as on every other screen.
public sealed class HierarchyLookup(IMemoryCache cache, AssistantSettings settings)
{
    public async Task<HierarchyRef> ResolveAsync(string level, int? id)
    {
        if (level == "all") return new HierarchyRef();
        if (id is not int value) throw new ToolInputException("'id' is required for this level. Use resolve_entity first.");
        var key = $"assistant:hier:{level}:{value}";
        if (cache.TryGetValue(key, out HierarchyRef? hit) && hit != null) return hit;

        await using var conn = RowDb.Connect(settings.ReadOnlyConnectionString);
        await conn.OpenAsync();
        HierarchyRef? found = level switch
        {
            "zone" => await conn.QuerySingleOrDefaultAsync<HierarchyRef>($@"
                SELECT z.pk_zone_id AS ZoneId, z.ZoneName, NULL AS DistrictId, NULL AS DistrictNumber,
                       NULL AS ClubId, NULL AS ClubName
                FROM zone_master z WHERE z.pk_zone_id = @value AND z.isdeleted = 0 AND {HierarchyScopeSql.ZoneLive("z")}",
                new { value }),
            "district" => await conn.QuerySingleOrDefaultAsync<HierarchyRef>($@"
                SELECT d.fk_zone_id AS ZoneId, z.ZoneName, d.pk_district_id AS DistrictId, d.DistrictNumber,
                       NULL AS ClubId, NULL AS ClubName
                FROM district_master d LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                WHERE d.pk_district_id = @value AND d.isdeleted = 0 AND {HierarchyScopeSql.DistrictLive("d")}",
                new { value }),
            "club" => await conn.QuerySingleOrDefaultAsync<HierarchyRef>($@"
                SELECT d.fk_zone_id AS ZoneId, z.ZoneName, c.fk_district_id AS DistrictId, d.DistrictNumber,
                       c.pk_club_id AS ClubId, c.ClubName
                FROM club_master c
                LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
                WHERE c.pk_club_id = @value AND c.isdeleted = 0 AND {HierarchyScopeSql.ClubLive("c")}
                  AND {ClubScopeSql.NotRotaract("c")}",
                new { value }),
            _ => throw new ToolInputException("Unknown level."),
        };
        if (found == null) throw new ToolInputException($"No active {level} with id {value}.");
        cache.Set(key, found, TimeSpan.FromMinutes(10));
        return found;
    }
}

public sealed class RotaryYear
{
    public int Id { get; init; }
    public string Label { get; init; } = "";
    public DateTime Start { get; init; }
    public DateTime End { get; init; }
    public bool IsCurrent { get; init; }
}

// Rotary years (July-June). The model passes labels like "2025-26"; tools work in ids and dates.
public sealed class RotaryYears(IMemoryCache cache, AssistantSettings settings)
{
    public async Task<List<RotaryYear>> AllAsync()
    {
        return (await cache.GetOrCreateAsync("assistant:years", async e =>
        {
            e.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30);
            await using var conn = RowDb.Connect(settings.ReadOnlyConnectionString);
            await conn.OpenAsync();
            return (await conn.QueryAsync<RotaryYear>(@"
                SELECT pk_year_id AS Id, YearLabel AS Label, StartDate AS Start, EndDate AS End,
                       COALESCE(IsCurrent,0) = 1 AS IsCurrent
                FROM rotary_year_master WHERE COALESCE(isdeleted,0) = 0 ORDER BY StartDate DESC")).ToList();
        }))!;
    }

    public async Task<RotaryYear> CurrentAsync()
    {
        var all = await AllAsync();
        var today = DateTime.UtcNow.AddMinutes(330).Date;
        return all.FirstOrDefault(y => y.IsCurrent)
               ?? all.FirstOrDefault(y => y.Start <= today && y.End >= today)
               ?? all.First();
    }

    // "2025-26", "2025-2026", "2025" (the year that starts in July 2025) all resolve; null = current.
    public async Task<RotaryYear> ResolveAsync(string? label)
    {
        if (string.IsNullOrWhiteSpace(label)) return await CurrentAsync();
        var all = await AllAsync();
        var l = label.Trim();
        var exact = all.FirstOrDefault(y => string.Equals(y.Label, l, StringComparison.OrdinalIgnoreCase));
        if (exact != null) return exact;
        var digits = new string(l.TakeWhile(char.IsDigit).ToArray());
        if (digits.Length == 4 && int.TryParse(digits, out var startYear))
        {
            var byStart = all.FirstOrDefault(y => y.Start.Year == startYear);
            if (byStart != null) return byStart;
        }
        throw new ToolInputException($"Unknown rotary year '{label}'. Call get_rotary_years for valid labels.");
    }
}

// Runs a model's tool call: finds the tool, enforces scope via the handler, caches the JSON result.
public sealed class AssistantToolRegistry
{
    private readonly Dictionary<string, AssistantTool> _tools;
    private readonly IMemoryCache _cache;

    public AssistantToolRegistry(IEnumerable<AssistantTool> tools, IMemoryCache cache)
    {
        // Ordinal sort keeps the tool list byte-identical between requests (prompt caching).
        _tools = tools.OrderBy(t => t.Spec.Name, StringComparer.Ordinal).ToDictionary(t => t.Spec.Name);
        _cache = cache;
    }

    public IReadOnlyList<ToolSpec> Specs => _tools.Values.Select(t => t.Spec).ToList();

    public bool IsContactTool(string name) => _tools.TryGetValue(name, out var t) && t.ReadsContactData;

    public async Task<(string Json, bool IsError)> RunAsync(AssistantToolContext ctx, ToolCall call)
    {
        if (!_tools.TryGetValue(call.Name, out var tool))
            return (ToolJson.Error($"Unknown tool '{call.Name}'."), true);

        if (tool.ReadsContactData) ctx.UsedContactData = true;
        var cacheKey = tool.Cacheable && ctx.Settings.ToolTtlMinutes > 0
            ? $"assistant:tool:{ctx.Scope.Fingerprint()}:{call.Name}:{call.Arguments.GetRawText()}"
            : null;
        if (cacheKey != null && _cache.TryGetValue(cacheKey, out string? cached) && cached != null)
            return (cached, false);

        try
        {
            var result = await tool.Handler(ctx, new ToolArgs(call.Arguments));
            var json = ToolJson.Serialize(result);
            if (cacheKey != null)
                _cache.Set(cacheKey, json, TimeSpan.FromMinutes(ctx.Settings.ToolTtlMinutes));
            return (json, false);
        }
        catch (ToolDeniedException ex) { return (ToolJson.Error(ex.Message), true); }
        catch (ToolInputException ex) { return (ToolJson.Error(ex.Message), true); }
        catch (UnauthorizedAccessException) { return (ToolJson.Error("not_permitted: this user has no access to that data."), true); }
    }
}
