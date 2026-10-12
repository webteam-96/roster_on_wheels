namespace RotaryApi.Services;

public interface IRazorpaySettlementService
{
    // Pulls Razorpay's Settlement Recon (Combined) API for one calendar month and upserts
    // razorpay_settlements, keyed by RazorpayPaymentId. Pass impersonateAccountId (acc_XXXX) to
    // fetch a Route linked account's own settlements instead of the master account's.
    // Returns the number of rows upserted.
    Task<int> SyncMonthAsync(int year, int month, string? impersonateAccountId = null);

    // Re-syncs the last N months (default 3 — settlements can be corrected for a few days after
    // they land) for the master account, plus every active Route linked account.
    Task SyncRecentAsync(int monthsBack = 3);
}
