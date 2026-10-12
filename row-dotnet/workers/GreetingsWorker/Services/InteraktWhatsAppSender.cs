using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace GreetingsWorker.Services;

// Ports RotaryApi.Services.InteraktService.SendWhatsAppWithBodyValuesAsync.
// Sends a pre-approved Interakt template message; bodyValues fill the template's {{n}} placeholders.
public class InteraktWhatsAppSender
{
    private readonly HttpClient _http;
    private readonly ILogger<InteraktWhatsAppSender> _logger;
    private readonly string _apiKey;
    private readonly string _baseUrl;
    private readonly string _langCode;

    public InteraktWhatsAppSender(HttpClient http, ILogger<InteraktWhatsAppSender> logger,
        string apiKey, string baseUrl, string langCode)
    {
        _http = http;
        _logger = logger;
        _apiKey = apiKey;
        _baseUrl = baseUrl;
        _langCode = string.IsNullOrWhiteSpace(langCode) ? "en" : langCode;
    }

    public async Task<bool> SendTemplateAsync(string phoneNumber, string templateName, string[] bodyValues)
    {
        if (string.IsNullOrWhiteSpace(phoneNumber) || string.IsNullOrWhiteSpace(templateName)) return false;
        try
        {
            // Clean phone — strip +91 / + and keep the last 10 digits (matches InteraktService).
            var cleanPhone = phoneNumber.Replace("+91", "").Replace("+", "").Trim();
            cleanPhone = new string(cleanPhone.Where(char.IsDigit).ToArray());
            if (cleanPhone.Length > 10) cleanPhone = cleanPhone[^10..];
            if (cleanPhone.Length != 10) { _logger.LogWarning("Skipping invalid phone {Phone}", phoneNumber); return false; }

            // Clean every value (strip HTML, decode entities, collapse whitespace). The template
            // layout is fixed — {{1}}=member name, {{2}}=message, {{3}}=club/district name — so the
            // english-only filter is applied ONLY to the free-text MESSAGE (index 1); names/org keep
            // their original script.
            var cleanValues = bodyValues.Select((v, i) => CleanTemplateValue(v, dropForeignScripts: i == 1)).ToArray();

            var payload = new
            {
                countryCode = "+91",
                phoneNumber = cleanPhone,
                callbackData = "greeting",
                type = "Template",
                template = new { name = templateName, languageCode = _langCode, bodyValues = cleanValues }
            };

            var json = JsonSerializer.Serialize(payload);
            using var request = new HttpRequestMessage(HttpMethod.Post, _baseUrl)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            request.Headers.Add("Authorization", $"Basic {_apiKey}");

            var response = await _http.SendAsync(request);
            var responseBody = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
                _logger.LogWarning("WhatsApp send failed for {Phone}: {Status} {Body}", cleanPhone, response.StatusCode, responseBody);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "WhatsApp send threw for {Phone}", phoneNumber);
            return false;
        }
    }

    // Interakt forbids tabs/newlines/3+ consecutive spaces in body variables, and the configured
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
        // WhatsApp/Meta forbid newlines, tabs, and 3+ consecutive spaces in template parameters
        // (confirmed: Interakt rejects them). So the WhatsApp message must be a single paragraph —
        // collapse every whitespace run to one space. (Email keeps the line breaks separately.)
        v = Regex.Replace(v, @"\s+", " ").Trim();
        if (v.Length > 1000) v = v[..1000].TrimEnd();   // Interakt body-variable length safety
        return v;
    }
}
