using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dapper;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

// Brevo-only sender. POSTs to https://api.brevo.com/v3/smtp/email. Every send is also
// audit-logged to email_log table so it shows up in /settings/email-log alongside emails
// from the main API. Mirrors RotaryApi.Services.EmailService + BrevoEmailLog conventions.
public class EmailReportSender
{
    private static readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(60)
    };

    private readonly IConfiguration _config;
    private readonly ILogger<EmailReportSender> _logger;

    public EmailReportSender(IConfiguration config, ILogger<EmailReportSender> logger)
    {
        _config = config;
        _logger = logger;
    }

    // Branded logo band prepended to every report email so all worker emails carry the ROW header.
    private static string WrapWithLogo(string body) => $@"
<div style='text-align:center;padding:14px 0;background:#ffffff'>
  <img src='{RotaryApi.Services.Brand.EmailLogoUrl}' alt='ROW' style='height:46px' />
</div>
{body}";

    public async Task SendReportAsync(string subject, string htmlBody, byte[]? xlsxBytes = null, string? xlsxFileName = null)
    {
        htmlBody = WrapWithLogo(htmlBody);
        var recipients = _config.GetSection("RotaryOrgSync:ReportRecipients").Get<string[]>() ?? Array.Empty<string>();
        recipients = recipients.Where(e => !string.IsNullOrWhiteSpace(e)).Select(e => e.Trim()).ToArray();
        if (recipients.Length == 0)
        {
            _logger.LogWarning("[Email] no recipients configured — skipping");
            return;
        }

        // Per-recipient send so each gets its own audit row + Brevo handles bounces individually.
        foreach (var to in recipients)
        {
            long? logId = null;
            try
            {
                logId = await InsertPendingAsync(to, subject, htmlBody);
                var msgId = await SendViaBrevoAsync(to, subject, htmlBody, xlsxBytes, xlsxFileName);
                await MarkSentAsync(logId, msgId);
                _logger.LogInformation("[Email] sent → {To} (Brevo id={Id})", to, msgId);
            }
            catch (Exception ex)
            {
                await MarkFailedAsync(logId, ex.Message);
                _logger.LogError(ex, "[Email] failed → {To}", to);
                // Do not throw — one bad address must not stop the rest.
            }
        }
    }

    // Single-recipient send (e.g. the auto Club-Admin credentials email from the BOD sync).
    // Wraps with the logo header + audit-logs to email_log, exactly like SendReportAsync, but to
    // ONE member address instead of the report recipients.
    public async Task SendToMemberAsync(string toEmail, string subject, string htmlBody)
    {
        if (string.IsNullOrWhiteSpace(toEmail)) return;
        var to = toEmail.Trim();
        htmlBody = WrapWithLogo(htmlBody);
        long? logId = null;
        try
        {
            logId = await InsertPendingAsync(to, subject, htmlBody);
            var msgId = await SendViaBrevoAsync(to, subject, htmlBody, null, null);
            await MarkSentAsync(logId, msgId);
            _logger.LogInformation("[Email] sent → {To} (Brevo id={Id})", to, msgId);
        }
        catch (Exception ex)
        {
            await MarkFailedAsync(logId, ex.Message);
            _logger.LogError(ex, "[Email] admin-credentials send failed → {To}", to);
        }
    }

    // ─── Brevo HTTP POST ──────────────────────────────────────────────────

    private async Task<string?> SendViaBrevoAsync(string toEmail, string subject, string htmlBody, byte[]? attachmentBytes, string? attachmentFileName)
    {
        var brevo = _config.GetSection("Brevo");
        var apiKey = brevo["ApiKey"] ?? throw new InvalidOperationException("Brevo:ApiKey is not configured.");
        var apiUrl = brevo["ApiUrl"] ?? "https://api.brevo.com/v3/smtp/email";
        var senderEmail = brevo["SenderEmail"] ?? RotaryApi.Services.Brand.NoReplyEmail;
        var senderName = brevo["SenderName"] ?? "ROW";

        var payload = new Dictionary<string, object?>
        {
            ["sender"] = new { name = senderName, email = senderEmail },
            ["to"] = new[] { new { email = toEmail } },
            ["subject"] = subject,
            ["htmlContent"] = htmlBody
        };
        if (attachmentBytes is { Length: > 0 } && !string.IsNullOrEmpty(attachmentFileName))
        {
            payload["attachment"] = new[]
            {
                new { name = attachmentFileName, content = Convert.ToBase64String(attachmentBytes) }
            };
        }

        var json = JsonSerializer.Serialize(payload);
        using var req = new HttpRequestMessage(HttpMethod.Post, apiUrl)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Add("api-key", apiKey);

        using var resp = await _httpClient.SendAsync(req);
        var respBody = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException($"Brevo {(int)resp.StatusCode}: {respBody}");

        try
        {
            using var doc = JsonDocument.Parse(respBody);
            if (doc.RootElement.TryGetProperty("messageId", out var mid)) return mid.GetString();
        }
        catch { /* parse failures are non-fatal; messageId is metadata only */ }
        return null;
    }

    // ─── email_log table writes (best-effort) ─────────────────────────────

    private MySqlConnection? OpenConnectionOrNull()
    {
        var cs = _config.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(cs)) return null;
        try
        {
            var conn = new MySqlConnection(cs);
            conn.Open();
            return conn;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[email_log] connection open failed");
            return null;
        }
    }

    private async Task<long?> InsertPendingAsync(string toEmail, string subject, string htmlBody)
    {
        try
        {
            using var conn = OpenConnectionOrNull();
            if (conn == null) return null;
            return await conn.ExecuteScalarAsync<long>(@"
                INSERT INTO email_log (recipient_email, subject, body_html, email_type, status, sent_at)
                VALUES (@To, @Subject, @Body, @Type, 'Pending', NOW());
                SELECT LAST_INSERT_ID();",
                new
                {
                    To = toEmail,
                    Subject = subject,
                    Body = htmlBody,
                    Type = ClassifyType(subject)
                });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[email_log] InsertPending failed for {To}", toEmail);
            return null;
        }
    }

    private async Task MarkSentAsync(long? logId, string? brevoMessageId)
    {
        if (!logId.HasValue) return;
        try
        {
            using var conn = OpenConnectionOrNull();
            if (conn == null) return;
            await conn.ExecuteAsync(
                "UPDATE email_log SET status='Sent', brevo_message_id=@Mid, sent_at=NOW() WHERE pk_id=@Id",
                new { Mid = brevoMessageId, Id = logId.Value });
        }
        catch (Exception ex) { _logger.LogWarning(ex, "[email_log] MarkSent failed for id={Id}", logId); }
    }

    private async Task MarkFailedAsync(long? logId, string error)
    {
        if (!logId.HasValue) return;
        try
        {
            using var conn = OpenConnectionOrNull();
            if (conn == null) return;
            var trimmed = error.Length > 1000 ? error[..1000] : error;
            await conn.ExecuteAsync(
                "UPDATE email_log SET status='Failed', error_message=@Err, sent_at=NOW() WHERE pk_id=@Id",
                new { Err = trimmed, Id = logId.Value });
        }
        catch (Exception ex) { _logger.LogWarning(ex, "[email_log] MarkFailed failed for id={Id}", logId); }
    }

    // Subject-based classifier. Worker emails are all sync reports — broad bucket.
    private static string ClassifyType(string? subject)
    {
        if (string.IsNullOrWhiteSpace(subject)) return "Other";
        var s = subject;
        if (s.Contains("Bootstrap", StringComparison.OrdinalIgnoreCase) || s.Contains("Repair", StringComparison.OrdinalIgnoreCase)) return "Sync Clubs";
        if (s.Contains("Country", StringComparison.OrdinalIgnoreCase)) return "Sync Clubs";
        if (s.Contains("Member", StringComparison.OrdinalIgnoreCase) && (s.Contains("Sweep", StringComparison.OrdinalIgnoreCase) || s.Contains("Sync", StringComparison.OrdinalIgnoreCase) || s.Contains("Delta", StringComparison.OrdinalIgnoreCase))) return "Sync Members";
        if (s.Contains("BOD", StringComparison.OrdinalIgnoreCase) || s.Contains("Officer", StringComparison.OrdinalIgnoreCase)) return "Sync BOD";
        if (s.Contains("Terminate", StringComparison.OrdinalIgnoreCase)) return "Sync Terminations";
        if (s.Contains("Delta", StringComparison.OrdinalIgnoreCase)) return "Sync Delta";
        return "Sync Report";
    }
}
