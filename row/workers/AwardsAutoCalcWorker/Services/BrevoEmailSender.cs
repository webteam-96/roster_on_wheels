using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace AwardsAutoCalcWorker.Services;

// Minimal Brevo (Sendinblue) HTTP API sender. No SMTP, no MailKit — just one
// POST to https://api.brevo.com/v3/smtp/email per recipient. Matches what the
// RotaryApi project uses so the completion email looks identical.
public class BrevoEmailSender
{
    private readonly HttpClient _http;
    private readonly ILogger<BrevoEmailSender> _logger;
    private readonly string _apiUrl;
    private readonly string _apiKey;
    private readonly string _senderName;
    private readonly string _senderEmail;

    public BrevoEmailSender(HttpClient http, ILogger<BrevoEmailSender> logger,
        string apiUrl, string apiKey, string senderName, string senderEmail)
    {
        _http = http;
        _logger = logger;
        _apiUrl = apiUrl;
        _apiKey = apiKey;
        _senderName = senderName;
        _senderEmail = senderEmail;
    }

    public async Task<bool> SendAsync(string toEmail, string subject, string htmlBody)
    {
        if (string.IsNullOrWhiteSpace(toEmail)) return false;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, _apiUrl);
            req.Headers.Add("api-key", _apiKey);
            req.Headers.Add("accept", "application/json");
            req.Content = JsonContent.Create(new
            {
                sender = new { name = _senderName, email = _senderEmail },
                to = new[] { new { email = toEmail } },
                subject,
                htmlContent = htmlBody,
            });
            var res = await _http.SendAsync(req);
            var body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                _logger.LogWarning("Brevo send failed for {Email}: {Status} {Body}", RotaryApi.Services.LogMask.Email(toEmail), res.StatusCode, body);
                return false;
            }
            _logger.LogInformation("📧 Email sent → {Email}", RotaryApi.Services.LogMask.Email(toEmail));
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Brevo send threw for {Email}", RotaryApi.Services.LogMask.Email(toEmail));
            return false;
        }
    }
}
