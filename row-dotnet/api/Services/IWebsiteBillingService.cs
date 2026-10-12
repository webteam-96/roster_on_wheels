using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Self-service club website purchase/renewal (Razorpay). Payment capture (verify/webhook) is
// decoupled from provisioning: verify/webhook mark the order PAID and return; the background
// worker (WebsiteProvisioningBackgroundService) claims paid orders exactly once and provisions
// the site (Plesk vhost + wildcard SSL) + emails the buyer — so it survives the user leaving.
public interface IWebsiteBillingService
{
    Task<WebsiteQuoteResponseDto> QuoteAsync(int clubId, int? yearId = null);  // per-club/year price+gateway (current year when null)
    SubdomainCheckResponseDto ValidateSubdomainInput(string? input);          // format-only (sync)
    Task<SubdomainCheckResponseDto> CheckSubdomainAsync(string? input, int? clubId = null);  // format + availability (clubId ignores own pending orders)
    Task<CreateWebsiteOrderResponseDto> CreateOrderAsync(CreateWebsiteOrderDto dto, int userId, int? yearId = null); // yearId pins the pricing year (public link); null = current
    Task<VerifyWebsiteOrderResponseDto> VerifyPaymentAsync(VerifyWebsiteOrderDto dto, int userId); // captures payment, returns fast
    Task HandleWebhookAsync(string rawBody, string signatureHeader);          // captures payment

    // Background provisioning (worker-driven, exactly-once):
    Task<List<long>> GetPaidUnprovisionedOrderIdsAsync(int limit);
    Task ProvisionPaidOrderAsync(long orderId);

    // Self-heals orders whose claim (IsProvisioned=1) was never followed by a final status —
    // e.g. an app restart mid-provision. See ReconcileStaleProvisioningOrdersAsync for detail.
    Task ReconcileStaleProvisioningOrdersAsync();

    // Status polling (notification card):
    Task<WebsiteOrderStatusDto?> GetOrderStatusAsync(long orderId);
    Task<WebsiteOrderStatusDto?> GetLatestOrderForClubAsync(int clubId);

    Task<int?> GetOrderClubIdAsync(long websiteOrderId);
}
