namespace RotaryApi.DTOs;

public enum WalletReportType
{
    ClubWebsite,
    ClubEmail,
    DistrictEmail,
}

public class WalletReportFilters
{
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
    public int? DistrictId { get; set; }
    public string? Search { get; set; }
}

public class WalletReportRow
{
    public string? DistrictNumber { get; set; }
    public string ClubName { get; set; } = "";
    public DateTime PurchaseDate { get; set; }
    public decimal PurchaseAmount { get; set; }
    public int? CreditsPurchased { get; set; }             // WA/Email only
    public decimal? SettlementAmount { get; set; }
    public DateTime? SettlementDate { get; set; }
    public string? RazorpayTransactionId { get; set; }
    public string? PresidentName { get; set; }
    public string? PresidentMobile { get; set; }
    public string? PresidentEmail { get; set; }
    public string? SecretaryName { get; set; }              // blank for District reports — no such role exists
    public string? SecretaryMobile { get; set; }
    public string? SecretaryEmail { get; set; }
    public string SettlesInAccount { get; set; } = "";       // "Normal — 2321" | "Route — <last4>"
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
}

// Settings › Wallet combined credit list — every Email credit a club or district got,
// Offline (given by Super Admin) and Online (bought by the club/district itself), one row each.
public class WalletCreditEntryRow
{
    public string Source { get; set; } = "";               // "Offline" | "Online"
    public string EntryType { get; set; } = "";            // Added | Edited | Purchased | Earlier entry
    public DateTime EntryDate { get; set; }
    public int DistrictId { get; set; }
    public string? DistrictNumber { get; set; }
    public int ClubId { get; set; }                        // 0 = district-level credits
    public string? ClubName { get; set; }
    public string CreditType { get; set; } = "";
    public int? Credits { get; set; }                      // null = earlier offline count not recorded
    public int? CountBefore { get; set; }
    public int? CountAfter { get; set; }
    public decimal? Amount { get; set; }                   // Online only (paid incl. GST)
    public string? TransactionId { get; set; }
    public DateTime? PaymentDate { get; set; }
    public string? ProofDocumentPath { get; set; }
    public DateTime? ExpiryDate { get; set; }
    public string? ByName { get; set; }
    public string? PackStatus { get; set; }                // Active | Expired | Deleted
    public string? Note { get; set; }
}

public class WalletCreditEntryFilters
{
    public int? DistrictId { get; set; }
    public int? ClubId { get; set; }
    public string? CreditType { get; set; }
    public string? Source { get; set; }
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
    public string? Search { get; set; }
}
