using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public class ZonalAwardsAutoCalculationBackgroundService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<ZonalAwardsAutoCalculationBackgroundService> _logger;
    private readonly string _connectionString;
    private readonly IConfiguration _configuration;

    public ZonalAwardsAutoCalculationBackgroundService(IServiceProvider serviceProvider, IConfiguration configuration, ILogger<ZonalAwardsAutoCalculationBackgroundService> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        _configuration = configuration;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Wait 60 seconds after startup before first run
        await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // Kill-switch: auto-calc stays paused until explicitly enabled in config.
                // Prevents overwriting migrated Auto values before they're verified.
                if (!_configuration.GetValue<bool>("ZonalAwards:AutoCalcEnabled"))
                {
                    _logger.LogInformation("Zonal awards auto calculation is PAUSED (ZonalAwards:AutoCalcEnabled=false). Skipping run.");
                }
                else
                {
                    _logger.LogInformation("Zonal awards auto calculation started.");
                    await RunAllDistrictsAsync();
                    _logger.LogInformation("Zonal awards auto calculation completed.");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in zonal awards auto calculation.");
            }

            // Run every 24 hours
            await Task.Delay(TimeSpan.FromHours(24), stoppingToken);
        }
    }

    private async Task RunAllDistrictsAsync()
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        // Current rotary year ONLY — never past or future. The IsCurrent flag
        // is set by the year-rollover job once per year, so this naturally
        // tracks "now" without any extra config.
        var yearId = await conn.ExecuteScalarAsync<int?>(
            "SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        if (!yearId.HasValue)
        {
            _logger.LogWarning("Zonal awards: no current rotary year set — skipping run.");
            return;
        }

        // Early exit when Zonal Awards isn't configured for the current year
        // (no goals/questions defined yet). Without this, the per-district
        // calc loop ran wasted SELECTs against empty tables on every tick.
        var hasGoals = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM zonal_awards_goal WHERE fk_year_id = @Y AND isdeleted = 0",
            new { Y = yearId.Value });
        if (hasGoals == 0)
        {
            _logger.LogInformation("Zonal awards: no goals configured for current year {YearId} — skipping run.", yearId.Value);
            return;
        }

        // Districts in zones where zonal awards is enabled.
        // Active flags on both district + zone added so kill-switched districts
        // / zones don't keep recalculating.
        var districtIds = (await conn.QueryAsync<int>(@"
            SELECT d.pk_district_id
            FROM district_master d
            INNER JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.isdeleted = 0 AND d.IsActive = 1
              AND z.isdeleted = 0 AND z.IsActive = 1
              AND z.IsZonalAwardsEnabled = 1")).ToList();

        if (districtIds.Count == 0)
        {
            _logger.LogInformation("Zonal awards: no active districts in zones with Zonal Awards enabled — skipping run.");
            return;
        }

        using var scope = _serviceProvider.CreateScope();
        var calcService = scope.ServiceProvider.GetRequiredService<ZonalAwardsAutoCalculationService>();

        foreach (var districtId in districtIds)
        {
            try
            {
                await calcService.CalculateForDistrictAsync(districtId, yearId.Value);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed calculating zonal awards for district {D}", districtId);
            }
        }
    }
}
