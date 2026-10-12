using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

// Receives Interakt's message-status callbacks and upgrades whatsapp_log rows from
// Sent → Delivered/Read, or → Failed. Public (Interakt posts server-to-server); an
// optional shared token (Interakt:WebhookToken) can gate it. The parser is deliberately
// tolerant — Interakt's exact JSON shape varies, so every payload is logged raw and we
// search common paths for a message id + status keyword.
[ApiController]
[Route("api/webhooks/interakt")]
[AllowAnonymous]
public class InteraktWebhookController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IConfiguration _config;
    private readonly ILogger<InteraktWebhookController> _logger;

    public InteraktWebhookController(IConfiguration configuration, ILogger<InteraktWebhookController> logger)
    {
        _config = configuration;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _logger = logger;
    }

    [HttpPost("")]
    public async Task<ActionResult> Receive([FromQuery] string? token = null)
    {
        // Optional shared-secret gate.
        var expected = _config["Interakt:WebhookToken"];
        if (!string.IsNullOrWhiteSpace(expected) && token != expected)
            return Unauthorized();

        string raw;
        using (var reader = new StreamReader(Request.Body))
            raw = await reader.ReadToEndAsync();

        _logger.LogInformation("Interakt webhook payload: {Body}", raw);
        if (string.IsNullOrWhiteSpace(raw)) return Ok(new { ignored = true });

        string? messageId = null, phone = null, statusRaw = null, failure = null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;

            // "type" like "message_api_delivered" / "message_api_read" / "message_api_failed" / "message_api_sent".
            if (root.TryGetProperty("type", out var typeEl) && typeEl.ValueKind == JsonValueKind.String)
                statusRaw = typeEl.GetString();

            messageId = FindString(root, "id", "message_id", "waba_message_id");
            phone = FindString(root, "phone_number", "channel_phone_number", "customer_phone_number", "to_number");
            var explicitStatus = FindString(root, "message_status", "status", "delivery_status");
            if (!string.IsNullOrWhiteSpace(explicitStatus)) statusRaw = explicitStatus;
            failure = FindString(root, "error", "error_message", "message_status_error", "failure_reason");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Interakt webhook: unparseable payload");
            return Ok(new { ignored = true });
        }

        var status = MapStatus(statusRaw);
        if (status == null)
        {
            _logger.LogInformation("Interakt webhook: no actionable status in '{Raw}'", statusRaw);
            return Ok(new { ignored = true });
        }

        int rank = Rank(status);
        bool isDelivered = status is "Delivered" or "Read";
        string? err = status == "Failed" ? Trunc(failure ?? statusRaw, 1000) : null;

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        int affected = 0;
        // Prefer an exact message-id match; fall back to the most recent Sent row for this phone.
        var sql = @"
            UPDATE whatsapp_log
            SET status = @Status,
                delivered_at = CASE WHEN @IsDelivered = 1 AND delivered_at IS NULL THEN NOW() ELSE delivered_at END,
                error_message = CASE WHEN @Err IS NOT NULL THEN @Err ELSE error_message END,
                modified_at = NOW()
            WHERE {0}
              AND (@Status = 'Failed'
                   OR (CASE status WHEN 'Read' THEN 4 WHEN 'Delivered' THEN 3 WHEN 'Sent' THEN 2 WHEN 'Failed' THEN 1 ELSE 0 END) <= @Rank)";

        if (!string.IsNullOrWhiteSpace(messageId))
        {
            affected = await conn.ExecuteAsync(string.Format(sql, "interakt_message_id = @Mid"),
                new { Status = status, IsDelivered = isDelivered ? 1 : 0, Err = err, Rank = rank, Mid = messageId });
        }
        if (affected == 0 && !string.IsNullOrWhiteSpace(phone))
        {
            var digits = new string(phone.Where(char.IsDigit).ToArray());
            var last10 = digits.Length >= 10 ? digits[^10..] : digits;
            affected = await conn.ExecuteAsync(
                string.Format(sql, "recipient_mobile LIKE CONCAT('%', @Last10) AND sent_at >= NOW() - INTERVAL 3 DAY")
                    + " ORDER BY pk_id DESC LIMIT 1",
                new { Status = status, IsDelivered = isDelivered ? 1 : 0, Err = err, Rank = rank, Last10 = last10 });
        }

        return Ok(new { updated = affected, status });
    }

    private static string? FindString(JsonElement el, params string[] names)
    {
        // Depth-limited recursive search for the first matching property with a scalar value.
        return Search(el, names, 0);
    }

    private static string? Search(JsonElement el, string[] names, int depth)
    {
        if (depth > 6) return null;
        switch (el.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var prop in el.EnumerateObject())
                {
                    if (names.Contains(prop.Name, StringComparer.OrdinalIgnoreCase))
                    {
                        if (prop.Value.ValueKind == JsonValueKind.String) return prop.Value.GetString();
                        if (prop.Value.ValueKind is JsonValueKind.Number) return prop.Value.ToString();
                    }
                }
                foreach (var prop in el.EnumerateObject())
                {
                    var r = Search(prop.Value, names, depth + 1);
                    if (r != null) return r;
                }
                return null;
            case JsonValueKind.Array:
                foreach (var item in el.EnumerateArray())
                {
                    var r = Search(item, names, depth + 1);
                    if (r != null) return r;
                }
                return null;
            default:
                return null;
        }
    }

    private static string? MapStatus(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var s = raw.ToLowerInvariant();
        if (s.Contains("read")) return "Read";
        if (s.Contains("deliver")) return "Delivered";
        if (s.Contains("fail") || s.Contains("undeliver") || s.Contains("reject")) return "Failed";
        if (s.Contains("sent")) return "Sent";
        return null;
    }

    private static int Rank(string status) => status switch
    {
        "Read" => 4, "Delivered" => 3, "Sent" => 2, "Failed" => 1, _ => 0
    };

    private static string? Trunc(string? s, int max)
        => string.IsNullOrEmpty(s) ? s : (s.Length <= max ? s : s.Substring(0, max));
}
