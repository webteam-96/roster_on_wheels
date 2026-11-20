namespace RotaryApi.Services;

/// <summary>
/// Sends volunteer sheets' follow-up emails (VolunteerExtrasService.RunFollowupsAsync), once per sign-up, only while
/// the "volunteers" switch is on. VolunteerFollowups:TickSeconds sets the pass interval (default 60).
/// </summary>
public class VolunteerFollowupBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<VolunteerFollowupBackgroundService> _log;
    private readonly string _cs;
    private readonly TimeSpan _tick;

    public VolunteerFollowupBackgroundService(IServiceScopeFactory scopes, ILogger<VolunteerFollowupBackgroundService> log, IConfiguration config)
    {
        _scopes = scopes;
        _log = log;
        _cs = config.GetConnectionString("DefaultConnection")!;
        _tick = TimeSpan.FromSeconds(Math.Clamp(config.GetValue("VolunteerFollowups:TickSeconds", 60), 5, 3600));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if ((await FeatureGate.OnAsync(_cs)).Contains("volunteers"))
                {
                    using var scope = _scopes.CreateScope();
                    var sent = await scope.ServiceProvider.GetRequiredService<VolunteerExtrasService>().RunFollowupsAsync(stoppingToken);
                    if (sent > 0) _log.LogInformation("Volunteer follow-ups: {Count} sent", sent);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogError(ex, "Volunteer follow-up tick failed"); }
            try { await Task.Delay(_tick, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}
