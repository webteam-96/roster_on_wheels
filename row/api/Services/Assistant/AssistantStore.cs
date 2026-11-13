using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Assistant;

// All writes the assistant makes - only ever to its own assistant_* tables, on the main connection.
// Data tools never come through here; they use the read-only connection (AssistantToolContext).
public sealed class AssistantStore
{
    // Reserved per question before any model call, settled to the real cost afterwards. Comfortably
    // above a typical Sonnet answer with a few tool calls, so the monthly cap is never overshot.
    public const decimal ReservationUsd = 0.10m;

    // The daily question allowance resets at midnight UTC (ROW serves clubs in many time zones).
    private const string IstToday = "DATE(UTC_TIMESTAMP())";

    private readonly AssistantSettings _settings;

    public AssistantStore(AssistantSettings settings) => _settings = settings;

    public async Task<MySqlConnection> OpenAsync(CancellationToken ct = default)
    {
        var conn = new MySqlConnection(_settings.WriterConnectionString);
        await conn.OpenAsync(ct);
        return conn;
    }

    // ── Access ──────────────────────────────────────────────────────────────

    public sealed class UserRow
    {
        public int MemberId { get; set; }
        public int? DailyLimit { get; set; }
        public DateTime? BlockedUntil { get; set; }
    }

    public async Task<UserRow?> GetActiveUserAsync(MySqlConnection conn, int memberId) =>
        await conn.QuerySingleOrDefaultAsync<UserRow>(@"
            SELECT member_id AS MemberId, daily_limit AS DailyLimit, blocked_until AS BlockedUntil
            FROM assistant_users WHERE member_id = @memberId AND is_active = 1",
            new { memberId });

    public int DailyLimitFor(UserRow u) => u.DailyLimit ?? _settings.DailyQuestionsPerUser;

    public async Task<int> QuestionsTodayAsync(MySqlConnection conn, int memberId) =>
        await conn.ExecuteScalarAsync<int?>(
            $"SELECT questions FROM assistant_usage_daily WHERE member_id = @memberId AND usage_date = {IstToday}",
            new { memberId }) ?? 0;

    // Logs a flagged question. Returns true when this one tips the member into a 24h block.
    public async Task<bool> RecordSecurityEventAsync(MySqlConnection conn, int memberId, string kind, string detail)
    {
        await conn.ExecuteAsync(
            "INSERT INTO assistant_security_events (member_id, kind, detail) VALUES (@memberId, @kind, @detail)",
            new { memberId, kind, detail = Truncate(detail, 500) });
        var recent = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM assistant_security_events
            WHERE member_id = @memberId AND created_date > UTC_TIMESTAMP() - INTERVAL 24 HOUR",
            new { memberId });
        if (recent < _settings.FlaggedAttemptsBeforeBlock) return false;
        await conn.ExecuteAsync(
            "UPDATE assistant_users SET blocked_until = UTC_TIMESTAMP() + INTERVAL 24 HOUR WHERE member_id = @memberId",
            new { memberId });
        return true;
    }

    // ── Quota ───────────────────────────────────────────────────────────────

    public enum QuotaResult { Ok, DailyLimit, MonthlyBudget }

    // Atomic: the daily count and the monthly reservation are both conditional UPDATEs, so parallel
    // requests can't overshoot either cap. If the budget is gone the daily count is given back.
    public async Task<QuotaResult> ReserveAsync(MySqlConnection conn, int memberId, int dailyLimit)
    {
        await conn.ExecuteAsync($@"
            INSERT INTO assistant_usage_daily (member_id, usage_date) VALUES (@memberId, {IstToday})
            ON DUPLICATE KEY UPDATE member_id = member_id", new { memberId });
        var counted = await conn.ExecuteAsync($@"
            UPDATE assistant_usage_daily SET questions = questions + 1
            WHERE member_id = @memberId AND usage_date = {IstToday} AND questions < @dailyLimit",
            new { memberId, dailyLimit });
        if (counted == 0) return QuotaResult.DailyLimit;

        var month = DateTime.UtcNow.ToString("yyyy-MM");
        await conn.ExecuteAsync(@"
            INSERT INTO assistant_budget_monthly (budget_month, cap_usd) VALUES (@month, @cap)
            ON DUPLICATE KEY UPDATE cap_usd = @cap", new { month, cap = _settings.MonthlyBudgetUsd });
        var reserved = await conn.ExecuteAsync(@"
            UPDATE assistant_budget_monthly SET reserved_usd = reserved_usd + @est
            WHERE budget_month = @month AND spent_usd + reserved_usd + @est <= cap_usd",
            new { month, est = ReservationUsd });
        if (reserved > 0) return QuotaResult.Ok;

        await conn.ExecuteAsync($@"
            UPDATE assistant_usage_daily SET questions = GREATEST(questions - 1, 0)
            WHERE member_id = @memberId AND usage_date = {IstToday}", new { memberId });
        return QuotaResult.MonthlyBudget;
    }

    // Always called once per successful Reserve, even when the answer failed or the client left.
    public async Task SettleAsync(MySqlConnection conn, int memberId, decimal actualUsd)
    {
        var month = DateTime.UtcNow.ToString("yyyy-MM");
        await conn.ExecuteAsync(@"
            UPDATE assistant_budget_monthly
            SET reserved_usd = GREATEST(reserved_usd - @est, 0), spent_usd = spent_usd + @actual
            WHERE budget_month = @month", new { month, est = ReservationUsd, actual = actualUsd });
        await conn.ExecuteAsync($@"
            UPDATE assistant_usage_daily SET cost_usd = cost_usd + @actual
            WHERE member_id = @memberId AND usage_date = {IstToday}", new { memberId, actual = actualUsd });
    }

    // A question that got no answer (outage, misconfiguration, crash) doesn't use up the allowance.
    public async Task RefundQuestionAsync(MySqlConnection conn, int memberId) =>
        await conn.ExecuteAsync($@"
            UPDATE assistant_usage_daily SET questions = GREATEST(questions - 1, 0)
            WHERE member_id = @memberId AND usage_date = {IstToday}", new { memberId });

    public async Task<bool> TryUseContactLookupAsync(MySqlConnection conn, int memberId) =>
        await conn.ExecuteAsync($@"
            UPDATE assistant_usage_daily SET contact_lookups = contact_lookups + 1
            WHERE member_id = @memberId AND usage_date = {IstToday} AND contact_lookups < @limit",
            new { memberId, limit = _settings.ContactLookupsPerDay }) > 0;

    // ── Conversations ───────────────────────────────────────────────────────

    public async Task<long> CreateConversationAsync(MySqlConnection conn, int memberId, string firstQuestion)
    {
        var title = Truncate(firstQuestion.Replace('\n', ' '), 80)!;
        return await conn.ExecuteScalarAsync<long>(@"
            INSERT INTO assistant_conversations (member_id, title) VALUES (@memberId, @title);
            SELECT LAST_INSERT_ID();", new { memberId, title });
    }

    public async Task<bool> OwnsConversationAsync(MySqlConnection conn, int memberId, long conversationId) =>
        await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM assistant_conversations
            WHERE pk_conversation_id = @conversationId AND member_id = @memberId AND isdeleted = 0",
            new { conversationId, memberId }) > 0;

    public sealed record ConversationSummary(long Id, string Title, DateTime UpdatedDate);

    public async Task<List<ConversationSummary>> ListConversationsAsync(MySqlConnection conn, int memberId) =>
        (await conn.QueryAsync<ConversationSummary>(@"
            SELECT pk_conversation_id AS Id, title AS Title, updated_date AS UpdatedDate
            FROM assistant_conversations
            WHERE member_id = @memberId AND isdeleted = 0
            ORDER BY updated_date DESC LIMIT 100", new { memberId })).ToList();

    public async Task<bool> DeleteConversationAsync(MySqlConnection conn, int memberId, long conversationId) =>
        await conn.ExecuteAsync(@"
            UPDATE assistant_conversations SET isdeleted = 1
            WHERE pk_conversation_id = @conversationId AND member_id = @memberId",
            new { conversationId, memberId }) > 0;

    public sealed record StoredMessage(long Id, string Role, string Content, string? Route, DateTime CreatedDate);

    public async Task<List<StoredMessage>> GetMessagesAsync(MySqlConnection conn, long conversationId) =>
        (await conn.QueryAsync<StoredMessage>(@"
            SELECT pk_message_id AS Id, role AS Role, content AS Content, route AS Route, created_date AS CreatedDate
            FROM assistant_messages WHERE conversation_id = @conversationId
            ORDER BY pk_message_id", new { conversationId })).ToList();

    // Last N question/answer pairs as plain text - the only history a model ever gets, which keeps
    // prompts small and lets a conversation move between Gemini and Claude.
    public async Task<List<(string Role, string Content)>> GetHistoryAsync(MySqlConnection conn, long conversationId, int turns)
    {
        var rows = await conn.QueryAsync<(string Role, string Content)>(@"
            SELECT role, content FROM assistant_messages
            WHERE conversation_id = @conversationId AND COALESCE(route,'') NOT IN ('blocked','error')
            ORDER BY pk_message_id DESC LIMIT @limit", new { conversationId, limit = turns * 2 });
        var list = rows.Reverse().ToList();
        // Must start on a user turn and alternate; drop a dangling leading answer.
        while (list.Count > 0 && list[0].Role != "user") list.RemoveAt(0);
        return list;
    }

    public sealed class MessageRecord
    {
        public long ConversationId { get; init; }
        public int MemberId { get; init; }
        public string Role { get; init; } = "";
        public string Content { get; init; } = "";
        public string? Route { get; init; }
        public string? Model { get; init; }
        public string? Language { get; init; }
        public LlmUsage Usage { get; init; } = LlmUsage.Zero;
        public decimal CostUsd { get; init; }
        public int LatencyMs { get; init; }
        public string? ToolsUsed { get; init; }
        public string? Flag { get; init; }
    }

    public async Task SaveMessageAsync(MySqlConnection conn, MessageRecord m)
    {
        await conn.ExecuteAsync(@"
            INSERT INTO assistant_messages
                (conversation_id, member_id, role, content, route, model, language, input_tokens, output_tokens,
                 cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, tools_used, flag)
            VALUES (@ConversationId, @MemberId, @Role, @Content, @Route, @Model, @Language, @In, @Out,
                    @CacheRead, @CacheWrite, @CostUsd, @LatencyMs, @ToolsUsed, @Flag);
            UPDATE assistant_conversations SET updated_date = UTC_TIMESTAMP() WHERE pk_conversation_id = @ConversationId;",
            new
            {
                m.ConversationId, m.MemberId, m.Role, m.Content, m.Route, m.Model, m.Language,
                In = m.Usage.InputTokens, Out = m.Usage.OutputTokens,
                CacheRead = m.Usage.CacheReadTokens, CacheWrite = m.Usage.CacheWriteTokens,
                m.CostUsd, m.LatencyMs, ToolsUsed = Truncate(m.ToolsUsed, 1000), Flag = Truncate(m.Flag, 60),
            });
    }

    // ── Answer cache ────────────────────────────────────────────────────────

    public sealed record CachedAnswer(string Answer, DateTime CreatedUtc);

    public async Task<CachedAnswer?> GetCachedAnswerAsync(MySqlConnection conn, string key)
    {
        var hit = await conn.QuerySingleOrDefaultAsync<CachedAnswer>(
            "SELECT answer AS Answer, created_date AS CreatedUtc FROM assistant_answer_cache WHERE cache_key = @key AND expires_at > UTC_TIMESTAMP()",
            new { key });
        if (hit != null)
            await conn.ExecuteAsync("UPDATE assistant_answer_cache SET hits = hits + 1 WHERE cache_key = @key", new { key });
        return hit;
    }

    public async Task PutCachedAnswerAsync(MySqlConnection conn, string key, string answer, string model) =>
        await conn.ExecuteAsync(@"
            INSERT INTO assistant_answer_cache (cache_key, answer, model, created_date, expires_at)
            VALUES (@key, @answer, @model, UTC_TIMESTAMP(), UTC_TIMESTAMP() + INTERVAL @ttl MINUTE)
            ON DUPLICATE KEY UPDATE answer = @answer, model = @model, created_date = UTC_TIMESTAMP(),
                                    expires_at = UTC_TIMESTAMP() + INTERVAL @ttl MINUTE, hits = 0",
            new { key, answer, model, ttl = _settings.AnswerTtlMinutes });

    private static string? Truncate(string? s, int max) => s == null || s.Length <= max ? s : s[..max];
}
