using System.Net;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using MySqlConnector;
using RotaryApi.DTOs;

namespace RotaryApi.Services;

/// <summary>
/// People who are not members subscribe to a club's bulletin from the club website (gap #6). Double opt-in: the
/// sign-up stores a Pending row and emails a confirm link; only Confirmed subscribers receive bulletins. Every copy
/// carries a one-click unsubscribe link and List-Unsubscribe headers. The confirm token is random and stored hashed
/// (48 hours); the unsubscribe token is "{id}.{HMAC}" so old emails keep working without storing it.
/// Links open small pages on the API (GET shows a button, POST acts), so mail scanners that prefetch links change nothing.
/// </summary>
public class BulletinSubscriberService
{
    public const string ConsentText = "I agree to receive this club's email bulletin. I can unsubscribe at any time with the link in each email.";
    private static readonly TimeSpan ConfirmLife = TimeSpan.FromHours(48);
    private static readonly TimeSpan ResendGap = TimeSpan.FromMinutes(10);

    private readonly string _cs;
    private readonly IConfiguration _config;
    private readonly IEmailService _email;
    private readonly ILogger<BulletinSubscriberService> _logger;

    public BulletinSubscriberService(IConfiguration config, IEmailService email, ILogger<BulletinSubscriberService> logger)
    {
        _cs = config.GetConnectionString("DefaultConnection")!;
        _config = config;
        _email = email;
        _logger = logger;
    }

    private MySqlConnection Conn() => new(_cs);
    private string Secret => _config["JwtSettings:Secret"] ?? "";
    public string ApiOrigin => (string.IsNullOrWhiteSpace(_config["Api:BaseUrl"]) ? Brand.ApiOrigin : _config["Api:BaseUrl"]!).TrimEnd('/');

    /// <summary>Lower-cased trimmed address, or null when it is not one address.</summary>
    public static string? NormaliseEmail(string? email)
    {
        var e = email?.Trim().ToLowerInvariant() ?? "";
        if (e.Length is < 3 or > 254 || e.Any(char.IsWhiteSpace) || e.Count(ch => ch == '@') != 1) return null;
        try { return new MailAddress(e).Address == e && e.Split('@')[1].Contains('.') ? e : null; }
        catch (FormatException) { return null; }
    }

    public static string HashToken(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    public static string UnsubscribeToken(int subscriberId, string secret)
    {
        var sig = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"row-bulletin-unsubscribe:v1:{subscriberId}"));
        return $"{subscriberId}.{System.Buffers.Text.Base64Url.EncodeToString(sig)}";
    }

    /// <summary>The subscriber the token was issued for, or null when it is malformed or not signed by this server.</summary>
    public static int? UnsubscribeSubscriber(string? token, string secret)
    {
        var dot = token?.IndexOf('.') ?? -1;
        if (secret.Length < 32 || dot <= 0 || token!.Length > 80 || !int.TryParse(token[..dot], out var id) || id <= 0) return null;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(UnsubscribeToken(id, secret)), Encoding.ASCII.GetBytes(token)) ? id : null;
    }

    public string UnsubscribeUrl(int subscriberId) => $"{ApiOrigin}/api/public/bulletin/unsubscribe/{UnsubscribeToken(subscriberId, Secret)}";

    /// <summary>
    /// Records a sign-up and emails the confirm link. Says nothing about whether the address was already known: an
    /// already Confirmed address gets no email, and a link is sent at most once per 10 minutes per address.
    /// Returns false when the club does not exist.
    /// </summary>
    public async Task<bool> SignUpAsync(int clubId, string email, string? name)
    {
        if (Secret.Length < 32) throw new InvalidOperationException("Sign-up is not available: JwtSettings:Secret is not set.");
        await using var c = Conn();
        await c.OpenAsync();
        var clubName = await c.ExecuteScalarAsync<string?>(
            "SELECT ClubName FROM club_master WHERE pk_club_id = @clubId AND IFNULL(isdeleted, 0) = 0", new { clubId });
        if (clubName == null) return false;

        var row = await c.QueryFirstOrDefaultAsync<(int Id, string Status, DateTime? Sent)>(@"
            SELECT pk_subscriber_id, status, confirm_sent_date FROM club_bulletin_subscribers WHERE fk_club_id = @clubId AND email = @email",
            new { clubId, email });
        if (row.Id > 0 && row.Status == "Confirmed") return true;
        if (row.Sent is { } sent && DateTime.UtcNow - sent < ResendGap) return true;

        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var p = new { clubId, email, name = string.IsNullOrWhiteSpace(name) ? null : name.Trim()[..Math.Min(120, name.Trim().Length)],
                      hash = HashToken(token), expires = DateTime.UtcNow.Add(ConfirmLife), consent = ConsentText };
        // A re-sign-up after unsubscribing starts again as Pending: it needs a new confirmation.
        await c.ExecuteAsync(@"
            INSERT INTO club_bulletin_subscribers (fk_club_id, email, name, status, confirm_token_hash, confirm_expires, confirm_sent_date, consent_text, signup_date)
            VALUES (@clubId, @email, @name, 'Pending', @hash, @expires, UTC_TIMESTAMP(), @consent, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE name = COALESCE(@name, name), status = 'Pending', confirm_token_hash = @hash, confirm_expires = @expires,
                confirm_sent_date = UTC_TIMESTAMP(), consent_text = @consent, signup_date = UTC_TIMESTAMP(), unsubscribed_date = NULL", p);

        var link = $"{ApiOrigin}/api/public/bulletin/confirm/{token}";
        var club = WebUtility.HtmlEncode(clubName);
        var html = $"<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1B2C42;max-width:560px\">"
                 + $"<p>Please confirm that you want to receive the email bulletin of {club}.</p>"
                 + $"<p><a href=\"{WebUtility.HtmlEncode(link)}\" style=\"color:#17458F;font-weight:bold\">Confirm my subscription</a></p>"
                 + "<p style=\"font-size:13px;color:#64748B\">The link works for 48 hours. If you did not sign up, ignore this email and nothing more will be sent.</p></div>";
        try
        {
            await _email.SendMassEmailAsync(email, $"Confirm your subscription to the {clubName} bulletin", html, clubName, null, null);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Bulletin confirm email failed for club {ClubId}", clubId);
            // Lets the visitor try again at once instead of waiting out the resend gap.
            await c.ExecuteAsync("UPDATE club_bulletin_subscribers SET confirm_sent_date = NULL WHERE fk_club_id = @clubId AND email = @email", new { clubId, email });
            throw new InvalidOperationException("The confirmation email could not be sent. Please try again later.");
        }
        return true;
    }

    /// <summary>The club name for a valid, unexpired confirm token, else null.</summary>
    public async Task<string?> ConfirmInfoAsync(string token)
    {
        await using var c = Conn();
        return await c.ExecuteScalarAsync<string?>(@"
            SELECT cm.ClubName FROM club_bulletin_subscribers s JOIN club_master cm ON cm.pk_club_id = s.fk_club_id
            WHERE s.confirm_token_hash = @hash AND s.status = 'Pending' AND s.confirm_expires > UTC_TIMESTAMP()",
            new { hash = HashToken(token ?? "") });
    }

    public async Task<bool> ConfirmAsync(string token)
    {
        await using var c = Conn();
        return await c.ExecuteAsync(@"
            UPDATE club_bulletin_subscribers SET status = 'Confirmed', confirmed_date = UTC_TIMESTAMP(), confirm_token_hash = NULL
            WHERE confirm_token_hash = @hash AND status = 'Pending' AND confirm_expires > UTC_TIMESTAMP()",
            new { hash = HashToken(token ?? "") }) > 0;
    }

    /// <summary>(club name, still subscribed) for a valid unsubscribe token, else null.</summary>
    public async Task<(string Club, bool Subscribed)?> UnsubscribeInfoAsync(string token)
    {
        if (UnsubscribeSubscriber(token, Secret) is not int id) return null;
        await using var c = Conn();
        var row = await c.QueryFirstOrDefaultAsync<(string? Club, string Status)>(@"
            SELECT cm.ClubName, s.status FROM club_bulletin_subscribers s JOIN club_master cm ON cm.pk_club_id = s.fk_club_id
            WHERE s.pk_subscriber_id = @id", new { id });
        return row.Club == null ? null : (row.Club, row.Status == "Confirmed");
    }

    public async Task<bool> UnsubscribeAsync(string token)
    {
        if (UnsubscribeSubscriber(token, Secret) is not int id) return false;
        await using var c = Conn();
        await c.ExecuteAsync(@"UPDATE club_bulletin_subscribers SET status = 'Unsubscribed', unsubscribed_date = UTC_TIMESTAMP(),
            confirm_token_hash = NULL WHERE pk_subscriber_id = @id AND status <> 'Unsubscribed'", new { id });
        return true;
    }

    public async Task<List<BulletinSubscriberDto>> ListAsync(int clubId)
    {
        await using var c = Conn();
        return (await c.QueryAsync<BulletinSubscriberDto>(@"
            SELECT pk_subscriber_id AS Id, email AS Email, name AS Name, status AS Status, signup_date AS SignupDate,
                   confirmed_date AS ConfirmedDate, unsubscribed_date AS UnsubscribedDate
            FROM club_bulletin_subscribers WHERE fk_club_id = @clubId
            ORDER BY (status = 'Confirmed') DESC, signup_date DESC LIMIT 2000", new { clubId })).ToList();
    }

    /// <summary>A manager removes a subscriber: unsubscribed, never mailed again unless they sign up and confirm anew.</summary>
    public async Task<bool> RemoveAsync(int clubId, int id)
    {
        await using var c = Conn();
        return await c.ExecuteAsync(@"UPDATE club_bulletin_subscribers SET status = 'Unsubscribed', unsubscribed_date = UTC_TIMESTAMP(),
            confirm_token_hash = NULL WHERE pk_subscriber_id = @id AND fk_club_id = @clubId", new { id, clubId }) > 0;
    }

    /// <summary>Confirmed subscribers who can be mailed: not suppressed (bounce, complaint) for the club or globally.</summary>
    public static async Task<List<(int Id, string Email)>> ConfirmedAsync(MySqlConnection c, int clubId) =>
        (await c.QueryAsync<(int, string)>(@"
            SELECT s.pk_subscriber_id, s.email FROM club_bulletin_subscribers s
            WHERE s.fk_club_id = @clubId AND s.status = 'Confirmed'
              AND NOT EXISTS (SELECT 1 FROM comm_suppressions x WHERE x.email = s.email
                  AND ((x.fk_club_id = @clubId AND x.fk_district_id = 0) OR (x.fk_club_id = 0 AND x.fk_district_id = 0)))",
            new { clubId })).ToList();

    /// <summary>The bulletin as a subscriber gets it: why they receive it and their own unsubscribe link at the end.</summary>
    public static string WithFooter(string html, string clubName, string unsubscribeUrl) =>
        html + $"<p style=\"font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748B;text-align:center;margin:24px 0 0 0\">"
             + $"You receive this because you subscribed to the {WebUtility.HtmlEncode(clubName)} bulletin. "
             + $"<a href=\"{WebUtility.HtmlEncode(unsubscribeUrl)}\" style=\"color:#64748B\">Unsubscribe</a></p>";

    public Dictionary<string, string> UnsubscribeHeaders(int subscriberId) => new()
    {
        ["List-Unsubscribe"] = $"<{UnsubscribeUrl(subscriberId)}>",
        ["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click",
    };

    /// <summary>A small self-contained page for the confirm and unsubscribe links (no scripts, form POSTs to itself).</summary>
    public static string Page(string title, string message, string? buttonLabel)
    {
        var form = buttonLabel == null ? ""
            : $"<form method=\"post\"><button type=\"submit\" style=\"font:inherit;font-weight:bold;padding:10px 20px;border:0;border-radius:999px;background:#17458F;color:#FCFDFE;cursor:pointer\">{WebUtility.HtmlEncode(buttonLabel)}</button></form>";
        return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
             + $"<meta name=\"robots\" content=\"noindex\"><title>{WebUtility.HtmlEncode(title)}</title></head>"
             + "<body style=\"margin:0;background:#F7F9FC;font-family:Arial,Helvetica,sans-serif;color:#1B2C42\">"
             + "<main style=\"max-width:520px;margin:64px auto;padding:24px;background:#FCFDFE;border:1px solid #D5DEE8;border-radius:16px\">"
             + $"<h1 style=\"font-size:22px;margin:0 0 12px 0\">{WebUtility.HtmlEncode(title)}</h1><p style=\"margin:0 0 20px 0\">{WebUtility.HtmlEncode(message)}</p>{form}"
             + "</main></body></html>";
    }
}
