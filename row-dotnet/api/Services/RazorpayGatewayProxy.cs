using System.Security.Cryptography;
using System.Text;

namespace RotaryApi.Services;

// Razorpay signature verification helpers (mirrors CashfreeGatewayProxy's HMAC style).
//
// Razorpay contracts:
//   • Client checkout callback: signature = HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret) → hex
//   • Webhook: signature (header X-Razorpay-Signature) = HMAC_SHA256(rawRequestBody, webhook_secret) → hex
//
// Returns false when the keys are unconfigured / still the PLACEHOLDER sentinel, so nothing is
// ever credited against an unprovisioned gateway.
public static class RazorpayGatewayProxy
{
    private static bool NotConfigured(string? secret) =>
        string.IsNullOrWhiteSpace(secret) || secret.Contains("PLACEHOLDER", StringComparison.OrdinalIgnoreCase);

    public static bool VerifyPaymentSignature(IConfiguration config, string orderId, string paymentId, string receivedSignature)
    {
        var secret = config["Razorpay:KeySecret"];
        if (NotConfigured(secret) || string.IsNullOrWhiteSpace(receivedSignature)) return false;
        var expected = HmacSha256Hex($"{orderId}|{paymentId}", secret!);
        return FixedTimeEquals(expected, receivedSignature);
    }

    public static bool VerifyWebhookSignature(IConfiguration config, string rawBody, string receivedSignature)
    {
        var secret = config["Razorpay:WebhookSecret"];
        if (NotConfigured(secret) || string.IsNullOrWhiteSpace(receivedSignature)) return false;
        var expected = HmacSha256Hex(rawBody ?? "", secret!);
        return FixedTimeEquals(expected, receivedSignature);
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
