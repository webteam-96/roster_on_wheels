using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RotaryApi.Services;

/// <summary>
/// Helpers for the public directory data-collection "admin proxy" flow.
/// Allows the 2 contact persons configured on a district_directory_config row to log in
/// with mobile + password and fill the data-collection form on a member's behalf.
///
/// Password storage: PBKDF2-HMAC-SHA256, 100k iterations, 16-byte salt — stored as
/// "{salt-base64}:{hash-base64}". No external NuGet dep.
///
/// Admin token: signed JSON `{urlHash, mobile, slot, exp}` HMAC'd with a server-side key.
/// Stateless — no DB row required. Token TTL set on issue.
/// </summary>
public static class AdminProxyAuth
{
    private const int SaltSize = 16;
    private const int HashSize = 32;
    private const int Iterations = 100_000;

    public static string HashPassword(string password)
    {
        if (string.IsNullOrEmpty(password)) throw new ArgumentException("Password cannot be empty.", nameof(password));
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        using var pbkdf2 = new Rfc2898DeriveBytes(password, salt, Iterations, HashAlgorithmName.SHA256);
        var hash = pbkdf2.GetBytes(HashSize);
        return $"{Convert.ToBase64String(salt)}:{Convert.ToBase64String(hash)}";
    }

    public static bool VerifyPassword(string password, string? storedHash)
    {
        if (string.IsNullOrEmpty(password) || string.IsNullOrEmpty(storedHash)) return false;
        var parts = storedHash.Split(':', 2);
        if (parts.Length != 2) return false;
        try
        {
            var salt = Convert.FromBase64String(parts[0]);
            var expected = Convert.FromBase64String(parts[1]);
            using var pbkdf2 = new Rfc2898DeriveBytes(password, salt, Iterations, HashAlgorithmName.SHA256);
            var actual = pbkdf2.GetBytes(expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch { return false; }
    }
}

/// <summary>
/// Stateless signed token: payload + HMAC-SHA256 signature. Frontend stores in React state,
/// sends back on the save request. Server re-signs payload and compares to detect tampering / expiry.
/// </summary>
public sealed class AdminProxyTokenSigner
{
    private readonly byte[] _key;

    public AdminProxyTokenSigner(IConfiguration config)
    {
        var keyStr = config["AdminProxyToken:SigningKey"];
        if (string.IsNullOrWhiteSpace(keyStr))
        {
            // Fall back to the JWT signing key if a dedicated key isn't configured —
            // keeps appsettings minimal while still using a server-side secret.
            keyStr = config["Jwt:Key"] ?? "dev-fallback-please-set-AdminProxyToken-SigningKey";
        }
        _key = Encoding.UTF8.GetBytes(keyStr!);
    }

    public string Issue(string urlHash, string mobile, string contactSlot, TimeSpan ttl)
    {
        var payload = new
        {
            urlHash,
            mobile,
            slot = contactSlot,
            exp = DateTimeOffset.UtcNow.Add(ttl).ToUnixTimeSeconds()
        };
        var json = JsonSerializer.Serialize(payload);
        var payloadB64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
        var sig = Sign(payloadB64);
        return $"{payloadB64}.{sig}";
    }

    /// <summary>
    /// Returns null if token is invalid, tampered, or expired. Otherwise returns the payload fields.
    /// </summary>
    public AdminProxyTokenPayload? Validate(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var parts = token.Split('.', 2);
        if (parts.Length != 2) return null;
        var expectedSig = Sign(parts[0]);
        if (!CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expectedSig), Encoding.UTF8.GetBytes(parts[1]))) return null;
        try
        {
            var json = Encoding.UTF8.GetString(Convert.FromBase64String(parts[0]));
            var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var exp = root.GetProperty("exp").GetInt64();
            if (DateTimeOffset.FromUnixTimeSeconds(exp) < DateTimeOffset.UtcNow) return null;
            return new AdminProxyTokenPayload(
                root.GetProperty("urlHash").GetString() ?? "",
                root.GetProperty("mobile").GetString() ?? "",
                root.GetProperty("slot").GetString() ?? "",
                exp);
        }
        catch { return null; }
    }

    private string Sign(string data)
    {
        using var hmac = new HMACSHA256(_key);
        var sig = hmac.ComputeHash(Encoding.UTF8.GetBytes(data));
        return Convert.ToBase64String(sig);
    }
}

public sealed record AdminProxyTokenPayload(string UrlHash, string Mobile, string Slot, long ExpUnix);
