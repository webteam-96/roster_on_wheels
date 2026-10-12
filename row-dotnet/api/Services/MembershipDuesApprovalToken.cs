using System.Security.Cryptography;
using System.Text;

namespace RotaryApi.Services;

// Short-lived HMAC-signed token used in offline-payment approval emails.
//
// Why a custom token instead of JWT: we want a tiny URL ("eyJ..." JWTs are
// long), no library dependencies on the public approval page, and we only
// need three integers in the payload. Same secret as JwtSettings:Secret so
// we don't introduce yet another secret to rotate.
//
// Token format: "{base64url(payloadJson)}.{base64url(sigHmacSha256)}"
// Payload JSON: {"p":<paymentId>,"a":<actorMemberId>,"e":<expiryUnixSeconds>}
//
// The action (approve|reject) is NOT in the token — that's chosen on the page.
// Same token works for both approve and reject. The recipient chooses.
public static class MembershipDuesApprovalToken
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
        if (string.IsNullOrWhiteSpace(token))
        {
            error = "Missing token.";
            return false;
        }
        var parts = token.Split('.', 2);
        if (parts.Length != 2)
        {
            error = "Invalid token format.";
            return false;
        }
        var payloadB64 = parts[0];
        var sigB64 = parts[1];

        // Recompute the signature and constant-time compare.
        byte[] expected;
        byte[] given;
        try
        {
            expected = Sign(payloadB64, secret);
            given = Base64UrlDecode(sigB64);
        }
        catch
        {
            error = "Invalid token signature.";
            return false;
        }
        if (!CryptographicOperations.FixedTimeEquals(expected, given))
        {
            error = "Invalid token signature.";
            return false;
        }

        // Parse payload only after the signature passes — never trust unsigned data.
        try
        {
            var payloadBytes = Base64UrlDecode(payloadB64);
            var payloadJson = Encoding.UTF8.GetString(payloadBytes);
            using var doc = System.Text.Json.JsonDocument.Parse(payloadJson);
            var root = doc.RootElement;
            int p = root.GetProperty("p").GetInt32();
            int a = root.GetProperty("a").GetInt32();
            long e = root.GetProperty("e").GetInt64();
            payload = new Payload { PaymentId = p, ActorMemberId = a, ExpiryUnix = e };
        }
        catch
        {
            error = "Invalid token payload.";
            return false;
        }

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

    // URL-safe base64 — strips padding, swaps +/= for -_.
    private static string Base64UrlEncode(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string s)
    {
        var swapped = s.Replace('-', '+').Replace('_', '/');
        switch (swapped.Length % 4) { case 2: swapped += "=="; break; case 3: swapped += "="; break; }
        return Convert.FromBase64String(swapped);
    }
}
