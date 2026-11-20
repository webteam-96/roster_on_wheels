namespace RotaryApi.DTOs;

public class AddCreditDto
{
    public int FkDistrictId { get; set; }
    public int FkClubId { get; set; }
    public string CreditType { get; set; } = "Email"; // Email is the only credit type in ROW
    public int CreditCount { get; set; }
    public DateTime ToDate { get; set; }
    // Transaction details (optional)
    public string? TransactionId { get; set; }
    public DateTime? PaymentDate { get; set; }
}

public class UpdateCreditDto
{
    public int CreditCount { get; set; }
    public DateTime ToDate { get; set; }
    public string? TransactionId { get; set; }
    public DateTime? PaymentDate { get; set; }
}

public class CreditListDto
{
    public int Id { get; set; }
    public string DistrictNumber { get; set; } = "";
    public string ClubName { get; set; } = "";
    public string CreditType { get; set; } = "";
    public int PreviousCount { get; set; }
    public int CreditCount { get; set; }
    public int UsedCount { get; set; }
    public int Remaining { get; set; }
    public DateTime FromDate { get; set; }
    public DateTime ToDate { get; set; }
    public bool IsActive { get; set; }
    public bool IsExpired { get; set; }
    public string? TransactionId { get; set; }
    public DateTime? PaymentDate { get; set; }
    public string? ProofDocumentPath { get; set; }
    public DateTime CreatedDate { get; set; }
    // Most recent time this club/district consumed a credit of this type (email sent).
    // Null if never used. Scope-level (not tied to a specific credit pack).
    public DateTime? LastUsedDate { get; set; }
}

public class CreditBalanceDto
{
    public int EmailCredits { get; set; }
    public int EmailUsed { get; set; }
    public int EmailRemaining { get; set; }
    public DateTime? EmailExpiry { get; set; }
}

public class CreditNotificationDto
{
    public string CreditType { get; set; } = "";
    public int RemainingCredits { get; set; }
    public DateTime ExpiryDate { get; set; }
    public int DaysLeft { get; set; }
}

public class CreditUsageHistoryDto
{
    public int Id { get; set; }
    public string ClubName { get; set; } = "";
    public string DistrictNumber { get; set; } = "";
    public string CreditType { get; set; } = "";
    public int DeductedCount { get; set; }
    public string Source { get; set; } = "";
    public int? SourceId { get; set; }
    public string? SourceDetail { get; set; }
    public int BalanceBefore { get; set; }
    public int BalanceAfter { get; set; }
    public DateTime CreatedDate { get; set; }
}

// Manual deduction + credit/debit history (Settings > Wallet, user 2026-11-16).
public class ManualDeductDto
{
    public int Count { get; set; }
    public string Reason { get; set; } = "";
}

public class CreditHistoryEntryDto
{
    public DateTime Date { get; set; }
    public DateTime? DateTo { get; set; }        // a grouped ROW line: last send
    public string Kind { get; set; } = "";      // Credit | Debit
    public string Group { get; set; } = "";     // Support | Online | ROW | Expired
    public string Source { get; set; } = "";
    public int Count { get; set; }              // + credit, - debit
    public string? Detail { get; set; }
    public int? BalanceAfter { get; set; }
    public int Lines { get; set; } = 1;          // single entries in a grouped line
    [System.Text.Json.Serialization.JsonIgnore] public Dictionary<string, int>? Parts { get; set; }
}

public class CreditHistoryDto
{
    public string DistrictNumber { get; set; } = "";
    public string? ClubName { get; set; }
    public string CreditType { get; set; } = "";
    public int ActiveCredited { get; set; }
    public int ActiveUsed { get; set; }
    public int CreditedBySupport { get; set; }
    public int BoughtOnline { get; set; }
    public int SentThroughRow { get; set; }
    public int DeductedBySupport { get; set; }
    public int Expired { get; set; }
    public int Balance { get; set; }
    public List<CreditHistoryEntryDto> Tally { get; set; } = new();     // grouped, oldest first
    public List<CreditHistoryEntryDto> Entries { get; set; } = new();   // every single entry, oldest first
}
