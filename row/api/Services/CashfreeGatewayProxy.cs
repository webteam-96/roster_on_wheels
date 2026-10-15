using System.Security.Cryptography;
using System.Text;

namespace RotaryApi.Services;

// Builds a signed checkout URL for the shared Cashfree payment proxy hosted at
// https://example.org/cashfree-payment-gateway/. The proxy hosts the
// Cashfree JS SDK from a domain Cashfree has already whitelisted — so we never
// need to whitelist portal.example.org with Cashfree itself.
//
// Signature contract (must match helpers.php → verify_request_signature):
//   data_string = order_id + session_id + amount + return_url
//   signature   = HMAC_SHA256(data_string, project_secret) → hex lower-case
public static class CashfreeGatewayProxy
{
    public class BuildResult
    {
        public string ProxyUrl { get; set; } = "";
        public bool IsConfigured { get; set; }
    }

    public static BuildResult Build(
        IConfiguration config,
        string orderId,
        string sessionId,
        string amountText,
        string returnUrl,
        string? customerName = null,
        string? customerEmail = null,
        string? customerPhone = null,
        string currency = "INR")
    {
        var gw = config.GetSection("CashfreeGateway");
        var proxyBase = gw["ProxyUrl"];
        var projectKey = gw["ProjectKey"];
        var projectSecret = gw["ProjectSecret"];

        // If proxy isn't configured (e.g. dev sandbox without proxy), return empty — callers
        // fall back to direct Cashfree SDK.
        if (string.IsNullOrWhiteSpace(proxyBase)
            || string.IsNullOrWhiteSpace(projectKey)
            || string.IsNullOrWhiteSpace(projectSecret)
            || projectSecret.Contains("PLACEHOLDER", StringComparison.OrdinalIgnoreCase))
        {
            return new BuildResult { IsConfigured = false };
        }

        // 1. Sign per proxy contract: order_id + session_id + amount + return_url, HMAC-SHA256 hex.
        var data = orderId + sessionId + amountText + returnUrl;
        var signature = HmacSha256Hex(data, projectSecret);

        // 2. Build the final query string in a deterministic param order.
        var qp = new[]
        {
            ("session_id",     sessionId),
            ("order_id",       orderId),
            ("project_key",    projectKey),
            ("return_url",     returnUrl),
            ("amount",         amountText),
            ("currency",       currency),
            ("customer_name",  customerName  ?? ""),
            ("customer_email", customerEmail ?? ""),
            ("customer_phone", customerPhone ?? ""),
            ("signature",      signature),
        };

        var sep = proxyBase.Contains('?') ? "&" : "?";
        var qs = string.Join("&", qp.Select(p =>
            $"{Uri.EscapeDataString(p.Item1)}={Uri.EscapeDataString(p.Item2 ?? "")}"));

        return new BuildResult
        {
            ProxyUrl = proxyBase + sep + qs,
            IsConfigured = true
        };
    }

    // Same formula as helpers.php → generate_response_signature: HMAC_SHA256(order_id + status, secret) → hex.
    // Used by the verify-return endpoint that the thank-you page calls.
    public static bool VerifyResponseSignature(IConfiguration config, string orderId, string status, string receivedSignature)
    {
        var secret = config["CashfreeGateway:ProjectSecret"];
        if (string.IsNullOrWhiteSpace(secret) || secret.Contains("PLACEHOLDER", StringComparison.OrdinalIgnoreCase))
            return false;
        var expected = HmacSha256Hex(orderId + status, secret);
        return FixedTimeEquals(expected, receivedSignature ?? "");
    }

    private static string HmacSha256Hex(string data, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(data));
        var sb = new StringBuilder(hash.Length * 2);
        foreach (var b in hash) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }

    private static bool FixedTimeEquals(string a, string b)
    {
        if (a.Length != b.Length) return false;
        int diff = 0;
        for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }
}
