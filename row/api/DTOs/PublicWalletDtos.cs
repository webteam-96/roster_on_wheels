namespace RotaryApi.DTOs;

// Public (token-based, no-login) Wallet pay-link DTOs — Email credit top-ups and the
// "common" pick-a-club/district links. Credit purchase reuses CreateTopupOrderDto/VerifyTopupDto/
// WalletQuoteResponseDto (WalletDtos.cs); these cover the link-resolve, search and status surfaces.

// What the pay page needs to render on load.
public class PublicWalletInfoDto
{
    public string Scope { get; set; } = "";        // "club" | "district"
    public string Purpose { get; set; } = "";       // "website" | "email"
    public int EntityId { get; set; }               // 0 when the link is "common" (payer must pick)
    public bool RequiresPick { get; set; }           // EntityId == 0
    public string? EntityName { get; set; }          // resolved when EntityId > 0
    public string? DistrictNumber { get; set; }      // club's district (for display)
    public PublicWalletStatusDto? Status { get; set; }
}

// Status snapshot shown once an entity is known. Website fields are null for districts.
public class PublicWalletStatusDto
{
    public int EmailRemaining { get; set; }
    // Website (club scope only)
    public string? WebsiteOrderType { get; set; }    // "New" | "Renewal"
    public string? WebsiteSubdomain { get; set; }
    public DateTime? WebsiteCurrentEndDate { get; set; }
    public DateTime? WebsiteNewEndDate { get; set; }
    public bool WebsiteCanPurchase { get; set; }
    public string? WebsitePurchaseBlockedReason { get; set; }
}

public class PublicWalletSearchResultDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? DistrictNumber { get; set; }
}

public class PublicWalletCreateOrderRequest
{
    public int EntityId { get; set; }   // ignored (forced) when the token already bakes an entity
    public decimal Amount { get; set; }
}

public class PublicWalletVerifyRequest
{
    public long TopupOrderId { get; set; }
    public string RazorpayOrderId { get; set; } = "";
    public string RazorpayPaymentId { get; set; } = "";
    public string RazorpaySignature { get; set; } = "";
}

public class PublicWalletWebsiteTokenRequest
{
    public int EntityId { get; set; }   // clubId to purchase a website for (common website link)
}

public class PublicWalletWebsiteTokenResponse
{
    public string WebsiteToken { get; set; } = "";
}
