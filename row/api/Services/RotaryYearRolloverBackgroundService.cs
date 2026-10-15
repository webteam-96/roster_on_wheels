using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Daily job: on 1 July the Rotary year rolls over. Before this service existed the
// IsCurrent flag was refreshed only when the API restarted, so any server that stayed
// up through midnight on 30 June kept serving last year's rows as "current" until the
// next deploy. This wakes up every 6 hours and reconciles rotary_year_master.IsCurrent
// with the calendar so the flip happens on its own.
public class RotaryYearRolloverBackgroundService : BackgroundService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<RotaryYearRolloverBackgroundService> _logger;

    public RotaryYearRolloverBackgroundService(IConfiguration configuration, ILogger<RotaryYearRolloverBackgroundService> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ReconcileAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Rotary year rollover reconcile failed");
            }

            await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
        }
    }

    private async Task ReconcileAsync()
    {
        var connectionString = _configuration.GetConnectionString("DefaultConnection")!;
        await using var conn = new MySqlConnection(connectionString);
        await conn.OpenAsync();

        var today = DateTime.Today;
        var currentRotaryStartYear = today.Month >= 7 ? today.Year : today.Year - 1;
        var endYear = currentRotaryStartYear + 1;
        var label = $"{currentRotaryStartYear}-{(endYear % 100):D2}";
        var startDate = new DateTime(currentRotaryStartYear, 7, 1);
        var endDate = new DateTime(endYear, 6, 30);

        await conn.ExecuteAsync(
            @"INSERT IGNORE INTO rotary_year_master (YearLabel, StartDate, EndDate, IsCurrent)
              VALUES (@Label, @Start, @End, 1)",
            new { Label = label, Start = startDate, End = endDate });

        var alreadyCurrent = await conn.ExecuteScalarAsync<string?>(
            "SELECT YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1");
        if (string.Equals(alreadyCurrent, label, StringComparison.Ordinal)) return;

        await conn.ExecuteAsync("UPDATE rotary_year_master SET IsCurrent = 0 WHERE IsCurrent = 1");
        await conn.ExecuteAsync(
            "UPDATE rotary_year_master SET IsCurrent = 1 WHERE YearLabel = @Label",
            new { Label = label });

        _logger.LogInformation("Rotary year IsCurrent flipped from '{Old}' to '{New}'", alreadyCurrent ?? "(none)", label);
    }
}
