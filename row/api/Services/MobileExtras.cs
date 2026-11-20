using System.Security.Cryptography;
using System.Text;

namespace RotaryApi.Services;

// Pure rules behind MobileExtrasController (leader-sent password reset, contact exchange by QR), kept here so the
// unit tests can reach them without a database.
public static class MobileExtras
{
    // A member gets at most this many leader-sent reset emails a day, and one leader sends at most this many a day.
    public const int ResetsPerMemberPerDay = 3;
    public const int ResetsPerSenderPerDay = 20;

    // How long a contact QR stays valid. The app redraws it before it runs out.
    public static readonly TimeSpan QrLifetime = TimeSpan.FromMinutes(5);

    // Null when allowed, else the reason to show the leader.
    public static string? ResetRefusal(int sentToMemberToday, int sentBySenderToday) =>
        sentToMemberToday >= ResetsPerMemberPerDay
            ? $"A reset email was already sent to this member {ResetsPerMemberPerDay} times in the last 24 hours. Try again tomorrow."
            : sentBySenderToday >= ResetsPerSenderPerDay
                ? $"You have sent {ResetsPerSenderPerDay} reset emails in the last 24 hours. Try again tomorrow."
                : null;

    // "ab***@example.org": tells the leader which address the email went to without showing it in full.
    public static string MaskEmail(string email)
    {
        var at = email.IndexOf('@');
        if (at <= 0) return "***";
        var local = email[..at];
        return (local.Length <= 2 ? local[..1] : local[..2]) + "***" + email[at..];
    }

    // Key for QR tokens, derived from the JWT secret so the QR signature cannot be replayed as anything else.
    public static byte[] QrKey(string jwtSecret) =>
        HMACSHA256.HashData(Encoding.UTF8.GetBytes(jwtSecret), Encoding.UTF8.GetBytes("row-contact-qr-v1"));

    // "cx1.<memberId>.<expiry unix seconds>.<signature>": carries no personal data, only who and until when.
    public static string CreateQrToken(int memberId, DateTime nowUtc, byte[] key)
    {
        var exp = new DateTimeOffset(nowUtc.Add(QrLifetime), TimeSpan.Zero).ToUnixTimeSeconds();
        var body = $"cx1.{memberId}.{exp}";
        return $"{body}.{Sign(body, key)}";
    }

    // The member id when the token is ours, untampered and not expired; else null.
    public static int? ReadQrToken(string? token, DateTime nowUtc, byte[] key)
    {
        var parts = (token ?? "").Trim().Split('.');
        if (parts.Length != 4 || parts[0] != "cx1") return null;
        if (!int.TryParse(parts[1], out var memberId) || memberId <= 0) return null;
        if (!long.TryParse(parts[2], out var exp)) return null;
        var expected = Encoding.ASCII.GetBytes(Sign($"cx1.{parts[1]}.{parts[2]}", key));
        if (!CryptographicOperations.FixedTimeEquals(expected, Encoding.ASCII.GetBytes(parts[3]))) return null;
        return new DateTimeOffset(nowUtc, TimeSpan.Zero).ToUnixTimeSeconds() > exp ? null : memberId;
    }

    private static string Sign(string body, byte[] key) =>
        Convert.ToBase64String(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(body)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    // vCard 3.0 (RFC 2426). Null or empty fields are left out, so hidden fields never reach the card.
    public static string BuildVCard(string name, string? phone, string? email, string? org)
    {
        var trimmed = name.Trim();
        var cut = trimmed.LastIndexOf(' ');
        var (given, family) = cut > 0 ? (trimmed[..cut].Trim(), trimmed[(cut + 1)..]) : (trimmed, "");
        var lines = new List<string> { "BEGIN:VCARD", "VERSION:3.0", $"N:{Esc(family)};{Esc(given)};;;", $"FN:{Esc(trimmed)}" };
        if (!string.IsNullOrWhiteSpace(phone)) lines.Add($"TEL;TYPE=CELL:{phone.Replace(" ", "")}");
        if (!string.IsNullOrWhiteSpace(email)) lines.Add($"EMAIL:{Esc(email)}");
        if (!string.IsNullOrWhiteSpace(org)) lines.Add($"ORG:{Esc(org)}");
        lines.Add("END:VCARD");
        return string.Join("\r\n", lines);
    }

    private static string Esc(string v) =>
        v.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,").Replace("\r", "").Replace("\n", "\\n");
}
