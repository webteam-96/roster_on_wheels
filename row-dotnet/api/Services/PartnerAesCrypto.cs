using System.Security.Cryptography;
using System.Text;

namespace RotaryApi.Services;

// AES-256-CBC/PKCS7 decrypt for partner integrations that encrypt a value with a
// shared hex key + hex IV (e.g. Shrigoda's p_password). Distinct from this app's
// own AES-GCM token helpers (WalletPayLinkToken etc.), which are for tokens THIS
// server generates and later decrypts itself — not for decrypting ciphertext a
// third party produced with their own key.
public static class PartnerAesCrypto
{
    public static string DecryptBase64(string cipherTextBase64, string keyHex, string ivHex)
    {
        var key = Convert.FromHexString(keyHex);
        var iv = Convert.FromHexString(ivHex);
        using var aes = Aes.Create();
        aes.Key = key;
        aes.IV = iv;
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.PKCS7;
        using var decryptor = aes.CreateDecryptor();
        var cipherBytes = Convert.FromBase64String(cipherTextBase64);
        var plainBytes = decryptor.TransformFinalBlock(cipherBytes, 0, cipherBytes.Length);
        return Encoding.UTF8.GetString(plainBytes);
    }
}
