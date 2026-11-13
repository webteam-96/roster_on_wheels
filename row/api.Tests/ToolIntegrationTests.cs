using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;
using RotaryApi.Services.Assistant;
using RotaryApi.Services.Assistant.Tools;
using Xunit.Abstractions;

namespace RotaryApi.Tests;

// Runs every assistant tool against a real MySQL 8.0 schema (the local Docker test DB built by
// DatabaseInitializer + the persona seed). Skipped unless ASSISTANT_TEST_DB / ASSISTANT_TEST_DB_RO
// are set - it must never be pointed at production.
//
// Personas (local seed): 1 SuperAdmin; 2 District Admin of district 1; 3 Club Admin of club 4
// (district 2); 4 AG of club 6 (district 3) for year id 47 only; 5 Zonal Coordinator of zone 2
// (districts 1, 2); 6 allow-listed with no role.
public class ToolIntegrationTests(ITestOutputHelper output)
{
    private static readonly string? Writer = Environment.GetEnvironmentVariable("ASSISTANT_TEST_DB");
    private static readonly string? ReadOnly = Environment.GetEnvironmentVariable("ASSISTANT_TEST_DB_RO");

    private sealed class Harness
    {
        public required AssistantToolRegistry Registry { get; init; }
        public required AssistantScopeBuilder ScopeBuilder { get; init; }
        public required Func<AssistantScope, AssistantToolContext> Context { get; init; }
        public required List<ToolSpec> Specs { get; init; }
    }

    private static async Task<Harness> BuildAsync()
    {
        var settings = new AssistantSettings
        {
            Enabled = true, WriterConnectionString = Writer!, ReadOnlyConnectionString = ReadOnly!,
            ContactLookupsPerDay = 1000, ToolTtlMinutes = 0,
        };
        var cache = new MemoryCache(new MemoryCacheOptions());
        var services = new ServiceCollection()
            .AddLogging()
            .AddSingleton<IMemoryCache>(cache)
            .AddSingleton(settings)
            .AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(
                new Dictionary<string, string?> { ["ConnectionStrings:DefaultConnection"] = Writer }).Build())
            .AddSingleton<IYearTableResolver, YearTableResolver>()
            .AddSingleton<IProjectCountRules, ProjectCountRules>()
            .AddSingleton<GeminiChat>()
            .AddSingleton<VectorSearch>()
            .BuildServiceProvider();

        // The year tables are created on demand in production; make sure two exist here.
        await using (var conn = new MySqlConnection(Writer))
        {
            await conn.OpenAsync();
            await YearTableResolver.EnsureTablesExistStaticAsync(conn, "2025-26", null);
            await YearTableResolver.EnsureTablesExistStaticAsync(conn, "2026-27", null);
        }

        var tools = AssistantToolCatalog.All().ToList();
        var registry = new AssistantToolRegistry(tools, cache);
        var hierarchy = new HierarchyLookup(cache, settings);
        var years = new RotaryYears(cache, settings);
        var store = new AssistantStore(settings);
        return new Harness
        {
            Registry = registry,
            Specs = registry.Specs.ToList(),
            ScopeBuilder = new AssistantScopeBuilder(NoGoals.Create()),
            Context = scope => new AssistantToolContext
            {
                Scope = scope, Settings = settings, Hierarchy = hierarchy, Years = years, Store = store, Services = services,
            },
        };
    }

    private static async Task<AssistantScope> ScopeAsync(Harness h, int memberId)
    {
        await using var conn = new MySqlConnection(ReadOnly);
        await conn.OpenAsync();
        // Contact lookups need today's usage row, which the quota reservation creates in production.
        await using (var w = new MySqlConnection(Writer))
        {
            await w.OpenAsync();
            await Dapper.SqlMapper.ExecuteAsync(w,
                "INSERT IGNORE INTO assistant_usage_daily (member_id, usage_date) VALUES (@m, DATE(UTC_TIMESTAMP() + INTERVAL 330 MINUTE))",
                new { m = memberId });
        }
        return await h.ScopeBuilder.BuildAsync(conn, memberId, $"Member {memberId}");
    }

    private static async Task<(string Json, bool IsError)> RunAsync(Harness h, AssistantScope scope, string tool, object args) =>
        await h.Registry.RunAsync(h.Context(scope), new ToolCall("t1", tool, JsonSerializer.SerializeToElement(args)));

    [Fact]
    public async Task Every_tool_runs_without_sql_errors_for_super_admin()
    {
        if (Writer == null || ReadOnly == null) return;
        var h = await BuildAsync();
        var sa = await ScopeAsync(h, 1);
        Assert.True(sa.IsSuperAdmin);

        var failures = new List<string>();
        foreach (var spec in h.Specs)
        {
            foreach (var args in ArgVariants(spec))
            {
                var argsJson = JsonSerializer.Serialize(args);
                try
                {
                    var (json, isError) = await RunAsync(h, sa, spec.Name, args);
                    output.WriteLine($"{spec.Name} {argsJson}\n  -> {(json.Length > 400 ? json[..400] + "…" : json)}");
                    // A tool error is fine only when it is a deliberate input/permission message.
                    if (isError && !json.Contains("required") && !json.Contains("No active") && !json.Contains("not_permitted")
                        && !json.Contains("Unknown rotary year") && !json.Contains("must be one of"))
                        failures.Add($"{spec.Name} {argsJson}: {json}");
                }
                catch (Exception ex)
                {
                    failures.Add($"{spec.Name} {argsJson}: {ex.GetType().Name}: {ex.Message}");
                }
            }
        }
        Assert.True(failures.Count == 0, "Tool failures:\n" + string.Join("\n", failures));
    }

    [Fact(Skip = "Expects upstream data (named clubs, districts and members) that ROW does not have.")]
    public async Task Personas_only_reach_their_own_units()
    {
        if (Writer == null || ReadOnly == null) return;
        var h = await BuildAsync();

        async Task Expect(int member, string tool, object args, bool allowed)
        {
            var scope = await ScopeAsync(h, member);
            var (json, isError) = await RunAsync(h, scope, tool, args);
            var denied = isError && json.Contains("not_permitted");
            output.WriteLine($"member {member} {tool} {JsonSerializer.Serialize(args)} -> {(denied ? "DENIED" : "ok")}");
            Assert.True(allowed != denied, $"member {member} {tool} {JsonSerializer.Serialize(args)}: expected {(allowed ? "allowed" : "denied")}, got {json}");
        }

        // District Admin of district 1
        await Expect(2, "membership_stats", new { level = "district", id = 1 }, true);
        await Expect(2, "membership_stats", new { level = "club", id = 1 }, true);
        await Expect(2, "membership_stats", new { level = "district", id = 3 }, false);
        await Expect(2, "membership_stats", new { level = "zone", id = 2 }, false);
        await Expect(2, "membership_stats", new { level = "all" }, false);
        await Expect(2, "member_contact", new { member_id = 1 }, false);   // detail needs AllClubsAccess

        // Club Admin of club 4
        await Expect(3, "membership_stats", new { level = "club", id = 4 }, true);
        await Expect(3, "membership_stats", new { level = "club", id = 5 }, false);
        await Expect(3, "membership_stats", new { level = "district", id = 2 }, false);
        await Expect(3, "member_contact", new { member_id = 15 }, true);
        await Expect(3, "member_contact", new { member_id = 1 }, false);

        // AG of club 6, 2026-27 only
        await Expect(4, "membership_stats", new { level = "club", id = 6, year = "2026-27" }, true);
        await Expect(4, "membership_stats", new { level = "club", id = 6, year = "2025-26" }, false);
        await Expect(4, "membership_stats", new { level = "club", id = 7 }, false);

        // Zonal Coordinator of zone 2
        await Expect(5, "membership_stats", new { level = "zone", id = 2 }, true);
        await Expect(5, "membership_stats", new { level = "district", id = 2 }, true);
        await Expect(5, "membership_stats", new { level = "zone", id = 3 }, false);
        await Expect(5, "member_contact", new { member_id = 2 }, false);

        // No role
        var none = await ScopeAsync(h, 6);
        Assert.False(none.HasAnyReach);
    }

    // Seed (local DB): projects "Water ATM at Vasna" (club 4), "Blood donation camp" (club 1),
    // "School water filters" (club 6), a club-service meeting (club 4); announcements + events.
    [Fact(Skip = "Expects upstream data (named clubs, districts and members) that ROW does not have.")]
    public async Task Tools_return_rows_for_the_main_argument_combinations()
    {
        if (Writer == null || ReadOnly == null) return;
        var h = await BuildAsync();
        var sa = await ScopeAsync(h, 1);
        var calls = new (string Tool, object Args, string? MustContain)[]
        {
            ("resolve_entity", new { text = "Ahmedabad" }, "Ahmedabad Heritage"),
            ("resolve_entity", new { text = "3131", kind = "district" }, "3131"),
            ("resolve_entity", new { text = "Vikram", kind = "member" }, "Vikram"),
            ("membership_stats", new { level = "district", id = 1, breakdown = "club" }, "Mumbai West"),
            ("membership_stats", new { level = "club", id = 4 }, "members"),
            ("list_clubs", new { district_id = 2 }, "Ahmedabad"),
            ("leadership", new { level = "club", id = 4 }, null),
            ("leadership", new { level = "district", id = 1 }, null),
            ("attendance_stats", new { level = "club", id = 4 }, null),
            ("attendance_stats", new { level = "district", id = 2 }, null),
            ("monthly_report_status", new { level = "district", id = 1 }, null),
            ("monthly_report_status", new { level = "club", id = 4 }, null),
            ("project_stats", new { level = "all" }, null),
            ("project_stats", new { level = "district", id = 2 }, null),
            ("project_stats", new { level = "club", id = 4, avenue = "community_service" }, null),
            ("search_projects", new { query = "water" }, "Water ATM"),
            ("search_projects", new { query = "water", level = "club", id = 4, year = "2026-27" }, "Water ATM"),
            ("project_stats", new { level = "all", group_by = "area_of_focus" }, "\"breakdownBy\":\"area_of_focus\""),
            ("project_stats", new { level = "district", id = 2, group_by = "funding", focus = "water" }, null),
            ("project_stats", new { level = "club", id = 4, location = "Ahmedabad", group_by = "category" }, null),
            ("search_projects", new { query = "water", include_photos = true }, "Water ATM"),
            ("search_projects", new { focus = "water", funding = "self_funded" }, null),
            ("search_projects", new { location = "Ahmedabad", joint_only = true }, null),
            ("search_communications", new { query = "water" }, "Water"),
            ("search_communications", new { query = "assembly", type = "announcement" }, "District assembly"),
            ("search_communications", new { query = "", upcoming_only = true }, "Water walk"),
        };
        var failures = new List<string>();
        foreach (var (tool, args, mustContain) in calls)
        {
            var argsJson = JsonSerializer.Serialize(args);
            try
            {
                var (json, isError) = await RunAsync(h, sa, tool, args);
                output.WriteLine($"{tool} {argsJson}\n  -> {(json.Length > 500 ? json[..500] + "…" : json)}");
                if (isError) failures.Add($"{tool} {argsJson}: {json}");
                else if (mustContain != null && !json.Contains(mustContain)) failures.Add($"{tool} {argsJson}: missing '{mustContain}' in {json}");
            }
            catch (Exception ex) { failures.Add($"{tool} {argsJson}: {ex.GetType().Name}: {ex.Message}"); }
        }
        Assert.True(failures.Count == 0, "Tool failures:\n" + string.Join("\n", failures));
    }

    [Fact(Skip = "Expects upstream data (named clubs, districts and members) that ROW does not have.")]
    public async Task Project_search_only_returns_the_users_clubs()
    {
        if (Writer == null || ReadOnly == null) return;
        var h = await BuildAsync();
        var ca = await ScopeAsync(h, 3);   // Club Admin of club 4
        var (json, _) = await RunAsync(h, ca, "search_projects", new { query = "water" });
        output.WriteLine(json);
        Assert.Contains("Water ATM", json);
        Assert.DoesNotContain("School water filters", json);   // club 6
        Assert.Contains("untrustedText", json);                // user text is labelled as data
    }

    [Fact]
    public async Task Quota_budget_and_cache_work_against_mysql()
    {
        if (Writer == null || ReadOnly == null) return;
        const int member = 6;
        var store = new AssistantStore(new AssistantSettings { WriterConnectionString = Writer, MonthlyBudgetUsd = 0.25m, AnswerTtlMinutes = 5 });
        await using var db = await store.OpenAsync();
        var month = DateTime.UtcNow.ToString("yyyy-MM");
        await Dapper.SqlMapper.ExecuteAsync(db, "DELETE FROM assistant_usage_daily WHERE member_id = @member; DELETE FROM assistant_budget_monthly WHERE budget_month = @month",
            new { member, month });

        // Daily cap of 2: third question refused.
        Assert.Equal(AssistantStore.QuotaResult.Ok, await store.ReserveAsync(db, member, 2));
        await store.SettleAsync(db, member, 0.01m);
        Assert.Equal(AssistantStore.QuotaResult.Ok, await store.ReserveAsync(db, member, 2));
        await store.SettleAsync(db, member, 0.01m);
        Assert.Equal(AssistantStore.QuotaResult.DailyLimit, await store.ReserveAsync(db, member, 2));
        Assert.Equal(2, await store.QuestionsTodayAsync(db, member));

        // Monthly cap $0.25 with $0.10 reserved per question: spent 0.02, so 2 more fit, the next doesn't
        // - and that refused question is not counted against the day.
        Assert.Equal(AssistantStore.QuotaResult.Ok, await store.ReserveAsync(db, member, 100));
        Assert.Equal(AssistantStore.QuotaResult.Ok, await store.ReserveAsync(db, member, 100));
        Assert.Equal(AssistantStore.QuotaResult.MonthlyBudget, await store.ReserveAsync(db, member, 100));
        Assert.Equal(4, await store.QuestionsTodayAsync(db, member));
        await store.SettleAsync(db, member, 0m);
        await store.SettleAsync(db, member, 0m);
        await store.RefundQuestionAsync(db, member);
        Assert.Equal(3, await store.QuestionsTodayAsync(db, member));
        var budget = await Dapper.SqlMapper.QuerySingleAsync<(decimal Spent, decimal Reserved)>(db,
            "SELECT spent_usd, reserved_usd FROM assistant_budget_monthly WHERE budget_month = @month", new { month });
        Assert.Equal(0.02m, budget.Spent);
        Assert.Equal(0m, budget.Reserved);

        // Answer cache round trip.
        var key = new string('a', 64);
        await store.PutCachedAnswerAsync(db, key, "42 members", "claude-sonnet-5-5");
        var hit = await store.GetCachedAnswerAsync(db, key);
        Assert.Equal("42 members", hit?.Answer);
        Assert.True((DateTime.UtcNow - hit!.CreatedUtc).Duration() < TimeSpan.FromMinutes(2));
        Assert.Null(await store.GetCachedAnswerAsync(db, new string('b', 64)));
    }

    [Fact(Skip = "Expects upstream data (named clubs, districts and members) that ROW does not have.")]
    public async Task Entity_search_hides_what_the_user_cannot_see()
    {
        if (Writer == null || ReadOnly == null) return;
        var h = await BuildAsync();
        var ca = await ScopeAsync(h, 3);
        var (json, _) = await RunAsync(h, ca, "resolve_entity", new { text = "Rotary Club of", kind = "club" });
        output.WriteLine(json);
        Assert.Contains("Ahmedabad Heritage", json);
        Assert.DoesNotContain("Mumbai", json);
    }

    // One call per level value (with a matching id), every other argument filled with a plausible value.
    private static IEnumerable<Dictionary<string, object?>> ArgVariants(ToolSpec spec)
    {
        var props = spec.InputSchema["properties"]!.AsObject();
        var levels = props.TryGetPropertyValue("level", out var lvl) ? lvl!["enum"]!.AsArray().Select(v => v!.GetValue<string>()).ToList() : new List<string> { "" };
        foreach (var level in levels)
        {
            var args = new Dictionary<string, object?>();
            foreach (var (name, schema) in props)
            {
                object? value = name switch
                {
                    "level" => level,
                    "id" => level switch { "zone" => 2, "district" => 1, "club" => 4, _ => null },
                    "district_id" => 1,
                    "club_id" => 4,
                    "member_id" => 15,
                    "year" => "2026-27",
                    "month" => 10,
                    "limit" => 5,
                    "text" => "Mumbai",
                    "query" => "water",
                    "designation" => "President",
                    _ when schema!["type"]?.GetValue<string>() == "boolean" => true,
                    _ when schema!["enum"] is JsonArray e => e.Last()!.GetValue<string>(),
                    _ => null,
                };
                if (value != null) args[name] = value;
            }
            yield return args;

            // Then each other enum option at each of its values, so every SQL branch runs once.
            foreach (var (name, schema) in props)
            {
                if (name == "level" || schema!["enum"] is not JsonArray values) continue;
                foreach (var v in values.Select(x => x!.GetValue<string>()))
                    yield return new Dictionary<string, object?>(args) { [name] = v };
            }
        }
    }

    // IGoalSettingService stand-in: ROW has no goal assignments, so the scope builder never calls it.
    public class NoGoals : DispatchProxy
    {
        public static IGoalSettingService Create() => DispatchProxy.Create<IGoalSettingService, NoGoals>();

        protected override object? Invoke(MethodInfo? method, object?[]? args) =>
            throw new NotSupportedException(method?.Name);
    }
}
