namespace RotaryApi.Services;

/// <summary>
/// Detailed result of a single Interakt send — Ok mirrors the old bool return, plus the
/// pieces the WhatsApp Log needs: the HTTP status, Interakt's message id (for delivery-webhook
/// correlation) and the raw response/error text.
/// </summary>
public record WhatsAppSendOutcome(bool Ok, int HttpStatus, string? MessageId, string? Error);

public interface IInteraktService
{
    Task<bool> SendWhatsAppReminderAsync(string phoneNumber, string memberName, string districtNumber, string clubName, string purpose, string amount, string paymentUrl, string? templateOverride = null, string? status = null);

    /// <summary>
    /// Same send as <see cref="SendWhatsAppWithBodyValuesAsync"/> but returns the full outcome
    /// (message id + HTTP status + error) so the caller can persist a per-recipient log row.
    /// </summary>
    /// <param name="headerValues">
    /// Optional template HEADER values — for an IMAGE header template, the public image URL. Leave null
    /// for templates without a media header (the payload is byte-identical to before when null).
    /// </param>
    Task<WhatsAppSendOutcome> SendWhatsAppDetailedAsync(string phoneNumber, string? templateName, string[] bodyValues, string countryCode = "+91", string[]? buttonValues = null, string[]? headerValues = null);
    /// <param name="buttonValues">
    /// Optional values for the template's dynamic button (index 0). Required by Meta for
    /// AUTHENTICATION templates that carry a one-tap "Copy Code" button — the value is the
    /// code itself. Leave null for every other template (existing callers are unaffected:
    /// the payload is byte-identical when this is null).
    /// </param>
    Task<bool> SendWhatsAppWithBodyValuesAsync(string phoneNumber, string? templateName, string[] bodyValues, string countryCode = "+91", string[]? buttonValues = null);
}
