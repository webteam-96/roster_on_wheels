namespace RotaryApi.Services;

// Provisions PAID club-website orders in the background so the browser never blocks and the
// work survives the user leaving the purchase page. Polls every few seconds for paid,
// not-yet-provisioned orders and hands each to WebsiteBillingService.ProvisionPaidOrderAsync,
// which atomically claims and provisions it exactly once (create/renew + Plesk vhost + SSL) and
// emails the buyer. Registered UNCONDITIONALLY (payment-critical) — not gated by BackgroundJobs:Enabled.
public class WebsiteProvisioningBackgroundService : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<WebsiteProvisioningBackgroundService> _logger;

    public WebsiteProvisioningBackgroundService(
        IServiceProvider serviceProvider,
        ILogger<WebsiteProvisioningBackgroundService> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("WebsiteProvisioning background service started.");
        await Task.Delay(TimeSpan.FromSeconds(8), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var billing = scope.ServiceProvider.GetRequiredService<IWebsiteBillingService>();
                var ids = await billing.GetPaidUnprovisionedOrderIdsAsync(10);
                foreach (var id in ids)
                {
                    if (stoppingToken.IsCancellationRequested) break;
                    try { await billing.ProvisionPaidOrderAsync(id); }
                    catch (Exception ex) { _logger.LogError(ex, "Provisioning website order {Id} failed.", id); }
                }

                try { await billing.ReconcileStaleProvisioningOrdersAsync(); }
                catch (Exception ex) { _logger.LogError(ex, "Reconciling stale provisioning orders failed."); }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in WebsiteProvisioning background service tick.");
            }
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }
}
