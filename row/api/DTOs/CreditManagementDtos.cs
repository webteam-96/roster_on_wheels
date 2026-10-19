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
    // Most recent time this club/district consumed a credit of this type (email/WhatsApp sent).
    // Null if never used. Scope-level (not tied to a specific credit pack).
    public DateTime? LastUsedDate { get; set; }
}

public class CreditBalanceDto
{
    public int EmailCredits { get; set; }
    public int EmailUsed { get; set; }
    public int EmailRemaining { get; set; }
    public DateTime? EmailExpiry { get; set; }
    public int WhatsAppCredits { get; set; }
    public int WhatsAppUsed { get; set; }
    public int WhatsAppRemaining { get; set; }
    public DateTime? WhatsAppExpiry { get; set; }
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
