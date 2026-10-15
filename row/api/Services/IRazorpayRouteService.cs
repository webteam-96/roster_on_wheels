using RotaryApi.DTOs;

namespace RotaryApi.Services;

// Result of a Route linked-account onboarding attempt. AccountId is set as soon as the
// linked account is created (step 1); later-step failures (stakeholder / product / bank)
// are surfaced in Warnings so the acc_… id is never orphaned. FatalError is set only when
// the account itself could not be created (nothing was created on Razorpay).
public sealed class RouteOnboardingResult
{
    public string? AccountId { get; set; }
    public string? StakeholderId { get; set; }
    public string? ProductConfigId { get; set; }
    public string? Status { get; set; }      // latest account/product activation status
    public string? RawJson { get; set; }      // latest raw Razorpay response
    public List<string> Warnings { get; } = new();
    public string? FatalError { get; set; }
    public bool AccountCreated => !string.IsNullOrWhiteSpace(AccountId);
}

// Live status pulled from Razorpay for an existing account.
public sealed record RouteStatusResult(string? Status, string RawJson);

public interface IRazorpayRouteService
{
    // Runs the 4-step onboarding. Never throws for Razorpay API errors — inspect the result:
    // FatalError != null  => nothing created (save nothing); AccountId set => persist it, show Warnings.
    Task<RouteOnboardingResult> CreateLinkedAccountAsync(RazorpayRouteOnboardingDto dto);

    // GET /v2/accounts/{id} — account-level status (created/suspended/…). Returns null status on failure.
    Task<RouteStatusResult> GetLinkedAccountAsync(string accountId);
    // GET /v2/accounts/{id}/products/{productId} — product activation_status (matches dashboard "Account Status").
    Task<RouteStatusResult> GetRouteProductAsync(string accountId, string productId);
}
