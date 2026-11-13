using System.Collections.Concurrent;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using RotaryApi.Services.Assistant.Tools;

namespace RotaryApi.Services.Assistant;

// One question, start to finish:
//   sanitise -> quota -> scope -> answer cache -> guard/router (Gemini) -> Flash or Sonnet tool loop
//   -> save, cache, settle cost.
// Everything the client sees goes out as SSE events (status / delta / answer_reset / done / error).
public sealed class AssistantOrchestrator
{
    // One live answer per member at a time (a second tab gets "busy").
    private static readonly ConcurrentDictionary<int, byte> ActiveStreams = new();

    private const string MsgInjection = "I can't help with that. I can only answer questions about Roster on Wheels records.";
    private const string MsgBulkPii = "I can't share contact details for groups of people. I can look up one named member's details, as far as their privacy settings allow.";
    private const string MsgOffTopic = "I can only help with Roster on Wheels records - members, clubs, projects, monthly reports, attendance, dues, Foundation giving, awards and goals.";
    private const string MsgRefused = "I can't help with that request.";
    private const string MsgNoAnswer = "Sorry, I couldn't work that out from the data. Try asking more specifically - for example name the district or club and the rotary year.";

    private static readonly Dictionary<string, string> ToolStatus = new()
    {
        ["resolve_entity"] = "Finding the right club / district…",
        ["get_rotary_years"] = "Checking rotary years…",
        ["membership_stats"] = "Checking membership data…",
        ["list_clubs"] = "Listing clubs…",
        ["club_profile"] = "Reading the club profile…",
        ["leadership"] = "Looking up office bearers…",
        ["member_contact"] = "Looking up contact details…",
        ["attendance_stats"] = "Checking attendance…",
        ["monthly_report_status"] = "Checking monthly reports…",
        ["membership_dues_status"] = "Checking membership dues…",
        ["club_dues_status"] = "Checking club dues…",
        ["trf_stats"] = "Checking Foundation giving…",
        ["awards_status"] = "Checking awards…",
        ["goal_progress"] = "Checking goals…",
        ["project_stats"] = "Counting projects…",
        ["search_projects"] = "Searching projects…",
        ["search_communications"] = "Searching announcements and events…",
    };

    private readonly AssistantSettings _settings;
    private readonly AssistantStore _store;
    private readonly AssistantScopeBuilder _scopeBuilder;
    private readonly AssistantToolRegistry _tools;
    private readonly AnthropicChat _sonnet;
    private readonly GeminiChat _flash;
    private readonly HierarchyLookup _hierarchy;
    private readonly RotaryYears _years;
    private readonly IServiceProvider _services;
    private readonly ILogger<AssistantOrchestrator> _logger;

    public AssistantOrchestrator(AssistantSettings settings, AssistantStore store, AssistantScopeBuilder scopeBuilder,
        AssistantToolRegistry tools, AnthropicChat sonnet, GeminiChat flash, HierarchyLookup hierarchy, RotaryYears years,
        IServiceProvider services, ILogger<AssistantOrchestrator> logger)
    {
        _settings = settings;
        _store = store;
        _scopeBuilder = scopeBuilder;
        _tools = tools;
        _sonnet = sonnet;
        _flash = flash;
        _hierarchy = hierarchy;
        _years = years;
        _services = services;
        _logger = logger;
    }

    public async Task RunAsync(int memberId, string memberName, long? conversationId, string rawMessage,
        SseWriter sse, CancellationToken ct)
    {
        var clean = InputSanitizer.Clean(rawMessage, _settings.MaxInputChars);
        if (clean.Problem != null)
        {
            await sse.EventAsync("error", new { message = clean.Problem, code = "too_long" }, ct);
            return;
        }
        if (!ActiveStreams.TryAdd(memberId, 0))
        {
            await sse.EventAsync("error", new { message = "An answer is already in progress. Wait for it to finish or stop it first.", code = "busy" }, ct);
            return;
        }

        var clock = Stopwatch.StartNew();
        var spent = 0m;
        var reserved = false;
        var refund = false;   // our failure (outage / not configured): the question isn't counted
        try
        {
            await using var db = await _store.OpenAsync(ct);
            var user = await _store.GetActiveUserAsync(db, memberId);
            if (user == null)
            {
                await sse.EventAsync("error", new { message = "You don't have access to the assistant.", code = "not_allowed" }, ct);
                return;
            }
            if (user.BlockedUntil > DateTime.UtcNow)
            {
                await sse.EventAsync("error", new { message = "The assistant is paused for your account for 24 hours after several flagged questions. Contact the Super Admin if this is a mistake.", code = "blocked" }, ct);
                return;
            }

            var dailyLimit = _store.DailyLimitFor(user);
            var quota = await _store.ReserveAsync(db, memberId, dailyLimit);
            if (quota != AssistantStore.QuotaResult.Ok)
            {
                var msg = quota == AssistantStore.QuotaResult.DailyLimit
                    ? $"You've used all {dailyLimit} questions for today. The allowance resets at midnight (UTC)."
                    : "The assistant has reached this month's spending limit. It will be available again next month.";
                await sse.EventAsync("error", new { message = msg, code = quota == AssistantStore.QuotaResult.DailyLimit ? "daily_limit" : "monthly_budget" }, ct);
                return;
            }
            reserved = true;

            AssistantScope scope;
            await using (var ro = new MySqlConnector.MySqlConnection(_settings.ReadOnlyConnectionString))
            {
                await ro.OpenAsync(ct);
                scope = await _scopeBuilder.BuildAsync(ro, memberId, memberName);
            }

            if (conversationId is long existing && !await _store.OwnsConversationAsync(db, memberId, existing))
                conversationId = null;
            var convId = conversationId ?? await _store.CreateConversationAsync(db, memberId, clean.Text);
            await sse.EventAsync("meta", new { conversationId = convId }, ct);

            var history = (await _store.GetHistoryAsync(db, convId, _settings.HistoryTurns))
                .Select(h => new ChatTurn(h.Role, h.Content)).ToList();
            await _store.SaveMessageAsync(db, new AssistantStore.MessageRecord
            {
                ConversationId = convId, MemberId = memberId, Role = "user", Content = clean.Text,
            });

            async Task FinishAsync(string answer, string route, string? model, string? language, LlmUsage usage,
                decimal cost, IEnumerable<string>? toolsUsed, string? flag, DateTime? cachedAtUtc = null)
            {
                await _store.SaveMessageAsync(db, new AssistantStore.MessageRecord
                {
                    ConversationId = convId, MemberId = memberId, Role = "assistant", Content = answer,
                    Route = route, Model = model, Language = language, Usage = usage, CostUsd = cost,
                    LatencyMs = (int)clock.ElapsedMilliseconds, ToolsUsed = toolsUsed == null ? null : string.Join(",", toolsUsed),
                    Flag = flag,
                });
                var today = await _store.QuestionsTodayAsync(db, memberId);
                await sse.EventAsync("done", new
                {
                    answer, route, cached = cachedAtUtc != null,
                    asOf = (cachedAtUtc ?? DateTime.UtcNow).ToString("HH:mm") + " UTC",
                    questionsToday = today, dailyLimit,
                }, ct);
            }

            async Task RefuseAsync(string kind, string message, string detail, string? language = null)
            {
                if (kind != "off_topic" && await _store.RecordSecurityEventAsync(db, memberId, kind, detail))
                    _logger.LogWarning("Assistant: member {MemberId} blocked for 24h after repeated flagged questions", memberId);
                await sse.EventAsync("delta", new { text = message }, ct);
                await FinishAsync(message, "blocked", null, language, LlmUsage.Zero, spent, null, kind);
            }

            if (!scope.HasAnyReach)
            {
                await RefuseAsync("off_topic", "Your account has no admin or Goal Setting role with data I can show.", "no reach");
                return;
            }
            if (clean.InjectionPattern != null)
            {
                await RefuseAsync("injection", MsgInjection, "pattern: " + clean.InjectionPattern);
                return;
            }

            // Exact-repeat cache: first question of a conversation only (follow-ups depend on history),
            // keyed by everything that could change the answer.
            var cacheKey = history.Count == 0 ? CacheKey(scope, clean.Text) : null;
            if (cacheKey != null && await _store.GetCachedAnswerAsync(db, cacheKey) is { } hit)
            {
                await sse.EventAsync("delta", new { text = hit.Answer }, ct);
                await FinishAsync(hit.Answer, "cache", null, null, LlmUsage.Zero, 0m, null, null, cachedAtUtc: hit.CreatedUtc);
                return;
            }

            // Guard + router. If Gemini is down the regex screen above has passed, so Sonnet takes it.
            var (verdict, complexity, language) = ("ok", "complex", (string?)null);
            if (_settings.FlashConfigured)
            {
                await sse.EventAsync("status", new { text = "Reading your question…" }, ct);
                try
                {
                    var routed = await RouteAsync(history, clean.Text, ct);
                    spent += routed.Cost;
                    // No usable verdict (Gemini declined or garbled the JSON): don't strike the member for
                    // a model hiccup - Sonnet answers, with its own safety classifiers and our prompt.
                    if (routed.Result is { } r)
                        (verdict, complexity, language) = (r.Verdict, r.Complexity, r.Language);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogWarning(ex, "Assistant router call failed; sending the question to Sonnet");
                }
            }

            switch (verdict)
            {
                case "injection": case "harmful":
                    await RefuseAsync(verdict, MsgInjection, "router: " + verdict, language); return;
                case "bulk_pii":
                    await RefuseAsync(verdict, MsgBulkPii, "router: bulk_pii", language); return;
                case "off_topic":
                    await RefuseAsync(verdict, MsgOffTopic, "router: off_topic", language); return;
            }

            var current = await _years.CurrentAsync();
            var toolCtx = new AssistantToolContext
            {
                Scope = scope, Settings = _settings, Hierarchy = _hierarchy, Years = _years, Store = _store, Services = _services,
            };
            var request = new LlmRequest
            {
                SystemPrompt = AssistantPrompts.System,
                Tools = _tools.Specs,
                History = history,
                Question = clean.Text,
                Context = AssistantPrompts.Context(scope, current.Label),
            };

            async Task<string> RunTool(ToolCall call, CancellationToken token)
            {
                await sse.EventAsync("status", new { text = ToolStatus.GetValueOrDefault(call.Name, "Looking up data…") }, token);
                var (json, isError) = await _tools.RunAsync(toolCtx, call);
                if (isError) _logger.LogInformation("Assistant tool {Tool} error for member {MemberId}: {Json}", call.Name, memberId, json);
                return json;
            }

            LlmAnswer? final = null;
            var route = "sonnet";
            var allTools = new List<string>();
            var totalUsage = LlmUsage.Zero;

            if (complexity == "simple" && _settings.FlashConfigured)
            {
                var flash = new LlmAnswer();
                try
                {
                    await _flash.AnswerAsync(new LlmRequest
                    {
                        SystemPrompt = AssistantPrompts.System + AssistantPrompts.FlashAddendum,
                        Tools = request.Tools, History = request.History, Question = request.Question, Context = request.Context,
                    }, new LlmCallbacks { RunTool = RunTool, Status = s => sse.EventAsync("status", new { text = s }, ct) }, flash, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogWarning(ex, "Assistant Flash answer failed; escalating to Sonnet");
                    flash.WantsEscalation = true;
                }
                finally
                {
                    spent += CostOf(flash);
                    totalUsage = totalUsage.Add(flash.Usage);
                    allTools.AddRange(flash.ToolsUsed);
                }

                var needsSonnet = flash.WantsEscalation || flash.HitStepLimit || flash.ToolErrors >= 2
                                  || (!flash.Refused && string.IsNullOrWhiteSpace(flash.Text));
                if (!needsSonnet || !_settings.SonnetConfigured)
                {
                    final = flash;
                    route = "flash";
                }
                else
                {
                    route = "escalated";
                    await sse.EventAsync("status", new { text = "Taking a closer look…" }, ct);
                }
            }

            if (final == null)
            {
                if (!_settings.SonnetConfigured)
                {
                    refund = true;
                    await sse.EventAsync("error", new { message = "The assistant isn't fully configured yet. Please try later.", code = "unavailable" }, ct);
                    return;
                }
                var sonnet = new LlmAnswer();
                try
                {
                    await _sonnet.AnswerAsync(request, new LlmCallbacks
                    {
                        RunTool = RunTool,
                        Status = s => sse.EventAsync("status", new { text = s }, ct),
                        TextDelta = t => sse.EventAsync("delta", new { text = t }, ct),
                        ResetText = () => sse.EventAsync("answer_reset", new { }, ct),
                    }, sonnet, ct);
                }
                finally
                {
                    spent += CostOf(sonnet);
                    totalUsage = totalUsage.Add(sonnet.Usage);
                    allTools.AddRange(sonnet.ToolsUsed);
                }
                final = sonnet;
            }

            if (final.Refused)
            {
                await sse.EventAsync("answer_reset", new { }, ct);
                await RefuseAsync("model_refusal", MsgRefused, $"{final.Model} refused", language);
                return;
            }

            var text = string.IsNullOrWhiteSpace(final.Text) || final.Text.Contains("[[ESCALATE]]")
                ? MsgNoAnswer : final.Text;
            if (route != "sonnet" && route != "escalated")
                await StreamBufferedAsync(sse, text, ct);   // Flash answers were held back until known-good

            if (cacheKey != null && text != MsgNoAnswer && !toolCtx.UsedContactData)
                await _store.PutCachedAnswerAsync(db, cacheKey, text, final.Model);

            await FinishAsync(text, route, final.Model, language, totalUsage, spent, allTools,
                toolCtx.UsedContactData ? "contact" : null);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            _logger.LogInformation("Assistant request cancelled by member {MemberId}", memberId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Assistant request failed for member {MemberId}", memberId);
            refund = true;
            try { await sse.EventAsync("error", new { message = "Something went wrong while answering. Please try again.", code = "unavailable" }, ct); }
            catch { /* client already gone */ }
        }
        finally
        {
            ActiveStreams.TryRemove(memberId, out _);
            if (reserved)
            {
                // Always settle - including after a cancel - so the reservation is released and real
                // spend is counted. Uses a fresh token: the request's one may already be cancelled.
                try
                {
                    await using var db = await _store.OpenAsync(CancellationToken.None);
                    await _store.SettleAsync(db, memberId, spent);
                    if (refund) await _store.RefundQuestionAsync(db, memberId);
                }
                catch (Exception ex) { _logger.LogError(ex, "Assistant cost settlement failed for member {MemberId}", memberId); }
            }
        }
    }

    private sealed record RouteResult(string Verdict, string Complexity, string? Language);

    private async Task<(RouteResult? Result, decimal Cost)> RouteAsync(List<ChatTurn> history, string question, CancellationToken ct)
    {
        // The last answer gives follow-ups ("and last year?") their meaning. JSON-encoding the user's
        // text means it can't close the <message> tag and pose as instructions.
        var lastAnswer = history.LastOrDefault(h => h.Role == "assistant")?.Content;
        var input = new StringBuilder();
        if (lastAnswer != null)
            input.Append("<previous_answer>").Append(JsonSerializer.Serialize(Truncate(lastAnswer, 600))).Append("</previous_answer>\n");
        input.Append("<message>").Append(JsonSerializer.Serialize(question)).Append("</message>");

        var (json, usage) = await _flash.ClassifyAsync(AssistantPrompts.Router, input.ToString(),
            JsonNode.Parse(AssistantPrompts.RouterSchema)!, ct);
        var cost = usage.CostUsd(_settings.PriceFor(_settings.FlashModel, DateTime.UtcNow));
        if (json is not { } j) return (null, cost);
        string? Get(string name) => j.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        var verdict = Get("verdict");
        if (verdict is not ("ok" or "injection" or "bulk_pii" or "off_topic" or "harmful")) return (null, cost);
        return (new RouteResult(verdict, Get("complexity") == "simple" ? "simple" : "complex", Get("language")), cost);
    }

    private decimal CostOf(LlmAnswer a) =>
        string.IsNullOrEmpty(a.Model) ? 0m : a.Usage.CostUsd(_settings.PriceFor(a.Model, DateTime.UtcNow));

    // A buffered (Flash or cached) answer still arrives in pieces, so the UI behaves the same.
    private static async Task StreamBufferedAsync(SseWriter sse, string text, CancellationToken ct)
    {
        const int chunk = 120;
        for (var i = 0; i < text.Length; i += chunk)
            await sse.EventAsync("delta", new { text = text.Substring(i, Math.Min(chunk, text.Length - i)) }, ct);
    }

    public static string CacheKey(AssistantScope scope, string question) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            $"{AssistantPrompts.Version}|{scope.Fingerprint()}|{InputSanitizer.NormaliseForCache(question)}"))).ToLowerInvariant();

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
