namespace RotaryApi.DTOs;

// Wallet credit top-up (club/district admins buy Email credits via Razorpay).
// Server is authoritative on pricing: the client only sends a base rupee Amount + scope + type;
// credits, GST and the total charged are computed server-side (never trust the client).

public class CreateTopupOrderDto
{
    public string Scope { get; set; } = "";       // "club" | "district"
    public int ClubId { get; set; }                // required when Scope=club
    public int DistrictId { get; set; }            // required when Scope=district
    public string CreditType { get; set; } = "";   // "Email"
    public decimal Amount { get; set; }            // base amount in rupees (min enforced), GST added on top
}

public class CreateTopupOrderResponseDto
{
    public long TopupOrderId { get; set; }
    public string RazorpayOrderId { get; set; } = "";
    public string KeyId { get; set; } = "";        // public Razorpay key (safe for the browser)
    public long AmountPaise { get; set; }          // total incl. GST, in paise — what Razorpay charges
    public string Currency { get; set; } = "INR";
    public int CreditCount { get; set; }
    public decimal BaseAmount { get; set; }
    public decimal GstAmount { get; set; }
    public decimal TotalAmount { get; set; }
}

public class VerifyTopupDto
{
    public long TopupOrderId { get; set; }
    public string RazorpayOrderId { get; set; } = "";
    public string RazorpayPaymentId { get; set; } = "";
    public string RazorpaySignature { get; set; } = "";
}

public class VerifyTopupResponseDto
{
    public bool IsSuccess { get; set; }
    public string PaymentStatus { get; set; } = "";
    public int CreditCount { get; set; }
    public CreditBalanceDto? NewBalance { get; set; }
    public string? Message { get; set; }
}

public class WalletQuoteResponseDto
{
    public string CreditType { get; set; } = "";
    public int CreditCount { get; set; }
    public decimal BaseAmount { get; set; }
    public decimal GstAmount { get; set; }
    public decimal TotalAmount { get; set; }
    public decimal MinAmount { get; set; }
    public string? Error { get; set; }
}
