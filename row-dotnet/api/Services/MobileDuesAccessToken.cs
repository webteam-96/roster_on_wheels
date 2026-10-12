using System.Security.Cryptography;
using System.Text;

namespace RotaryApi.Services;

// HMAC-signed token used to deep-link a logged-in mobile member into the
// existing public pay page (/pay/dues/{duesId}). The Flutter app embeds this
// token in the pay URL it surfaces to the member — when the page loads with
// ?memberId=X&token=Y, the public dues controller verifies the signature,
// resolves the member from the JWT-equivalent payload, and skips the OTP
// step. The page then renders the member-specific paid/unpaid view.
//
// Same secret reuse rationale as MembershipDuesApprovalToken — JwtSettings:Secret.
// Token format: "{base64url(payloadJson)}.{base64url(sigHmacSha256)}"
// Payload: {"d":<duesId>,"m":<memberId>,"e":<expiryUnix>}
//
// Default lifetime 30 days — long enough that a reminder link landing in the
// member's inbox stays usable; short enough that a stolen URL ages out.
public static class MobileDuesAccessToken
{
    private const int DefaultLifetimeDays = 30;

    public sealed class Payload
    {
        public int DuesId { get; init; }
        public int MemberId { get; init; }
        public long ExpiryUnix { get; init; }
    }

    public static string Generate(int duesId, int memberId, string secret, int? lifetimeDays = null)
    {
        var expiry = DateTimeOffset.UtcNow.AddDays(lifetimeDays ?? DefaultLifetimeDays).ToUnixTimeSeconds();
        var payloadJson = $"{{\"d\":{duesId},\"m\":{memberId},\"e\":{expiry}}}";
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

        try
        {
            var payloadBytes = Base64UrlDecode(payloadB64);
            var payloadJson = Encoding.UTF8.GetString(payloadBytes);
            using var doc = System.Text.Json.JsonDocument.Parse(payloadJson);
            var root = doc.RootElement;
            int d = root.GetProperty("d").GetInt32();
            int m = root.GetProperty("m").GetInt32();
            long e = root.GetProperty("e").GetInt64();
            payload = new Payload { DuesId = d, MemberId = m, ExpiryUnix = e };
        }
        catch
        {
            error = "Invalid token payload.";
            return false;
        }

        if (DateTimeOffset.FromUnixTimeSeconds(payload.ExpiryUnix) < DateTimeOffset.UtcNow)
        {
            error = "This payment link has expired. Open the membership dues from your mobile app to get a fresh link.";
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
