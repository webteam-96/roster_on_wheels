using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// ROW's messaging providers (master plan WS6M), the same as the NestJS edition's services/messaging.ts, replacing
/// the original platform's Indian ones (DLT SMS, Interakt WhatsApp), which are removed:
///   SMS      → Twilio          (Brand__Providers__Twilio__AccountSid / __AuthToken / __MessagingServiceSid)
///   WhatsApp → Meta Cloud API  (Brand__Providers__MetaWhatsApp__AccessToken / __PhoneNumberId / __ApiVersion)
/// Credentials come from the environment. A provider without credentials reports "not sent" instead of throwing,
/// so callers fall back to the next channel.
/// </summary>
public static class RowPhone
{
    /// <summary>"+1" + "416 555 0100" → "+14165550100". A national number's trunk "0" is dropped. Null when unusable.</summary>
    public static string? ToE164(string? nationalNumber, string? dialCode)
    {
        var raw = (nationalNumber ?? "").Trim();
        if (raw.Length == 0) return null;
        static string Digits(string s) => new(s.Where(char.IsDigit).ToArray());
        if (raw.StartsWith('+'))
        {
            var d = Digits(raw);
            return d.Length is >= 8 and <= 15 ? "+" + d : null;
        }
        var code = Digits(dialCode ?? "");
        if (code.Length == 0) return null;
        var digits = Digits(raw).TrimStart('0');
        if (digits.StartsWith(code) && digits.Length > code.Length + 6) digits = digits[code.Length..];
        var full = code + digits;
        return full.Length is >= 8 and <= 15 ? "+" + full : null;
    }

    /// <summary>
    /// E.164 for a number held without its country: "+..." as written; otherwise the given dial code, else the
    /// country of the member who has this mobile, else the brand's default country (<c>Brand:Locale:DefaultCountryId</c>).
    /// The original platform assumed India (+91) here. Null when no country can be established.
    /// </summary>
    public static async Task<string?> ResolveE164Async(string? connectionString, string? mobile, string? dialCode = null)
    {
        var raw = (mobile ?? "").Trim();
        if (raw.Length == 0) return null;
        if (raw.StartsWith('+')) return ToE164(raw, null);
        if (!string.IsNullOrWhiteSpace(dialCode)) return ToE164(raw, dialCode);
        if (string.IsNullOrWhiteSpace(connectionString)) return null;
        try
        {
            await using var conn = new MySqlConnection(connectionString);
            await conn.OpenAsync();
            var code = await conn.ExecuteScalarAsync<string?>(@"
                SELECT c.PhoneCode FROM member_master_profile m
                JOIN country_master c ON c.pk_country_id = CASE WHEN m.PrimaryMobileNumber = @M THEN m.fk_primary_country_id ELSE m.fk_secondary_country_id END
                WHERE m.PrimaryMobileNumber = @M OR m.SecondaryMobileNumber = @M
                LIMIT 1", new { M = raw });
            code ??= await DialCodeAsync(conn, Brand.DefaultCountryId);
            return ToE164(raw, code);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>The dial code ("+44") of a country_master row, or null.</summary>
    public static async Task<string?> DialCodeAsync(MySqlConnection conn, int? countryId) =>
        countryId is > 0
            ? await conn.ExecuteScalarAsync<string?>("SELECT PhoneCode FROM country_master WHERE pk_country_id = @Id", new { Id = countryId })
            : null;
}

public class TwilioSmsSender
{
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _config;
    private readonly ILogger<TwilioSmsSender> _log;

    public TwilioSmsSender(IHttpClientFactory http, IConfiguration config, ILogger<TwilioSmsSender> log)
    {
        _http = http;
        _config = config;
        _log = log;
    }

    /// <summary>Send a text; true when Twilio accepted it.</summary>
    public async Task<bool> SendAsync(string toE164, string text)
    {
        if (!string.Equals(Brand.SmsProvider, "twilio", StringComparison.OrdinalIgnoreCase)) return false;
        var sid = _config["Brand:Providers:Twilio:AccountSid"];
        var token = _config["Brand:Providers:Twilio:AuthToken"];
        var service = _config["Brand:Providers:Twilio:MessagingServiceSid"];
        if (string.IsNullOrWhiteSpace(sid) || string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(service))
        {
            _log.LogWarning("Twilio is not configured; SMS not sent.");
            return false;
        }
        try
        {
            var client = _http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(30);
            using var req = new HttpRequestMessage(HttpMethod.Post, $"https://api.twilio.com/2010-04-01/Accounts/{Uri.EscapeDataString(sid)}/Messages.json")
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["To"] = toE164, ["MessagingServiceSid"] = service, ["Body"] = text }),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{sid}:{token}")));
            using var resp = await client.SendAsync(req);
            if (!resp.IsSuccessStatusCode) _log.LogError("Twilio {Status}: {Body}", (int)resp.StatusCode, Trunc(await resp.Content.ReadAsStringAsync()));
            return resp.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _log.LogError("Twilio send failed: {Message}", ex.Message);
            return false;
        }
    }

    private static string Trunc(string s) => s.Length > 300 ? s[..300] : s;
}

public class MetaWhatsAppSender
{
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _config;
    private readonly ILogger<MetaWhatsAppSender> _log;

    public MetaWhatsAppSender(IHttpClientFactory http, IConfiguration config, ILogger<MetaWhatsAppSender> log)
    {
        _http = http;
        _config = config;
        _log = log;
    }

    /// <summary>
    /// Send an approved template; <paramref name="bodyParams"/> fill {{1}}, {{2}} … in order. Authentication
    /// templates (one-time codes) also take the code as the copy-code button parameter.
    /// </summary>
    public async Task<bool> SendTemplateAsync(string toE164, string templateName, string language, IReadOnlyList<string> bodyParams, string? otpButton = null) =>
        (await SendTemplateDetailedAsync(toE164, templateName, language, bodyParams, otpButton)).Ok;

    /// <summary>
    /// As <see cref="SendTemplateAsync"/>, with an optional IMAGE header (public URL) and the outcome the WhatsApp log
    /// keeps: HTTP status, Meta's message id ("wamid...") and the error text.
    /// </summary>
    public async Task<WhatsAppSendOutcome> SendTemplateDetailedAsync(string toE164, string templateName, string language, IReadOnlyList<string> bodyParams,
        string? otpButton = null, string? headerImageUrl = null)
    {
        if (!string.Equals(Brand.WhatsAppProvider, "meta", StringComparison.OrdinalIgnoreCase))
            return new WhatsAppSendOutcome(false, 0, null, "WhatsApp provider is not meta");
        var token = _config["Brand:Providers:MetaWhatsApp:AccessToken"];
        var phoneNumberId = _config["Brand:Providers:MetaWhatsApp:PhoneNumberId"];
        var version = _config["Brand:Providers:MetaWhatsApp:ApiVersion"] is { Length: > 0 } v ? v : "v21.0";
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(phoneNumberId))
        {
            _log.LogWarning("Meta WhatsApp is not configured; message not sent.");
            return new WhatsAppSendOutcome(false, 0, null, "Meta WhatsApp is not configured");
        }
        var components = new List<object>();
        if (!string.IsNullOrWhiteSpace(headerImageUrl))
            components.Add(new { type = "header", parameters = new[] { new { type = "image", image = new { link = headerImageUrl.Trim() } } } });
        if (bodyParams.Count > 0) components.Add(new { type = "body", parameters = bodyParams.Select(t => new { type = "text", text = t }).ToArray() });
        if (otpButton != null) components.Add(new { type = "button", sub_type = "url", index = "0", parameters = new[] { new { type = "text", text = otpButton } } });
        try
        {
            var client = _http.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(30);
            using var req = new HttpRequestMessage(HttpMethod.Post, $"https://graph.facebook.com/{version}/{Uri.EscapeDataString(phoneNumberId)}/messages")
            {
                Content = new StringContent(JsonSerializer.Serialize(new
                {
                    messaging_product = "whatsapp",
                    to = toE164.TrimStart('+'),
                    type = "template",
                    template = new { name = templateName, language = new { code = language }, components },
                }), Encoding.UTF8, "application/json"),
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
            {
                _log.LogError("Meta WhatsApp {Status}: {Body}", (int)resp.StatusCode, body.Length > 300 ? body[..300] : body);
                return new WhatsAppSendOutcome(false, (int)resp.StatusCode, null, body.Length > 1000 ? body[..1000] : body);
            }
            string? id = null;
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("messages", out var msgs) && msgs.ValueKind == JsonValueKind.Array && msgs.GetArrayLength() > 0
                    && msgs[0].TryGetProperty("id", out var idEl))
                    id = idEl.GetString();
            }
            catch { /* the send succeeded; keep it without an id */ }
            return new WhatsAppSendOutcome(true, (int)resp.StatusCode, id, null);
        }
        catch (Exception ex)
        {
            _log.LogError("Meta WhatsApp send failed: {Message}", ex.Message);
            return new WhatsAppSendOutcome(false, 0, null, ex.Message.Length > 1000 ? ex.Message[..1000] : ex.Message);
        }
    }
}

/// <summary>
/// WhatsApp for every feature (reminders, announcements, codes) through the Meta Cloud API, replacing the original
/// platform's Interakt service. Template names come from the callers or <c>WhatsApp:*</c> settings and must be
/// approved in the brand's Meta account.
/// </summary>
public class MetaWhatsAppService : IWhatsAppService
{
    private readonly MetaWhatsAppSender _meta;
    private readonly IConfiguration _config;
    private readonly ILogger<MetaWhatsAppService> _log;

    public MetaWhatsAppService(MetaWhatsAppSender meta, IConfiguration config, ILogger<MetaWhatsAppService> log)
    {
        _meta = meta;
        _config = config;
        _log = log;
    }

    public Task<bool> SendWhatsAppReminderAsync(string phoneNumber, string memberName, string districtNumber, string clubName, string purpose, string amount, string paymentUrl, string? templateOverride = null, string? status = null) =>
        SendWhatsAppWithBodyValuesAsync(phoneNumber, templateOverride, new[] { memberName, districtNumber, clubName, purpose, amount, paymentUrl });

    public async Task<bool> SendWhatsAppWithBodyValuesAsync(string phoneNumber, string? templateName, string[] bodyValues, string? countryCode = null, string[]? buttonValues = null) =>
        (await SendWhatsAppDetailedAsync(phoneNumber, templateName, bodyValues, countryCode, buttonValues)).Ok;

    public async Task<WhatsAppSendOutcome> SendWhatsAppDetailedAsync(string phoneNumber, string? templateName, string[] bodyValues, string? countryCode = null, string[]? buttonValues = null, string[]? headerValues = null)
    {
        var template = string.IsNullOrWhiteSpace(templateName) ? _config["WhatsApp:TemplateName"] : templateName;
        if (string.IsNullOrWhiteSpace(template)) return new WhatsAppSendOutcome(false, 0, null, "No WhatsApp template configured");
        var e164 = await RowPhone.ResolveE164Async(_config.GetConnectionString("DefaultConnection"), phoneNumber, countryCode);
        if (e164 == null)
        {
            _log.LogWarning("WhatsApp not sent: no country for the number.");
            return new WhatsAppSendOutcome(false, 0, null, "Phone number has no country code");
        }
        // Meta rejects empty parameters and ones with newlines, tabs or long runs of spaces.
        var body = (bodyValues ?? Array.Empty<string>())
            .Select(v => string.IsNullOrWhiteSpace(v) ? "-" : System.Text.RegularExpressions.Regex.Replace(v, @"\s+", " ").Trim())
            .ToArray();
        var button = buttonValues?.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v))?.Trim();
        var header = headerValues?.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
        var language = _config["WhatsApp:LanguageCode"] is { Length: > 0 } l ? l : Brand.DefaultLanguage;
        return await _meta.SendTemplateDetailedAsync(e164, template.Trim(), language, body, button, header);
    }
}

/// <summary>One-time codes by SMS through Twilio (replaces the original platform's India DLT gateway).</summary>
public class TwilioOtpSmsService : ISmsService
{
    private readonly TwilioSmsSender _twilio;
    private readonly IConfiguration _config;

    public TwilioOtpSmsService(TwilioSmsSender twilio, IConfiguration config)
    {
        _twilio = twilio;
        _config = config;
    }

    public async Task<bool> SendOtpSmsAsync(string mobileNumber, string otpCode)
    {
        var e164 = await RowPhone.ResolveE164Async(_config.GetConnectionString("DefaultConnection"), mobileNumber);
        return e164 != null && await _twilio.SendAsync(e164, $"{otpCode} is your {Brand.ShortName} verification code.");
    }
}
