namespace RotaryApi.Services;

// Runs the District Performance Report schedule at the top of every UTC hour: each district is sent at Brand:Scope
// DistrictReportSendHour (default 7:00) in its own time zone (N12, ZoneTime).
// Schedule / recipients are HARD-CODED in DistrictPerformanceReportService (no appsettings):
//   Test (now) → District 3142, every day, to the two test addresses.
//   Live (later) → only on the 1st & 16th: each district to its DG.
// The first tick (2 minutes after start) catches up any district whose hour has passed today; a later hour only sends
// districts whose run log VERIFIES nothing went out that local day, so a restart can never mail a district twice.
// Scheduled sends are suppressed on a dev machine (remote DB).
public class DistrictPerformanceReportBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DistrictPerformanceReportBackgroundService> _logger;
    private readonly bool _enabled;

    public DistrictPerformanceReportBackgroundService(IServiceScopeFactory scopeFactory,
        IConfiguration config, ILogger<DistrictPerformanceReportBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        // Hard-coded in DistrictPerformanceReportService (user 2026-09-17): ON, every morning at the send hour.
        _enabled = DistrictPerformanceReportService.ScheduleOn;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_enabled)
        {
            _logger.LogInformation("District performance report schedule is disabled (DistrictPerformanceReport:Enabled=false).");
            return;
        }

        // Let the host finish starting; the first tick is the catch-up.
        try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); }
        catch (TaskCanceledException) { return; }

        var afterStart = true;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                await scope.ServiceProvider.GetRequiredService<IDistrictPerformanceReportService>().RunScheduledAsync(DateTime.UtcNow, afterStart, stoppingToken);
            }
            catch (Exception ex) { _logger.LogError(ex, "District performance report run failed."); }
            afterStart = false;

            var now = DateTime.UtcNow;
            var next = new DateTime(now.Year, now.Month, now.Day, now.Hour, 0, 0, DateTimeKind.Utc).AddHours(1);
            try { await Task.Delay(next - now, stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }
}
