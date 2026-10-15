using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;

namespace RotaryApi.Services;

// AES-256-GCM encrypted, tamper-proof token embedded in the SuperAdmin's club-website
// pay links (/pay/club-website/{token}). It carries ONLY { clubId, yearId, expiry } —
// the price + GST + gateway + route account are all resolved server-side from
// club_website_pricing at pay time (WebsiteBillingService.ResolveConfig), so nothing
// about the amount is ever client-supplied ("no foul play"). GCM gives both
// confidentiality (payload is opaque) and integrity (tamper => decrypt throws).
//
// Key: SHA-256 of Razorpay:PayLinkKey when set, else SHA-256 of JwtSettings:Secret
// (same secret-reuse rationale as MobileDuesAccessToken / MembershipDuesApprovalToken —
// so no new appsettings entry is strictly required).
// Token = base64url( nonce(12) || ciphertext || tag(16) ).
// Payload JSON: {"c":<clubId>,"y":<yearId>,"e":<expiryUnix>}
//
// Default lifetime 30 days — long enough for a reminder link to stay usable in the
// President/Secretary inbox; short enough that a stale URL ages out.
public static class WebsitePayLinkToken
{
    private const int DefaultLifetimeDays = 30;
    private const int NonceSize = 12;   // AES-GCM standard nonce
    private const int TagSize = 16;     // AES-GCM standard auth tag

    public sealed class Payload
    {
        public int ClubId { get; init; }
        public int YearId { get; init; }
        public long ExpiryUnix { get; init; }
    }

    public static string Generate(IConfiguration config, int clubId, int yearId, int? lifetimeDays = null)
    {
        var expiry = DateTimeOffset.UtcNow.AddDays(lifetimeDays ?? DefaultLifetimeDays).ToUnixTimeSeconds();
        var json = $"{{\"c\":{clubId},\"y\":{yearId},\"e\":{expiry}}}";
        var plaintext = Encoding.UTF8.GetBytes(json);

        var key = DeriveKey(config);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagSize];
        using (var gcm = new AesGcm(key, TagSize))
        {
            gcm.Encrypt(nonce, plaintext, ciphertext, tag);
        }

        var combined = new byte[NonceSize + ciphertext.Length + TagSize];
        Buffer.BlockCopy(nonce, 0, combined, 0, NonceSize);
        Buffer.BlockCopy(ciphertext, 0, combined, NonceSize, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, combined, NonceSize + ciphertext.Length, TagSize);
        return Base64UrlEncode(combined);
    }

    public static bool TryDecrypt(IConfiguration config, string? token, out Payload? payload, out string? error)
    {
        payload = null;
        error = null;
        if (string.IsNullOrWhiteSpace(token))
        {
            error = "Missing link token.";
            return false;
        }

        byte[] combined;
        try
        {
            combined = Base64UrlDecode(token);
        }
        catch
        {
            error = "Invalid or malformed link.";
            return false;
        }
        if (combined.Length < NonceSize + TagSize + 1)
        {
            error = "Invalid or malformed link.";
            return false;
        }

        var key = DeriveKey(config);
        var nonce = new byte[NonceSize];
        var tag = new byte[TagSize];
        var ctLen = combined.Length - NonceSize - TagSize;
        var ciphertext = new byte[ctLen];
        Buffer.BlockCopy(combined, 0, nonce, 0, NonceSize);
        Buffer.BlockCopy(combined, NonceSize, ciphertext, 0, ctLen);
        Buffer.BlockCopy(combined, NonceSize + ctLen, tag, 0, TagSize);

        var plaintext = new byte[ctLen];
        try
        {
            using var gcm = new AesGcm(key, TagSize);
            gcm.Decrypt(nonce, ciphertext, tag, plaintext); // throws CryptographicException if tampered
        }
        catch
        {
            error = "This link is invalid or has been tampered with.";
            return false;
        }

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(Encoding.UTF8.GetString(plaintext));
            var root = doc.RootElement;
            payload = new Payload
            {
                ClubId = root.GetProperty("c").GetInt32(),
                YearId = root.GetProperty("y").GetInt32(),
                ExpiryUnix = root.GetProperty("e").GetInt64(),
            };
        }
        catch
        {
            error = "This link is invalid.";
            return false;
        }

        if (DateTimeOffset.FromUnixTimeSeconds(payload.ExpiryUnix) < DateTimeOffset.UtcNow)
        {
            error = "This payment link has expired. Please ask the Rotary office for a fresh link.";
            return false;
        }
        return true;
    }

    private static byte[] DeriveKey(IConfiguration config)
    {
        var raw = config["Razorpay:PayLinkKey"];
        if (string.IsNullOrWhiteSpace(raw)) raw = config["JwtSettings:Secret"];
        if (string.IsNullOrWhiteSpace(raw)) raw = "rotary-club-website-paylink-fallback-key";
        return SHA256.HashData(Encoding.UTF8.GetBytes(raw)); // 32 bytes => AES-256
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
