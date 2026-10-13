namespace RotaryApi.Services;

// Fires the District Performance Report + the RI Director (all zones) report once a day at Brand:Scope DistrictReportSendHour (default 7:00) in the brand's time zone.
// Schedule / recipients are HARD-CODED in DistrictPerformanceReportService (no appsettings):
//   Test (now) → District 3142 + the all-zones report, every day, to the two test addresses.
//   Live (later) → only on the 1st & 16th: each district to its DG, the all-zones report to the RI Directors.
// If the API starts AFTER today's hour, one catch-up run is made; it only sends districts whose run log
// VERIFIES nothing went out today, so a restart can never mail a district twice. Scheduled sends are
// suppressed on a dev machine (remote DB).
public class DistrictPerformanceReportBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<DistrictPerformanceReportBackgroundService> _logger;
    private readonly bool _enabled;
    private readonly int _hour;

    public DistrictPerformanceReportBackgroundService(IServiceScopeFactory scopeFactory,
        IConfiguration config, ILogger<DistrictPerformanceReportBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        // Hard-coded in DistrictPerformanceReportService (user 2026-09-17): ON, every morning at the brand's send hour.
        _enabled = DistrictPerformanceReportService.ScheduleOn;
        _hour = DistrictPerformanceReportService.SendHour;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_enabled)
        {
            _logger.LogInformation("District performance report schedule is disabled (DistrictPerformanceReport:Enabled=false).");
            return;
        }

        // Let the host finish starting, then catch up if today's hour has already passed.
        try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); }
        catch (TaskCanceledException) { return; }
        try
        {
            var zone = BrandZone();
            var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone);
            if (nowLocal.Hour >= _hour) await RunAsync(catchUp: true, stoppingToken);
        }
        catch (Exception ex) { _logger.LogError(ex, "District performance report catch-up run failed."); }

        while (!stoppingToken.IsCancellationRequested)
        {
            TimeSpan delay;
            try { delay = TimeUntilNextRun(); }
            catch (Exception ex) { _logger.LogError(ex, "District performance report: could not compute next run; retrying in 1h."); delay = TimeSpan.FromHours(1); }

            try { await Task.Delay(delay, stoppingToken); }
            catch (TaskCanceledException) { break; }
            if (stoppingToken.IsCancellationRequested) break;

            try { await RunAsync(catchUp: false, stoppingToken); }
            catch (Exception ex) { _logger.LogError(ex, "District performance report run failed."); }
        }
    }

    private async Task RunAsync(bool catchUp, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var svc = scope.ServiceProvider.GetRequiredService<IDistrictPerformanceReportService>();
        await svc.RunScheduledAsync(catchUp, ct);
    }

    private TimeSpan TimeUntilNextRun()
    {
        var zone = BrandZone();
        var nowLocal = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone);
        var runToday = new DateTimeOffset(nowLocal.Year, nowLocal.Month, nowLocal.Day, _hour, 0, 0, nowLocal.Offset);
        var next = nowLocal < runToday ? runToday : runToday.AddDays(1);
        var delay = next - nowLocal;
        return delay < TimeSpan.Zero ? TimeSpan.Zero : delay;
    }

    private static TimeZoneInfo BrandZone() => Brand.TimeZone;
}
