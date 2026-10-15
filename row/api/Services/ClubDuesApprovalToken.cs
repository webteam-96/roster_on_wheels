using System.Security.Cryptography;
using System.Text;

namespace RotaryApi.Services;

// Short-lived HMAC-signed token used in Club Dues offline-payment approval
// emails sent to the District Treasurer / configured approver email. The token
// IS the authorisation for the approve/reject page — no login required.
//
// Token format: "{base64url(payloadJson)}.{base64url(sigHmacSha256)}"
// Payload JSON: {"p":<paymentId>,"a":<actorMemberId>,"e":<expiryUnixSeconds>}
//   actorMemberId is the approver's member id, or 0 when the approver is a
//   plain email address (free-text ApproverEmail) with no member record.
// The action (approve|reject) is chosen on the page, not encoded in the token.
public static class ClubDuesApprovalToken
{
    private const int DefaultLifetimeDays = 7;

    public sealed class Payload
    {
        public int PaymentId { get; init; }
        public int ActorMemberId { get; init; }
        public long ExpiryUnix { get; init; }
    }

    public static string Generate(int paymentId, int actorMemberId, string secret, int? lifetimeDays = null)
    {
        var expiry = DateTimeOffset.UtcNow.AddDays(lifetimeDays ?? DefaultLifetimeDays).ToUnixTimeSeconds();
        var payloadJson = $"{{\"p\":{paymentId},\"a\":{actorMemberId},\"e\":{expiry}}}";
        var payloadB64 = Base64UrlEncode(Encoding.UTF8.GetBytes(payloadJson));
        var sigB64 = Base64UrlEncode(Sign(payloadB64, secret));
        return payloadB64 + "." + sigB64;
    }

    public static bool TryVerify(string? token, string secret, out Payload? payload, out string? error)
    {
        payload = null;
        error = null;
        if (string.IsNullOrWhiteSpace(token)) { error = "Missing token."; return false; }
        var parts = token.Split('.', 2);
        if (parts.Length != 2) { error = "Invalid token format."; return false; }
        var payloadB64 = parts[0];
        var sigB64 = parts[1];

        byte[] expected;
        byte[] given;
        try { expected = Sign(payloadB64, secret); given = Base64UrlDecode(sigB64); }
        catch { error = "Invalid token signature."; return false; }
        if (!CryptographicOperations.FixedTimeEquals(expected, given)) { error = "Invalid token signature."; return false; }

        try
        {
            var payloadJson = Encoding.UTF8.GetString(Base64UrlDecode(payloadB64));
            using var doc = System.Text.Json.JsonDocument.Parse(payloadJson);
            var root = doc.RootElement;
            payload = new Payload
            {
                PaymentId = root.GetProperty("p").GetInt32(),
                ActorMemberId = root.GetProperty("a").GetInt32(),
                ExpiryUnix = root.GetProperty("e").GetInt64()
            };
        }
        catch { error = "Invalid token payload."; return false; }

        if (DateTimeOffset.FromUnixTimeSeconds(payload.ExpiryUnix) < DateTimeOffset.UtcNow)
        {
            error = "This approval link has expired.";
            return false;
        }
        return true;
    }

    private static byte[] Sign(string payloadB64, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return hmac.ComputeHash(Encoding.UTF8.GetBytes(payloadB64));
    }

    private static string Base64UrlEncode(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string s)
    {
        var swapped = s.Replace('-', '+').Replace('_', '/');
        switch (swapped.Length % 4) { case 2: swapped += "=="; break; case 3: swapped += "="; break; }
        return Convert.FromBase64String(swapped);
    }
}
