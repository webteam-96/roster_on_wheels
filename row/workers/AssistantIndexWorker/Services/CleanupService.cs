using RotaryApi.Services;
using Dapper;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace AssistantIndexWorker.Services;

// --cleanup: retention purge of the assistant's own tables, in batched DELETE ... LIMIT loops so a
// large backlog never holds long locks. The API stamps updated_date / expires_at with UTC_TIMESTAMP()
// and everything else with the server clock (CURRENT_TIMESTAMP), so each rule compares like with like.
public sealed class CleanupService
{
    private const int BatchSize = 5000;

    private static readonly (string Label, string Table, string Where)[] Rules =
    {
        ("messages older than 90 days", "assistant_messages",
            "created_date < NOW() - INTERVAL 90 DAY"),
        // Messages are purged first, so a conversation idle for 90 days has none left. The 1-day grace
        // keeps a conversation whose first message is still being written.
        ("conversations with no messages left or idle > 90 days", "assistant_conversations",
            @"(updated_date < UTC_TIMESTAMP() - INTERVAL 90 DAY
               OR (created_date < NOW() - INTERVAL 1 DAY
                   AND NOT EXISTS (SELECT 1 FROM assistant_messages m
                                   WHERE m.conversation_id = assistant_conversations.pk_conversation_id)))"),
        ("expired answer-cache rows", "assistant_answer_cache",
            "expires_at < UTC_TIMESTAMP()"),
        ("security events older than 90 days", "assistant_security_events",
            "created_date < NOW() - INTERVAL 90 DAY"),
        ("daily usage rows older than 400 days", "assistant_usage_daily",
            "usage_date < CURDATE() - INTERVAL 400 DAY"),
    };

    private readonly string _connString;
    private readonly ILogger<CleanupService> _log;

    public CleanupService(string connString, ILogger<CleanupService> log)
    {
        _connString = connString;
        _log = log;
    }

    public async Task RunAsync(bool dryRun)
    {
        await using var conn = RowDb.Connect(_connString);
        await conn.OpenAsync();
        foreach (var (label, table, where) in Rules)
        {
            if (dryRun)
            {
                var count = await conn.ExecuteScalarAsync<long>($"SELECT COUNT(*) FROM {table} WHERE {where}", commandTimeout: 300);
                _log.LogInformation("[cleanup] Would delete {Count} {Label}.", count, label);
                continue;
            }

            long total = 0;
            int deleted;
            do
            {
                deleted = await conn.ExecuteAsync($"DELETE FROM {table} WHERE {where} LIMIT {BatchSize}", commandTimeout: 300);
                total += deleted;
            } while (deleted == BatchSize);
            _log.LogInformation("[cleanup] Deleted {Count} {Label}.", total, label);
        }
    }
}
