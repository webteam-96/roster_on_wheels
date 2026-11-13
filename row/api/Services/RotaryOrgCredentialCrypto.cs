using System.Security.Cryptography;
using System.Text;

namespace RotaryApi.Services;

// District Governor Rotary.org password, stored encrypted (user 2026-11-06). AES-256-GCM with the key in
// config RotaryOrgSync:CredentialKey (base64, 32 bytes). Format "v1:" + Base64(nonce[12] + tag[16] + cipher).
// The RccGoalsFetcher worker uses the SAME key and format to decrypt - keep both in step.
public static class RotaryOrgCredentialCrypto
{
    private static byte[] Key(IConfiguration config)
    {
        var b64 = config["RotaryOrgSync:CredentialKey"];
        if (string.IsNullOrWhiteSpace(b64)) throw new InvalidOperationException("Rotary.org sync is not configured (RotaryOrgSync:CredentialKey).");
        var key = Convert.FromBase64String(b64.Trim());
        if (key.Length != 32) throw new InvalidOperationException("RotaryOrgSync:CredentialKey must be 32 bytes (base64).");
        return key;
    }

    public static bool IsConfigured(IConfiguration config)
    {
        try { Key(config); return true; } catch { return false; }
    }

    public static string Encrypt(IConfiguration config, string plain)
    {
        var nonce = RandomNumberGenerator.GetBytes(12);
        var data = Encoding.UTF8.GetBytes(plain);
        var cipher = new byte[data.Length];
        var tag = new byte[16];
        using var gcm = new AesGcm(Key(config), 16);
        gcm.Encrypt(nonce, data, cipher, tag);
        return "v1:" + Convert.ToBase64String(nonce.Concat(tag).Concat(cipher).ToArray());
    }

    public static string Decrypt(IConfiguration config, string stored)
    {
        if (!stored.StartsWith("v1:")) throw new InvalidOperationException("Unknown credential format.");
        var all = Convert.FromBase64String(stored[3..]);
        var nonce = all[..12]; var tag = all[12..28]; var cipher = all[28..];
        var plain = new byte[cipher.Length];
        using var gcm = new AesGcm(Key(config), 16);
        gcm.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }
}
