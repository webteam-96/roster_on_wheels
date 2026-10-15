using MySqlConnector;

namespace RotaryApi.Services;

// Extracted from ClubWebsitesController.PerformActivationAsync so BOTH the SuperAdmin
// activate/retry endpoints AND the self-service purchase flow (WebsiteBillingService)
// provision a club website through one implementation.
public interface IClubWebsiteActivationService
{
    // The caller owns `conn` (already opened) so the payment path and the controller share
    // the same DB session. Returns a plain result, not an ActionResult.
    Task<ClubWebsiteActivationResult> ActivateAsync(
        MySqlConnection conn, int websiteId, int userId, bool skipPlesk, string logAction);
}

public sealed class ClubWebsiteActivationResult
{
    public bool NotFound { get; set; }               // no such club_websites row
    public bool NoSubdomain { get; set; }            // Plesk configured but stored subdomain is empty
    public bool ActivationFailed { get; set; }       // hard Plesk error → row left 'ActivationFailed'
    public string? PleskError { get; set; }          // fatal message, or a non-fatal alias/cert note
    public List<string> PleskStepsDone { get; set; } = new();
    public int EmailsSent { get; set; }
    public int EmailsTotal { get; set; }
    public bool SkipPlesk { get; set; }
}
