namespace RotaryApi.Services;

/// <summary>
/// Runs the scheduled cut-over (ROW build spec 3.1): every 15 minutes, each planning district whose cutover_at
/// (1 July, midnight in the brand's time zone, set when planning starts) has passed goes live through
/// PlanningService.CutOverAsync. Nothing runs while the planning_mode switch is off.
/// </summary>
public class PlanningCutoverBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<PlanningCutoverBackgroundService> _logger;
    private readonly string _connectionString;

    public PlanningCutoverBackgroundService(IServiceScopeFactory scopes, ILogger<PlanningCutoverBackgroundService> logger, IConfiguration config)
    {
        _scopes = scopes;
        _logger = logger;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // let the database initialiser add the planning columns first
        await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await FeatureGate.IsOnAsync(PlanningAccess.FeatureKey, _connectionString))
                {
                    using var scope = _scopes.CreateScope();
                    var planning = scope.ServiceProvider.GetRequiredService<PlanningService>();
                    foreach (var districtId in await planning.DueCutoversAsync())
                    {
                        try
                        {
                            await planning.CutOverAsync(districtId, 0, null);
                            _logger.LogInformation("Scheduled cut-over done for district {DistrictId}", districtId);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "Scheduled cut-over failed for district {DistrictId}", districtId);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Scheduled cut-over check failed");
            }
            await Task.Delay(TimeSpan.FromMinutes(15), stoppingToken);
        }
    }
}
