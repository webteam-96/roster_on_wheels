using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RotaryApi.Services;

/// <summary>
/// Proof that a payer passed the OTP on one event payment link, issued by verify-otp. It names who pays: a member, or on a
/// guest form (MemberId 0) the verified email. create-order takes the payer from here, never from the request body.
/// </summary>
public static class EventPayerToken
{
    private const int LifetimeHours = 2;

    public static string Generate(int linkId, int memberId, string email, string secret)
    {
        var expiry = DateTimeOffset.UtcNow.AddHours(LifetimeHours).ToUnixTimeSeconds();
        var payload = Encode(JsonSerializer.SerializeToUtf8Bytes(new { l = linkId, m = memberId, a = email, e = expiry }));
        return payload + "." + Encode(Sign(payload, secret));
    }

    public static bool TryVerify(string? token, int linkId, string secret, out int memberId, out string email)
    {
        memberId = 0;
        email = "";
        var parts = (token ?? "").Split('.');
        if (parts.Length != 2) return false;
        try
        {
            if (!CryptographicOperations.FixedTimeEquals(Sign(parts[0], secret), Decode(parts[1]))) return false;
            using var doc = JsonDocument.Parse(Decode(parts[0]));
            var root = doc.RootElement;
            if (root.GetProperty("l").GetInt32() != linkId
                || DateTimeOffset.FromUnixTimeSeconds(root.GetProperty("e").GetInt64()) < DateTimeOffset.UtcNow) return false;
            memberId = root.GetProperty("m").GetInt32();
            email = root.GetProperty("a").GetString() ?? "";
            return true;
        }
        catch (Exception ex) when (ex is FormatException or JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return false;
        }
    }

    private static byte[] Sign(string payload, string secret) =>
        HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes("event-payer:" + payload));

    private static string Encode(byte[] data) => Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Decode(string s)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
    }
}
