using System.Security.Cryptography;
using System.Text;

namespace RccGoalsFetcher;

/// Rotary.org passwords saved by the web API. Must match the API exactly: AES-256-GCM, key = base64
/// 32 bytes (RotaryOrgSync:CredentialKey), stored as "v1:" + Base64(nonce[12] + tag[16] + ciphertext),
/// plaintext UTF-8, no associated data.
public static class CredentialCrypto
{
    private const string Prefix = "v1:";
    private const int NonceSize = 12, TagSize = 16;

    public static string Encrypt(string plain, string base64Key)
    {
        var key = Key(base64Key);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var pt = Encoding.UTF8.GetBytes(plain);
        var ct = new byte[pt.Length];
        var tag = new byte[TagSize];
        using (var aes = new AesGcm(key, TagSize)) aes.Encrypt(nonce, pt, ct, tag);
        var blob = new byte[NonceSize + TagSize + ct.Length];
        nonce.CopyTo(blob, 0);
        tag.CopyTo(blob, NonceSize);
        ct.CopyTo(blob, NonceSize + TagSize);
        return Prefix + Convert.ToBase64String(blob);
    }

    public static string Decrypt(string stored, string base64Key)
    {
        if (string.IsNullOrEmpty(stored) || !stored.StartsWith(Prefix, StringComparison.Ordinal))
            throw new CryptographicException("Unknown password format.");
        var blob = Convert.FromBase64String(stored[Prefix.Length..]);
        if (blob.Length < NonceSize + TagSize) throw new CryptographicException("Password value too short.");
        var key = Key(base64Key);
        var nonce = blob.AsSpan(0, NonceSize);
        var tag = blob.AsSpan(NonceSize, TagSize);
        var ct = blob.AsSpan(NonceSize + TagSize);
        var pt = new byte[ct.Length];
        using (var aes = new AesGcm(key, TagSize)) aes.Decrypt(nonce, ct, tag, pt);
        return Encoding.UTF8.GetString(pt);
    }

    private static byte[] Key(string base64Key)
    {
        if (string.IsNullOrWhiteSpace(base64Key)) throw new CryptographicException("RotaryOrgSync:CredentialKey is not set.");
        var k = Convert.FromBase64String(base64Key.Trim());
        if (k.Length != 32) throw new CryptographicException("RotaryOrgSync:CredentialKey must be base64 of 32 bytes.");
        return k;
    }
}
