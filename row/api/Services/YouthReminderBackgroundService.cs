namespace RotaryApi.Services;

/// <summary>
/// Youth Protection expiry reminders (gap #12): every minute (one indexed query), while the "youth_programs" switch is on, emails volunteers
/// whose clearance expires within 60 days (YouthService.SendExpiryRemindersAsync, once per expiry date).
/// </summary>
public class YouthReminderBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<YouthReminderBackgroundService> _log;
    private readonly string _cs;

    public YouthReminderBackgroundService(IServiceScopeFactory scopes, ILogger<YouthReminderBackgroundService> log, IConfiguration config)
    {
        _scopes = scopes;
        _log = log;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await FeatureGate.IsOnAsync("youth_programs", _cs))
                {
                    using var scope = _scopes.CreateScope();
                    var sp = scope.ServiceProvider;
                    var n = await sp.GetRequiredService<YouthService>().SendExpiryRemindersAsync(sp.GetRequiredService<IEmailService>(), stoppingToken);
                    if (n > 0) _log.LogInformation("Youth Protection expiry reminders claimed: {Count}", n);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogError(ex, "Youth reminder tick failed"); }
            try { await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}
