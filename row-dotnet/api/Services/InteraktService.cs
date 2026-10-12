using System.Text;
using System.Text.Json;

namespace RotaryApi.Services;

public class InteraktService : IInteraktService
{
    private readonly IConfiguration _config;
    private readonly HttpClient _httpClient;
    private readonly ILogger<InteraktService> _logger;

    public InteraktService(IConfiguration config, IHttpClientFactory httpClientFactory, ILogger<InteraktService> logger)
    {
        _config = config;
        _httpClient = httpClientFactory.CreateClient();
        _logger = logger;
    }

    public async Task<bool> SendWhatsAppReminderAsync(string phoneNumber, string memberName, string districtNumber, string clubName, string purpose, string amount, string paymentUrl, string? templateOverride = null, string? status = null)
    {
        // For backward compatibility (event payment links), use 6-param format
        var bodyValues = new List<string> { memberName, districtNumber, clubName, purpose, amount, paymentUrl };
        return await SendWhatsAppWithBodyValuesAsync(phoneNumber, templateOverride, bodyValues.ToArray());
    }

    public async Task<bool> SendWhatsAppWithBodyValuesAsync(string phoneNumber, string? templateName, string[] bodyValues, string countryCode = "+91", string[]? buttonValues = null)
    {
        var outcome = await SendWhatsAppDetailedAsync(phoneNumber, templateName, bodyValues, countryCode, buttonValues);
        return outcome.Ok;
    }

    public async Task<WhatsAppSendOutcome> SendWhatsAppDetailedAsync(string phoneNumber, string? templateName, string[] bodyValues, string countryCode = "+91", string[]? buttonValues = null, string[]? headerValues = null)
    {
        try
        {
            var interakt = _config.GetSection("Interakt");
            var apiKey = interakt["ApiKey"]!;
            var baseUrl = interakt["BaseUrl"]!;
            var finalTemplate = templateName ?? interakt["TemplateName"]!;
            var langCode = interakt["LanguageCode"] ?? "en";

            // WhatsApp/Meta reject template params that are empty/null or contain tabs, newlines,
            // or 3+ consecutive spaces. Normalise every value so optional/blank fields (e.g. an
            // event with no registration link or image) and multi-line text don't fail the whole send.
            bodyValues = (bodyValues ?? Array.Empty<string>())
                .Select(v =>
                {
                    if (string.IsNullOrWhiteSpace(v)) return "-";
                    var s = System.Text.RegularExpressions.Regex.Replace(v, @"\s+", " ").Trim();
                    return string.IsNullOrEmpty(s) ? "-" : s;
                })
                .ToArray();

            // Interakt wants the country code and the national number as separate fields.
            // Strip the country-code prefix only when the value is written in international
            // form ("+<cc>…") — a bare national number can legitimately start with the same
            // digits as its own country code (e.g. the Indian mobile 91xxxxxxxx). The
            // last-10-digits trim is India-only: 10 digits is the fixed Indian national
            // length, but other countries vary and truncating would mangle them.
            var raw = (phoneNumber ?? "").Trim();
            var ccDigits = new string((countryCode ?? "+91").Where(char.IsDigit).ToArray());
            var cleanPhone = new string(raw.Where(char.IsDigit).ToArray());
            if (raw.StartsWith('+') && ccDigits.Length > 0
                && cleanPhone.Length > ccDigits.Length && cleanPhone.StartsWith(ccDigits))
            {
                cleanPhone = cleanPhone[ccDigits.Length..];
            }
            else if (ccDigits == "91" && cleanPhone.Length > 10)
            {
                cleanPhone = cleanPhone[^10..];
            }

            // Built as a dictionary (not an anonymous type) so "buttonValues" can be omitted
            // entirely when the template has no dynamic button — the serialized payload for
            // every pre-existing caller stays byte-identical to what it was before.
            var template = new Dictionary<string, object>
            {
                ["name"] = finalTemplate,
                ["languageCode"] = langCode,
                ["bodyValues"] = bodyValues
            };

            // Interakt expects button parameters as an index-keyed map of arrays:
            //   "buttonValues": { "0": ["<value>"] }
            // Meta requires this for AUTHENTICATION templates with a "Copy Code" button
            // (the button parameter is the OTP itself) and for URL buttons with a dynamic
            // suffix. Templates with only static buttons must NOT send the field at all.
            var cleanButtonValues = (buttonValues ?? Array.Empty<string>())
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .Select(v => v.Trim())
                .ToArray();
            if (cleanButtonValues.Length > 0)
                template["buttonValues"] = new Dictionary<string, string[]> { ["0"] = cleanButtonValues };

            // Media-header templates (e.g. an IMAGE header) take the media URL as "headerValues".
            // Omitted entirely for every other template so existing payloads are unchanged.
            var cleanHeaderValues = (headerValues ?? Array.Empty<string>())
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .Select(v => v.Trim())
                .ToArray();
            if (cleanHeaderValues.Length > 0)
                template["headerValues"] = cleanHeaderValues;

            var payload = new
            {
                countryCode = string.IsNullOrWhiteSpace(countryCode) ? "+91" : countryCode,
                phoneNumber = cleanPhone,
                callbackData = "membership_dues_reminder",
                type = "Template",
                template
            };

            var json = JsonSerializer.Serialize(payload);
            var request = new HttpRequestMessage(HttpMethod.Post, baseUrl)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            request.Headers.Add("Authorization", $"Basic {apiKey}");

            var response = await _httpClient.SendAsync(request);
            var responseBody = await response.Content.ReadAsStringAsync();
            _logger.LogInformation("WhatsApp reminder to {Phone}: {Status} - {Body}", cleanPhone, response.StatusCode, responseBody);

            // Interakt's send response carries the message id (used to correlate the later
            // delivery webhook). Shape: {"result":true,"id":"<id>","message":"..."}. Parse
            // tolerantly — never let id extraction turn a successful send into a failure.
            string? messageId = null;
            try
            {
                using var doc = JsonDocument.Parse(responseBody);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    if (doc.RootElement.TryGetProperty("id", out var idEl))
                        messageId = idEl.ValueKind == JsonValueKind.String ? idEl.GetString() : idEl.ToString();
                    else if (doc.RootElement.TryGetProperty("data", out var dataEl)
                             && dataEl.ValueKind == JsonValueKind.Object
                             && dataEl.TryGetProperty("id", out var did))
                        messageId = did.ValueKind == JsonValueKind.String ? did.GetString() : did.ToString();
                }
            }
            catch { /* non-JSON body — leave messageId null */ }

            var error = response.IsSuccessStatusCode ? null : Truncate(responseBody, 1000);
            return new WhatsAppSendOutcome(response.IsSuccessStatusCode, (int)response.StatusCode, messageId, error);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send WhatsApp reminder to {Phone}", phoneNumber);
            return new WhatsAppSendOutcome(false, 0, null, Truncate(ex.Message, 1000));
        }
    }

    private static string? Truncate(string? s, int max)
        => string.IsNullOrEmpty(s) ? s : (s.Length <= max ? s : s.Substring(0, max));
}
