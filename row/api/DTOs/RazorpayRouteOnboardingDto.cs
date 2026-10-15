namespace RotaryApi.DTOs;

// Full Razorpay Route linked-account onboarding input. On Save the API creates the linked
// account (POST /v2/accounts), a stakeholder (POST .../stakeholders), requests the Route
// product config (POST .../products) and sets the settlement bank account (PATCH .../products/{id}).
// The returned acc_… id is then stored locally in razorpay_route_accounts.
public class RazorpayRouteOnboardingDto
{
    // ── Local (our table) ──
    public string? Name { get; set; }            // internal display name (defaults to LegalBusinessName)
    public bool IsActive { get; set; } = true;
    public string? Notes { get; set; }

    // ── Linked account (POST /v2/accounts) ──
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? LegalBusinessName { get; set; }
    public string? CustomerFacingBusinessName { get; set; }
    public string? BusinessType { get; set; }    // proprietorship|partnership|private_limited|public_limited|llp|ngo|trust|society|not_yet_registered|huf|individual
    public string? Category { get; set; }
    public string? Subcategory { get; set; }
    public string? ReferenceId { get; set; }

    // Registered address (profile.addresses.registered)
    public string? Street1 { get; set; }
    public string? Street2 { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? PostalCode { get; set; }
    public string? Country { get; set; } = "IN";

    // Legal info (optional; helps activation)
    public string? Pan { get; set; }
    public string? Gst { get; set; }

    // ── Stakeholder (POST .../stakeholders) ──
    public string? StakeholderName { get; set; }
    public string? StakeholderEmail { get; set; }
    public string? StakeholderPan { get; set; }

    // ── Settlement bank (PATCH .../products/{id}) ──
    public string? BankAccountNumber { get; set; }
    public string? BankIfsc { get; set; }
    public string? BankBeneficiaryName { get; set; }

    // ── OTP gate (verified before any Razorpay call) ──
    public string? Otp { get; set; }
}
