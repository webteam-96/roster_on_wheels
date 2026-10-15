using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace GreetingsWorker.Services;

// Sends an approved template through the Meta Cloud API, the same as the API's MetaWhatsAppSender
// (Brand:Providers:MetaWhatsApp:*); bodyValues fill the template's {{n}} placeholders. Replaces the original
// worker's Interakt sender. The number gets the member's country code (else the brand's default country).
public class MetaWhatsAppSender
{
    private readonly HttpClient _http;
    private readonly ILogger<MetaWhatsAppSender> _logger;
    private readonly string _connString;
    private readonly string _token;
    private readonly string _phoneNumberId;
    private readonly string _apiVersion;
    private readonly string _langCode;

    public MetaWhatsAppSender(HttpClient http, ILogger<MetaWhatsAppSender> logger, string connString,
        string token, string phoneNumberId, string apiVersion, string langCode)
    {
        _http = http;
        _logger = logger;
        _connString = connString;
        _token = token;
        _phoneNumberId = phoneNumberId;
        _apiVersion = string.IsNullOrWhiteSpace(apiVersion) ? "v21.0" : apiVersion;
        _langCode = string.IsNullOrWhiteSpace(langCode) ? RotaryApi.Services.Brand.DefaultLanguage : langCode;
    }

    public async Task<bool> SendTemplateAsync(string phoneNumber, string templateName, string[] bodyValues)
    {
        if (string.IsNullOrWhiteSpace(phoneNumber) || string.IsNullOrWhiteSpace(templateName)) return false;
        if (string.IsNullOrWhiteSpace(_token) || string.IsNullOrWhiteSpace(_phoneNumberId))
        {
            _logger.LogWarning("Meta WhatsApp is not configured; greeting not sent.");
            return false;
        }
        try
        {
            var e164 = await ToE164Async(phoneNumber);
            if (e164 == null) { _logger.LogWarning("Skipping a number with no country code."); return false; }

            // The template layout is fixed — {{1}}=member name, {{2}}=message, {{3}}=club/district name — so the
            // english-only filter is applied ONLY to the free-text MESSAGE (index 1); names keep their script.
            var cleanValues = bodyValues.Select((v, i) => CleanTemplateValue(v, dropForeignScripts: i == 1)).ToArray();
            var payload = new
            {
                messaging_product = "whatsapp",
                to = e164.TrimStart('+'),
                type = "template",
                template = new
                {
                    name = templateName,
                    language = new { code = _langCode },
                    components = new object[] { new { type = "body", parameters = cleanValues.Select(t => new { type = "text", text = t.Length == 0 ? "-" : t }).ToArray() } },
                },
            };
            using var request = new HttpRequestMessage(HttpMethod.Post, $"https://graph.facebook.com/{_apiVersion}/{Uri.EscapeDataString(_phoneNumberId)}/messages")
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);

            var response = await _http.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("WhatsApp send failed: {Status} {Body}", response.StatusCode, body.Length > 300 ? body[..300] : body);
            }
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "WhatsApp send threw");
            return false;
        }
    }

    // "+..." as written; otherwise the dial code of the member with this mobile, else of the brand's default country.
    private async Task<string?> ToE164Async(string mobile)
    {
        var raw = mobile.Trim();
        static string Digits(string s) => new(s.Where(char.IsDigit).ToArray());
        string? code = null;
        if (!raw.StartsWith('+'))
        {
            await using var conn = new MySqlConnection(_connString);
            code = await conn.ExecuteScalarAsync<string?>(@"
                SELECT c.PhoneCode FROM member_master_profile m
                JOIN country_master c ON c.pk_country_id = CASE WHEN m.PrimaryMobileNumber = @M THEN m.fk_primary_country_id ELSE m.fk_secondary_country_id END
                WHERE m.PrimaryMobileNumber = @M OR m.SecondaryMobileNumber = @M
                LIMIT 1", new { M = raw });
            if (code == null && RotaryApi.Services.Brand.DefaultCountryId > 0)
                code = await conn.ExecuteScalarAsync<string?>("SELECT PhoneCode FROM country_master WHERE pk_country_id = @Id",
                    new { Id = RotaryApi.Services.Brand.DefaultCountryId });
            if (string.IsNullOrWhiteSpace(code)) return null;
        }
        var cc = Digits(code ?? "");
        var digits = Digits(raw).TrimStart('0');
        if (cc.Length > 0 && digits.StartsWith(cc) && digits.Length > cc.Length + 6) digits = digits[cc.Length..];
        var full = cc + digits;
        return full.Length is >= 8 and <= 15 ? "+" + full : null;
    }

    // Meta forbids tabs/newlines/3+ consecutive spaces in body variables, and the configured
    // greeting text is often rich HTML in mixed languages. Strip HTML, decode entities, normalize
    // smart punctuation, optionally keep English (ASCII) only, collapse whitespace, cap length.
    public static string CleanTemplateValue(string? v, bool dropForeignScripts = false)
    {
        if (string.IsNullOrEmpty(v)) return "";
        v = Regex.Replace(v, "<[^>]+>", " ");          // strip HTML tags
        v = System.Net.WebUtility.HtmlDecode(v);        // &nbsp; &amp; &rsquo; etc.
        // normalize common smart punctuation to ASCII so it survives the english-only filter
        v = v.Replace('‘', '\'').Replace('’', '\'')
             .Replace('“', '"').Replace('”', '"')
             .Replace('–', '-').Replace('—', '-')
             .Replace(' ', ' ').Replace("…", "...");
        if (dropForeignScripts)
            // drop non-Latin language scripts (Arabic, Indic, CJK, Hangul, Cyrillic, Thai) but KEEP
            // emojis, symbols, Latin text and URLs.
            v = Regex.Replace(v, @"[Ѐ-ӿ؀-ۿݐ-ݿऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ฀-๿぀-ヿ㐀-鿿가-힯]", "");
        // WhatsApp forbids newlines, tabs, and 3+ consecutive spaces in template parameters, so the
        // message must be a single paragraph — collapse every whitespace run to one space.
        v = Regex.Replace(v, @"\s+", " ").Trim();
        if (v.Length > 1000) v = v[..1000].TrimEnd();   // body-variable length safety
        return v;
    }
}
