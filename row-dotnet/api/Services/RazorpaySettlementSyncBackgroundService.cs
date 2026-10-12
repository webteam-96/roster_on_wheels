namespace RotaryApi.Services;

// Periodically pulls Razorpay's Settlement Recon API into razorpay_settlements (no
// settlement.processed webhook exists — see RazorpaySettlementService for why this is pull-based).
public class RazorpaySettlementSyncBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<RazorpaySettlementSyncBackgroundService> _logger;

    public RazorpaySettlementSyncBackgroundService(IServiceScopeFactory scopeFactory, ILogger<RazorpaySettlementSyncBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var svc = scope.ServiceProvider.GetRequiredService<IRazorpaySettlementService>();
                await svc.SyncRecentAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Razorpay settlement sync failed");
            }

            await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
        }
    }
}
