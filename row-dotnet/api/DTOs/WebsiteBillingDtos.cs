namespace RotaryApi.DTOs;

// Self-service club website purchase/renewal via Razorpay. Server is authoritative on price
// (₹10,999 + 18% GST), validity (12 months), subdomain rules, and provisioning.

public class WebsiteQuoteResponseDto
{
    public string OrderType { get; set; } = "";      // "New" | "Renewal"
    public string? CurrentSubdomain { get; set; }    // set on Renewal
    public DateTime? CurrentEndDate { get; set; }     // set on Renewal
    public DateTime NewEndDate { get; set; }
    public int ValidityMonths { get; set; }
    public decimal BaseAmount { get; set; }
    public decimal GstAmount { get; set; }
    public int GstPercent { get; set; }
    public decimal TotalAmount { get; set; }
    public string SubdomainPrefix { get; set; } = "rc";
    public string ParentDomain { get; set; } = "";   // e.g. example.org
    public string GatewayType { get; set; } = "normal"; // "normal" | "route" (resolved per-club/year)
    // A paid, active website with > renewal-window days left can't be re-purchased/renewed yet.
    public bool CanPurchase { get; set; } = true;
    public string? PurchaseBlockedReason { get; set; }
    public int DaysRemaining { get; set; }
}

public class SubdomainCheckResponseDto
{
    public string Label { get; set; } = "";          // full stored label, e.g. "rcmumbaiwest"
    public bool Available { get; set; }
    public string? Reason { get; set; }              // why unavailable / invalid
}

public class CreateWebsiteOrderDto
{
    public int ClubId { get; set; }
    public string? SubdomainInput { get; set; }      // required for New; ignored for Renewal
    public int ReminderDays { get; set; }            // days before expiry to remind
    public int? ThemeId { get; set; }                // optional; default theme when null (New)
}

public class CreateWebsiteOrderResponseDto
{
    public long WebsiteOrderId { get; set; }
    public string RazorpayOrderId { get; set; } = "";
    public string KeyId { get; set; } = "";          // public Razorpay key (safe for the browser)
    public long AmountPaise { get; set; }            // total incl. GST, in paise
    public string Currency { get; set; } = "INR";
    public string OrderType { get; set; } = "";
    public string Subdomain { get; set; } = "";      // full label (rc…) being purchased
    public decimal BaseAmount { get; set; }
    public decimal GstAmount { get; set; }
    public decimal TotalAmount { get; set; }
    public string ClubName { get; set; } = "";        // for the Razorpay checkout description
}

public class VerifyWebsiteOrderDto
{
    public long WebsiteOrderId { get; set; }
    public string RazorpayOrderId { get; set; } = "";
    public string RazorpayPaymentId { get; set; } = "";
    public string RazorpaySignature { get; set; } = "";
}

public class VerifyWebsiteOrderResponseDto
{
    public bool IsSuccess { get; set; }
    public string PaymentStatus { get; set; } = "";  // "PAID"
    public string OrderType { get; set; } = "";
    public string Subdomain { get; set; } = "";
    public string ProvisionStatus { get; set; } = ""; // "Provisioning" | "Active" | "ActivationFailed"
    public string? VisitUrl { get; set; }
    public DateTime? EndDate { get; set; }
    public string? Message { get; set; }
}

// Live status for the notification card polling.
public class WebsiteOrderStatusDto
{
    public long WebsiteOrderId { get; set; }
    public int ClubId { get; set; }
    public string OrderType { get; set; } = "";
    public string Subdomain { get; set; } = "";
    public string PaymentStatus { get; set; } = "";
    public string Status { get; set; } = "";   // "AwaitingPayment" | "Provisioning" | "Active" | "ActivationFailed"
    public string? VisitUrl { get; set; }
    public DateTime? EndDate { get; set; }
}
