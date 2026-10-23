using System.Security.Cryptography;
using System.Text;

namespace RotaryApi.Services;

// HMAC-signed token that lets someone open the public Club Dues (District Dues)
// pay page for a specific club without logging in. Uses:
//   1. An officer (President/Secretary/Treasurer) taps "Copy payment link" and
//      shares the URL with someone else to pay on the club's behalf.
//   2. The pay link embedded in the email dues reminders.
//   3. A deep-link surfaced inside the mobile app for the officer themselves.
//
// NON-EXPIRING + STABLE (per requirement): the payload carries ONLY the dues +
// club it is scoped to, so the same (duesId, clubId) always produces the exact
// same token string — one canonical link per club, no duplicates piling up
// across reminders/copies — and it never goes stale. The HMAC is unchanged, so
// the link is still unforgeable and still bound to a single club.
//
// Token format (current): "{base64url(payloadJson)}.{base64url(sigHmacSha256)}"
// Payload (current): {"d":<duesId>,"c":<clubId>}
// Payload (legacy, still accepted): {"d":<duesId>,"c":<clubId>,"e":<expiryUnixSeconds>}
//   Legacy tokens are links already sent out in emails. They verify by
//   signature exactly as before; their "e" is READ but NOT enforced, so nobody
//   who already received a reminder is locked out. (To re-enable the legacy
//   deadline, restore the ExpiryUnix check in TryVerify.)
// Reuses JwtSettings:Secret (no new secret to rotate).
public static class ClubDuesAccessToken
{
    public sealed class Payload
    {
        public int DuesId { get; init; }
        public int ClubId { get; init; }
        // Legacy tokens only; null on tokens minted by the current Generate().
        public long? ExpiryUnix { get; init; }
        public bool IsLegacy => ExpiryUnix.HasValue;
    }

    // Deterministic: no timestamp, no randomness. Same inputs => same token.
    public static string Generate(int duesId, int clubId, string secret)
    {
        var payloadJson = $"{{\"d\":{duesId},\"c\":{clubId}}}";
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
                DuesId = root.GetProperty("d").GetInt32(),
                ClubId = root.GetProperty("c").GetInt32(),
                // "e" exists on legacy (pre-non-expiring) tokens only.
                ExpiryUnix = root.TryGetProperty("e", out var e) ? e.GetInt64() : null
            };
        }
        catch { error = "Invalid token payload."; return false; }

        // No expiry check — pay links are valid for as long as the campaign needs them.
        // Legacy tokens keep their "e" claim for diagnostics but are no longer rejected on it.
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
