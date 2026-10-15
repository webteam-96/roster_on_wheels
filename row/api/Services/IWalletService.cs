using RotaryApi.DTOs;

namespace RotaryApi.Services;

public interface IWalletService
{
    WalletQuoteResponseDto Quote(string creditType, decimal baseAmount);
    Task<CreateTopupOrderResponseDto> CreateTopupOrderAsync(CreateTopupOrderDto dto, int userId);
    Task<VerifyTopupResponseDto> VerifyAndCreditAsync(VerifyTopupDto dto, int userId);
    Task HandleWebhookAsync(string rawBody, string signatureHeader);
    // Scope of a stored order (so the controller can re-authorize verify against the real order).
    Task<(string Scope, int ClubId, int DistrictId)?> GetOrderScopeAsync(long topupOrderId);
}
