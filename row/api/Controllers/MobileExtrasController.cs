using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Mobile extras (gap agent, 2026-11-20).
//  (a) A club leader sends a member of their club a password-reset email: the existing Forgot Password link, to the
//      member's own address. The leader never sees or sets the password. Rate-limited, recorded, audited.
//  (b) Contact exchange by QR: the app shows a signed short-lived token (no personal data); another signed-in member
//      scans it and gets the card, filtered by the scanned member's own privacy settings.
[ApiController]
[Authorize]
public class MobileExtrasController : ControllerBase
{
    private readonly string _connectionString;
    private readonly IAuthService _auth;
    private readonly IAuditLogService _audit;
    private readonly byte[] _qrKey;

    public MobileExtrasController(IConfiguration configuration, IAuthService auth, IAuditLogService audit)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _auth = auth;
        _audit = audit;
        _qrKey = MobileExtras.QrKey(configuration["JwtSettings:Secret"]
            ?? throw new InvalidOperationException("JwtSettings:Secret is not configured."));
    }

    private int Me => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    // ── (a) Leader-sent password reset ──────────────────────────────────────

    // POST /api/clubs/{clubId}/members/{memberId}/password-reset
    [HttpPost("api/clubs/{clubId:int}/members/{memberId:int}/password-reset")]
    public async Task<IActionResult> SendPasswordReset(int clubId, int memberId)
    {
        var me = Me;
        if (me <= 0 || !await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, me, true, clubId))
            return StatusCode(403, new { message = "You do not manage this club." });

        await using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        var name = await conn.QueryFirstOrDefaultAsync<string?>(@"
            SELECT m.MemberName FROM club_members cm
            JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
            WHERE cm.fk_club_id = @Club AND cm.fk_member_master_profile_id = @Member
              AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0 AND m.isdeleted = 0
            LIMIT 1", new { Club = clubId, Member = memberId });
        if (name == null) return NotFound(new { message = "This person is not an active member of this club." });

        var since = DateTime.UtcNow.AddHours(-24);
        var counts = await conn.QueryFirstAsync<(int ToMember, int BySender)>(@"
            SELECT (SELECT COUNT(*) FROM club_password_reset_requests WHERE fk_member_id = @Member AND created_utc > @Since),
                   (SELECT COUNT(*) FROM club_password_reset_requests WHERE fk_sent_by_id = @Me AND created_utc > @Since)",
            new { Member = memberId, Me = me, Since = since });
        var refusal = MobileExtras.ResetRefusal(counts.ToMember, counts.BySender);
        if (refusal != null) return StatusCode(429, new { message = refusal });

        var email = await _auth.SendResetLinkToMemberAsync(memberId);
        if (email == null)
            return UnprocessableEntity(new { message = "This member has no email address on record. Add one to their profile first." });

        await conn.ExecuteAsync(@"
            INSERT INTO club_password_reset_requests (fk_club_id, fk_member_id, fk_sent_by_id, created_utc)
            VALUES (@Club, @Member, @Me, @Now)", new { Club = clubId, Member = memberId, Me = me, Now = DateTime.UtcNow });
        await _audit.LogAsync(me, "PASSWORD_RESET_SENT", "member", memberId, name, new { clubId }, HttpContext);

        var masked = MobileExtras.MaskEmail(email);
        return Ok(new { message = $"A password reset link was emailed to {masked}.", sentTo = masked });
    }

    // GET /api/clubs/{clubId}/password-resets: the last 100 leader-sent resets in this club.
    [HttpGet("api/clubs/{clubId:int}/password-resets")]
    public async Task<IActionResult> ResetHistory(int clubId)
    {
        var me = Me;
        if (me <= 0 || !await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, me, true, clubId))
            return StatusCode(403, new { message = "You do not manage this club." });
        await using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        var rows = await conn.QueryAsync(@"
            SELECT r.pk_request_id AS id, r.fk_member_id AS memberId, m.MemberName AS memberName,
                   r.fk_sent_by_id AS sentById, s.MemberName AS sentByName, r.created_utc AS sentAtUtc
            FROM club_password_reset_requests r
            LEFT JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_id
            LEFT JOIN member_master_profile s ON s.pk_member_master_profile_id = r.fk_sent_by_id
            WHERE r.fk_club_id = @Club
            ORDER BY r.created_utc DESC, r.pk_request_id DESC LIMIT 100", new { Club = clubId });
        return Ok(rows.Select(r => new
        {
            r.id, r.memberId, r.memberName, r.sentById, r.sentByName,
            sentAtUtc = DateTime.SpecifyKind((DateTime)r.sentAtUtc, DateTimeKind.Utc),
        }));
    }

    // ── (b) Contact exchange by QR ──────────────────────────────────────────

    // GET /api/contact-exchange/my-code: a fresh signed token for the caller's QR.
    [HttpGet("api/contact-exchange/my-code")]
    public IActionResult MyCode()
    {
        var me = Me;
        if (me <= 0) return Unauthorized();
        var now = DateTime.UtcNow;
        return Ok(new { code = MobileExtras.CreateQrToken(me, now, _qrKey), expiresAtUtc = now.Add(MobileExtras.QrLifetime) });
    }

    public sealed record ScanRequest(string? Code);

    // POST /api/contact-exchange/scan { code }: the scanned member's card, as far as their privacy settings allow.
    [HttpPost("api/contact-exchange/scan")]
    [EnableRateLimiting("member-search")]
    public async Task<IActionResult> Scan([FromBody] ScanRequest req)
    {
        var me = Me;
        if (me <= 0) return Unauthorized();
        var memberId = MobileExtras.ReadQrToken(req?.Code, DateTime.UtcNow, _qrKey);
        if (memberId == null)
            return BadRequest(new { message = "This QR code is not a ROW member code, or it has expired. Ask them to show it again." });

        await using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        var row = await conn.QueryFirstOrDefaultAsync<(string? Name, string? Mobile, string? PhoneCode, string? Email, bool PersonalVisible)>(@"
            SELECT m.MemberName, m.PrimaryMobileNumber, cty.PhoneCode, m.EmailId,
                   COALESCE(m.IsPersonalDetailsVisible + 0, 1) <> 0
            FROM member_master_profile m
            LEFT JOIN country_master cty ON cty.pk_country_id = m.fk_primary_country_id
            WHERE m.pk_member_master_profile_id = @Id AND m.isdeleted = 0", new { Id = memberId.Value });
        if (row.Name == null) return NotFound(new { message = "This member is no longer on ROW." });

        var clubs = (await conn.QueryAsync<string>(@"
            SELECT c.ClubName FROM club_members cm JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            WHERE cm.fk_member_master_profile_id = @Id AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0
            ORDER BY cm.fk_club_id", new { Id = memberId.Value })).ToList();

        // Same rules as the directories: the four phone/email flags (my club vs all clubs), and the app's
        // personal-details switch on top. A member scanning their own code sees everything.
        var shares = await MemberPrivacyHelper.ViewerSharesClubWithMemberAsync(conn, me, memberId.Value);
        var flags = MemberPrivacyHelper.FlagsFor(await MemberPrivacyHelper.GetFlagsAsync(conn, new[] { memberId.Value }), memberId.Value);
        var self = me == memberId.Value;
        var showPhone = self || (row.PersonalVisible && MemberPrivacyHelper.ShouldShowPhone(me, memberId.Value, shares, flags));
        var showEmail = self || (row.PersonalVisible && MemberPrivacyHelper.ShouldShowEmail(me, memberId.Value, shares, flags));

        string? phone = null;
        if (showPhone && !string.IsNullOrWhiteSpace(row.Mobile))
            phone = string.IsNullOrWhiteSpace(row.PhoneCode) ? row.Mobile.Trim() : $"+{row.PhoneCode.Trim().TrimStart('+')} {row.Mobile.Trim()}";
        var email = showEmail && !string.IsNullOrWhiteSpace(row.Email) ? row.Email.Trim() : null;
        var hidden = new List<string>();
        if (!showPhone) hidden.Add("phone");
        if (!showEmail) hidden.Add("email");
        var org = clubs.FirstOrDefault();

        return Ok(new
        {
            memberId = memberId.Value,
            name = row.Name,
            clubs,
            phone,
            email,
            hidden,
            vcard = MobileExtras.BuildVCard(row.Name, phone, email, org),
        });
    }
}
