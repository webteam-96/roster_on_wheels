using System.Security.Cryptography;
using System.Text;

namespace RotaryApi.Services;

/// <summary>RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the format every authenticator app reads, plus RFC 4648 base32.</summary>
public static class Totp
{
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    public static string NewSecret() => Base32Encode(RandomNumberGenerator.GetBytes(20));

    public static long StepAt(DateTime utc) => new DateTimeOffset(utc, TimeSpan.Zero).ToUnixTimeSeconds() / 30;

    public static string Code(string base32Secret, long step)
    {
        var counter = BitConverter.GetBytes(step);
        if (BitConverter.IsLittleEndian) Array.Reverse(counter);
        var hash = HMACSHA1.HashData(Base32Decode(base32Secret), counter);
        var o = hash[^1] & 0x0F;
        var bin = ((hash[o] & 0x7F) << 24) | (hash[o + 1] << 16) | (hash[o + 2] << 8) | hash[o + 3];
        return (bin % 1_000_000).ToString("D6");
    }

    /// <summary>The matching step within one step of now (clock drift), or null. Steps at or before
    /// <paramref name="lastUsedStep"/> are refused so a code cannot be replayed.</summary>
    public static long? Match(string base32Secret, string? code, DateTime utcNow, long? lastUsedStep)
    {
        code = (code ?? "").Replace(" ", "");
        if (code.Length != 6 || !code.All(char.IsAsciiDigit)) return null;
        var now = StepAt(utcNow);
        for (var s = now - 1; s <= now + 1; s++)
        {
            if (lastUsedStep.HasValue && s <= lastUsedStep.Value) continue;
            if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Code(base32Secret, s)), Encoding.ASCII.GetBytes(code)))
                return s;
        }
        return null;
    }

    public static string OtpAuthUri(string issuer, string account, string secret) =>
        $"otpauth://totp/{Uri.EscapeDataString(issuer)}:{Uri.EscapeDataString(account)}?secret={secret}&issuer={Uri.EscapeDataString(issuer)}&digits=6&period=30";

    public static string Base32Encode(byte[] data)
    {
        var sb = new StringBuilder();
        int buffer = 0, bits = 0;
        foreach (var b in data)
        {
            buffer = (buffer << 8) | b; bits += 8;
            while (bits >= 5) { sb.Append(Alphabet[(buffer >> (bits - 5)) & 31]); bits -= 5; }
        }
        if (bits > 0) sb.Append(Alphabet[(buffer << (5 - bits)) & 31]);
        return sb.ToString();
    }

    public static byte[] Base32Decode(string s)
    {
        var bytes = new List<byte>();
        int buffer = 0, bits = 0;
        foreach (var c in s.TrimEnd('=').ToUpperInvariant())
        {
            var v = Alphabet.IndexOf(c);
            if (v < 0) throw new FormatException("Invalid base32 character.");
            buffer = (buffer << 5) | v; bits += 5;
            if (bits >= 8) { bytes.Add((byte)(buffer >> (bits - 8))); bits -= 8; }
        }
        return bytes.ToArray();
    }
}
