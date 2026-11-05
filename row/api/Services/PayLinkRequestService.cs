using System.Net;
using Dapper;
using Microsoft.Extensions.Caching.Memory;
using MySqlConnector;

namespace RotaryApi.Services;

// Emails a current pay link to someone holding an old one. The caller learns nothing: the controller answers the same
// way before this runs. The mail goes only to the address on the member's record, and only for a link that member can use.
public sealed class PayLinkRequestService
{
    private const int MaxPerAddressPerHour = 3;
    private static readonly object CapLock = new();

    private readonly IConfiguration _config;
    private readonly IEmailService _email;
    private readonly IMemoryCache _cache;

    public PayLinkRequestService(IConfiguration config, IEmailService email, IMemoryCache cache)
    {
        _config = config;
        _email = email;
        _cache = cache;
    }

    public async Task RequestAsync(string kind, int id, string email)
    {
        await using var conn = new MySqlConnection(_config.GetConnectionString("DefaultConnection"));
        var secret = _config["JwtSettings:Secret"] ?? "";
        string? title, path;
        int? clubId = null, districtId = null;
        var isDues = kind == "dues";

        if (isDues)
        {
            var dues = await conn.QueryFirstOrDefaultAsync<(int? ClubId, string? Purpose)>(
                "SELECT fk_club_id, Purpose FROM membership_dues WHERE pk_membership_dues_id=@Id AND isdeleted=0 AND IsActive=1", new { Id = id });
            if (dues.ClubId is not > 0) return;
            clubId = dues.ClubId;
            title = dues.Purpose;
            path = $"/pay/dues/{id}?k={MobileDuesAccessToken.PayLinkKey(id, secret)}";
        }
        else
        {
            // Guest forms (FormType other than 1) have no record to match and their links never needed the key.
            var link = await conn.QueryFirstOrDefaultAsync<(string? Title, int? ClubId, int? DistrictId, int FormType)>(
                "SELECT Title, fk_club_id, fk_district_master_id, FormType FROM event_payment_links WHERE pk_id=@Id AND isdeleted=0 AND IsActive=1", new { Id = id });
            if (link.FormType != 1) return;
            clubId = link.ClubId > 0 ? link.ClubId : null;
            districtId = clubId == null && link.DistrictId > 0 ? link.DistrictId : null;
            title = link.Title;
            path = $"/pay/{id}?k={MobileDuesAccessToken.PayLinkKey(id, secret, MobileDuesAccessToken.EventLinkKind)}";
        }

        // The same people the link's member search can find.
        var onRecord = await conn.QueryFirstOrDefaultAsync<string?>(@"
            SELECT m.EmailId
            FROM member_master_profile m
            JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.IsActive=1 AND cm.isdeleted=0
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE m.isdeleted=0 AND m.EmailId=@Email
              AND (@ClubId IS NULL OR cm.fk_club_id=@ClubId)
              AND (@DistrictId IS NULL OR c.fk_district_id=@DistrictId)
              AND (@IsDues=0 OR COALESCE(cm.IsHonoraryMember, 0)=0)
            LIMIT 1", new { Email = email, ClubId = clubId, DistrictId = districtId, IsDues = isDues ? 1 : 0 });
        if (string.IsNullOrWhiteSpace(onRecord) || !TakeAddressSlot(onRecord)) return;

        var url = (_config["FrontendUrl"] ?? "http://localhost:3000").TrimEnd('/') + path;
        await _email.SendGenericEmailAsync(onRecord, "Your new payment link - ROW", $@"{EmailService.EMAIL_HEADER}
            <h2 style='color: #17458F; margin-top: 0;'>Your new payment link</h2>
            <p>Use this link for <strong>{WebUtility.HtmlEncode(title)}</strong>:</p>
            <p><a href='{url}' style='color:#17458F;'>{url}</a></p>
            <p style='color:#64748B;'>Someone asked for this link using your email address. If it was not you, ignore this email.</p>
        {EmailService.EMAIL_FOOTER}");
    }

    // Stops anyone rotating IPs to flood one member's inbox.
    // shortcut: the count lives in this process and resets on restart, move it to the database if the API ever runs on several servers.
    private bool TakeAddressSlot(string address)
    {
        var key = "pay-link-request:" + address.Trim().ToLowerInvariant();
        lock (CapLock)
        {
            var used = _cache.Get<int>(key);
            if (used >= MaxPerAddressPerHour) return false;
            _cache.Set(key, used + 1, TimeSpan.FromHours(1));
            return true;
        }
    }
}
