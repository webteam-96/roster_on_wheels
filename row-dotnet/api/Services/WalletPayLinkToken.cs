using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace RotaryApi.Services;

// AES-256-GCM encrypted, tamper-proof token embedded in the SuperAdmin's Wallet pay links
// (/pay/w/{token}) for WhatsApp/Email credit top-ups and the "common" pick-a-club links.
// Sibling of WebsitePayLinkToken — same crypto (AES-GCM, base64url) and same key
// (Razorpay:PayLinkKey else JwtSettings:Secret), but a wider payload:
//
//   { s:scope, p:purpose, e:entityId, x:expiryUnix }
//     scope   = "club" | "district"
//     purpose = "website" | "whatsapp" | "email"
//     entityId = clubId / districtId, or 0 for a "common" link (payer smart-searches on the page)
//
// The token carries NO amount — credit pricing (rate/GST) is always re-resolved server-side by
// WalletService, and website purchases funnel into the existing WebsitePayLinkToken flow. So
// nothing about the amount is ever client-supplied ("no foul play"), exactly like the website link.
// Token = base64url( nonce(12) || ciphertext || tag(16) ). Default lifetime 30 days.
public static class WalletPayLinkToken
{
    private const int DefaultLifetimeDays = 30;
    private const int NonceSize = 12;   // AES-GCM standard nonce
    private const int TagSize = 16;     // AES-GCM standard auth tag

    public sealed class Payload
    {
        public string Scope { get; init; } = "";      // "club" | "district"
        public string Purpose { get; init; } = "";     // "website" | "whatsapp" | "email"
        public int EntityId { get; init; }             // clubId / districtId, 0 = common (pick on page)
        public long ExpiryUnix { get; init; }
    }

    // neverExpires (user 2026-10-09): the Club Wallet's common pick-a-club links carry expiry 0 = no
    // expiry. Safe: no club and no amount is baked in - the payer picks the club, the server prices it.
    public static string Generate(IConfiguration config, string scope, string purpose, int entityId, int? lifetimeDays = null, bool neverExpires = false)
    {
        var expiry = neverExpires ? 0L : DateTimeOffset.UtcNow.AddDays(lifetimeDays ?? DefaultLifetimeDays).ToUnixTimeSeconds();
        var json = JsonSerializer.Serialize(new { s = scope, p = purpose, e = entityId, x = expiry });
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
            using var doc = JsonDocument.Parse(Encoding.UTF8.GetString(plaintext));
            var root = doc.RootElement;
            payload = new Payload
            {
                Scope = root.GetProperty("s").GetString() ?? "",
                Purpose = root.GetProperty("p").GetString() ?? "",
                EntityId = root.GetProperty("e").GetInt32(),
                ExpiryUnix = root.GetProperty("x").GetInt64(),
            };
        }
        catch
        {
            error = "This link is invalid.";
            return false;
        }

        if (payload.ExpiryUnix > 0 && DateTimeOffset.FromUnixTimeSeconds(payload.ExpiryUnix) < DateTimeOffset.UtcNow)
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
