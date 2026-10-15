namespace RotaryApi.Services.RotaryOrg;

/// Refreshes the Rotary.org /clubs cache (rotary_org_clubs_cache) automatically ONCE a day at
/// 08:00 India time. Fully server-side (no UI, no loading). The manual "Refresh from Rotary.org"
/// button stays for one-off corrections. Uses the guarded ClubCacheRefreshService (a 0-club API
/// response never wipes the cache). If the cache is empty on startup it is populated immediately so
/// the Club Sync page is never blank.
public class ClubCacheRefreshBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<ClubCacheRefreshBackgroundService> _logger;

    public ClubCacheRefreshBackgroundService(IServiceScopeFactory scopeFactory, ILogger<ClubCacheRefreshBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ClubCacheRefreshBackgroundService started (daily at 08:00 India time)");

        // Let the app finish booting, then seed the cache if it's empty (never leave it blank).
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
            using var scope = _scopeFactory.CreateScope();
            var svc = scope.ServiceProvider.GetRequiredService<IClubCacheRefreshService>();
            if (await svc.GetLastRefreshUtcAsync(stoppingToken) == null)
            {
                _logger.LogInformation("[ClubCacheRefresh] cache empty on startup — refreshing now.");
                await svc.RefreshAsync(stoppingToken);
            }
        }
        catch (TaskCanceledException) { return; }
        catch (Exception ex) { _logger.LogError(ex, "[ClubCacheRefresh] startup seed check failed."); }

        while (!stoppingToken.IsCancellationRequested)
        {
            var nextRunUtc = ClubCacheRefreshService.GetNextScheduledRunUtc();
            var wait = nextRunUtc - DateTime.UtcNow;
            if (wait < TimeSpan.Zero) wait = TimeSpan.Zero;
            // Sleep in ≤1h chunks so long waits re-check periodically (clock changes / DST).
            var sleep = wait > TimeSpan.FromHours(1) ? TimeSpan.FromHours(1) : wait;

            try { await Task.Delay(sleep, stoppingToken); }
            catch (TaskCanceledException) { break; }

            if (DateTime.UtcNow < nextRunUtc || stoppingToken.IsCancellationRequested) continue; // not 08:00 yet

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var svc = scope.ServiceProvider.GetRequiredService<IClubCacheRefreshService>();
                var (upserted, deleted, skippedEmpty) = await svc.RefreshAsync(stoppingToken);
                if (skippedEmpty)
                    _logger.LogWarning("[ClubCacheRefresh] 08:00 run skipped (0 clubs from Rotary.org) — cache preserved.");
                else
                    _logger.LogInformation("[ClubCacheRefresh] 08:00 run OK — {U} upserted, {D} stale removed.", upserted, deleted);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[ClubCacheRefresh] 08:00 run failed (next attempt tomorrow).");
            }

            // Step past 08:00 so the next loop schedules tomorrow, never a same-day double run.
            try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }
}
