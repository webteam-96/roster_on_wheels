namespace RotaryApi.Services;

// Fires the daily statistics report (DailyStatsReportService) once a day at 06:00 IST.
// Config (appsettings "DailyStatsReport"): Enabled (default true), Hour (default 6, 0–23).
// The service itself suppresses the real email when running against a remote DB (dev machine),
// so this can stay enabled everywhere and only actually mails from the production server.
public class DailyStatsReportBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DailyStatsReportBackgroundService> _logger;
    private readonly bool _enabled;
    private readonly int _hour;

    public DailyStatsReportBackgroundService(IServiceScopeFactory scopeFactory,
        IConfiguration config, ILogger<DailyStatsReportBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _enabled = config.GetValue<bool?>("DailyStatsReport:Enabled") ?? true;
        var h = config.GetValue<int?>("DailyStatsReport:Hour") ?? 6;
        _hour = (h >= 0 && h <= 23) ? h : 6;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_enabled)
        {
            _logger.LogInformation("Daily statistics report is disabled (DailyStatsReport:Enabled=false).");
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            TimeSpan delay;
            try { delay = TimeUntilNextRun(); }
            catch (Exception ex) { _logger.LogError(ex, "Daily report: could not compute next run; retrying in 1h."); delay = TimeSpan.FromHours(1); }

            try { await Task.Delay(delay, stoppingToken); }
            catch (TaskCanceledException) { break; }
            if (stoppingToken.IsCancellationRequested) break;

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var svc = scope.ServiceProvider.GetRequiredService<IDailyStatsReportService>();
                await svc.SendDailyReportAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Daily statistics report run failed.");
            }
        }
    }

    // Delay until the next _hour:00 in India Standard Time.
    private TimeSpan TimeUntilNextRun()
    {
        var ist = ResolveIst();
        var nowIst = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, ist);
        var runToday = new DateTimeOffset(nowIst.Year, nowIst.Month, nowIst.Day, _hour, 0, 0, nowIst.Offset);
        var next = nowIst < runToday ? runToday : runToday.AddDays(1);
        var delay = next - nowIst;
        return delay < TimeSpan.Zero ? TimeSpan.Zero : delay;
    }

    private static TimeZoneInfo ResolveIst()
    {
        foreach (var id in new[] { "India Standard Time", "Asia/Kolkata" })
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
            catch { /* try next */ }
        }
        // Last resort: a fixed +05:30 offset zone.
        return TimeZoneInfo.CreateCustomTimeZone("IST", TimeSpan.FromMinutes(330), "IST", "IST");
    }
}
