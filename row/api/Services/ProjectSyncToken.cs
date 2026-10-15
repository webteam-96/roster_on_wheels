using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;

namespace RotaryApi.Services;

// AES-256-GCM encrypted, tamper-proof token handed to the RI Flow-Bot browser extension so it can
// tell our server, after the user publishes a project into Rotary International's Service Project
// Center, WHICH project was synced — without the extension holding any login/JWT. It carries ONLY
// { projectId, clubId, expiry }; the extension echoes it back to the public confirm endpoint, which
// decrypts it (tamper => decrypt throws) and flips synced_to_org on that exact project. Mirrors
// WebsitePayLinkToken (same key derivation + base64url framing) so no new appsettings entry is needed.
//
// Token = base64url( nonce(12) || ciphertext || tag(16) ).
// Payload JSON: {"p":<projectId>,"c":<clubId>,"e":<expiryUnix>[,"m":<memberId>]}
// "m" (who clicked Sync, for the sync log) is optional: tokens minted before it existed still decrypt.
public static class ProjectSyncToken
{
    private const int DefaultLifetimeDays = 30;   // long enough to review + publish on SPC later
    private const int NonceSize = 12;
    private const int TagSize = 16;

    public sealed class Payload
    {
        public int ProjectId { get; init; }
        public int ClubId { get; init; }
        public long ExpiryUnix { get; init; }
        public int? MemberId { get; init; }
    }

    public static string Generate(IConfiguration config, int projectId, int clubId, int? lifetimeDays = null,
        int? memberId = null)
    {
        var expiry = DateTimeOffset.UtcNow.AddDays(lifetimeDays ?? DefaultLifetimeDays).ToUnixTimeSeconds();
        var json = memberId is > 0
            ? $"{{\"p\":{projectId},\"c\":{clubId},\"e\":{expiry},\"m\":{memberId}}}"
            : $"{{\"p\":{projectId},\"c\":{clubId},\"e\":{expiry}}}";
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
            error = "Missing sync token.";
            return false;
        }

        byte[] combined;
        try { combined = Base64UrlDecode(token); }
        catch { error = "Invalid or malformed token."; return false; }
        if (combined.Length < NonceSize + TagSize + 1)
        {
            error = "Invalid or malformed token.";
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
            gcm.Decrypt(nonce, ciphertext, tag, plaintext);
        }
        catch
        {
            error = "This token is invalid or has been tampered with.";
            return false;
        }

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(Encoding.UTF8.GetString(plaintext));
            var root = doc.RootElement;
            payload = new Payload
            {
                ProjectId = root.GetProperty("p").GetInt32(),
                ClubId = root.GetProperty("c").GetInt32(),
                ExpiryUnix = root.GetProperty("e").GetInt64(),
                MemberId = root.TryGetProperty("m", out var m) && m.TryGetInt32(out var mid) ? mid : null,
            };
        }
        catch
        {
            error = "This token is invalid.";
            return false;
        }

        if (DateTimeOffset.FromUnixTimeSeconds(payload.ExpiryUnix) < DateTimeOffset.UtcNow)
        {
            error = "This sync token has expired.";
            return false;
        }
        return true;
    }

    private static byte[] DeriveKey(IConfiguration config)
    {
        var raw = config["Razorpay:PayLinkKey"];
        if (string.IsNullOrWhiteSpace(raw)) raw = config["JwtSettings:Secret"];
        if (string.IsNullOrWhiteSpace(raw)) raw = "rotary-club-website-paylink-fallback-key";
        return SHA256.HashData(Encoding.UTF8.GetBytes(raw));
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
