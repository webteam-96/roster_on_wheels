using Dapper;
using MySqlConnector;

namespace RotaryApi.Services.Push;

/// <summary>
/// Daily 04:00 cleanup of push log tables — keeps only last 5 days of data.
/// Without this the log tables would grow unbounded (each push fans out to ~100s of rows).
/// </summary>
public class PushLogCleanupBackgroundService : BackgroundService
{
    private static readonly TimeSpan ScheduledTimeOfDay = TimeSpan.FromHours(4); // 04:00 local
    private static readonly TimeSpan RetentionDays = TimeSpan.FromDays(5);

    private readonly IConfiguration _config;
    private readonly ILogger<PushLogCleanupBackgroundService> _logger;

    public PushLogCleanupBackgroundService(IConfiguration config, ILogger<PushLogCleanupBackgroundService> logger)
    {
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var now = DateTime.Now;
            var next = now.Date.Add(ScheduledTimeOfDay);
            if (next <= now) next = next.AddDays(1);
            var delay = next - now;
            _logger.LogInformation("[PushLogCleanup] next run at {Next} (in {Hours:F1} hr)", next, delay.TotalHours);

            try { await Task.Delay(delay, stoppingToken); }
            catch (TaskCanceledException) { return; }

            await RunOnceAsync(stoppingToken);
        }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        try
        {
            var connStr = _config.GetConnectionString("DefaultConnection")!;
            using var conn = new MySqlConnection(connStr);
            await conn.OpenAsync(ct);

            var cutoff = DateTime.Now.Subtract(RetentionDays);
            int total = 0;
            foreach (var table in new[] {
                "announcement_push_log",
                "announcement_reminder_push_log",
                "event_push_log",
                "event_reminder_push_log",
                "document_push_log",
            })
            {
                var deleted = await conn.ExecuteAsync($"DELETE FROM {table} WHERE created_date < @C", new { C = cutoff });
                total += deleted;
                _logger.LogInformation("[PushLogCleanup] {Table}: deleted {N} rows older than {C:yyyy-MM-dd}", table, deleted, cutoff);
            }
            _logger.LogInformation("[PushLogCleanup] total rows deleted across all tables: {N}", total);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[PushLogCleanup] cleanup FAILED");
        }
    }
}
