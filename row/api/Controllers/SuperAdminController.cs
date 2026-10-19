using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;
using System.Security.Claims;
using System.Security.Cryptography;

namespace RotaryApi.Controllers;

// Super Admin Role Config — existing SuperAdmin promotes / removes SuperAdmin role on any member,
// gated by an OTP sent to a fixed approver (SuperAdminApproval settings). Mobile + email destinations come from
// appsettings.SuperAdminApproval.OtpMobile / OtpEmail so they can change without rebuild.
[ApiController]
[Route("api/admin/super-admins")]
[Authorize]
public class SuperAdminController : ControllerBase
{
    // role_ids from roles table (seeded in DatabaseInitializer)
    private const int ROLE_MEMBER = 1;
    private const int ROLE_ADMIN = 2;
    private const int ROLE_SUPERADMIN = 3;
    private const int ROLE_ZONAL_COORDINATOR = 4;
    private const int ROLE_CLUB_MODERATOR = 5;
    private const int ROLE_AG = 6;
    private const int ROLE_RI_DIRECTOR = 7;

    // login_type in mobile_login_otp is VARCHAR(20) — keep this ≤ 20 chars
    private const string OTP_LOGIN_TYPE = "sa_approval";
    private const int OTP_EXPIRY_MINUTES = 5;
    private const int OTP_MAX_ATTEMPTS = 3;

    private readonly string _connectionString;
    private readonly IEmailService _email;
    private readonly ILogger<SuperAdminController> _logger;
    private readonly string _otpMobile;
    private readonly string _otpEmail;

    public SuperAdminController(IConfiguration config, IEmailService email, ILogger<SuperAdminController> logger)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
        _email = email;
        _logger = logger;
        _otpMobile = config["SuperAdminApproval:OtpMobile"] ?? "";
        _otpEmail = config["SuperAdminApproval:OtpEmail"] ?? "";
    }

    private MySqlConnection CreateConnection() => new(_connectionString);
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private int CurrentUserId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    // ── 1. List current SuperAdmins ────────────────────────────────────────
    [HttpGet]
    public async Task<ActionResult> List()
    {
        if (!IsSuperAdmin()) return Forbid();
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId,
                   m.MemberName AS memberName,
                   m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email,
                   mr.created_date AS promotedOn,
                   promoted_by_mem.MemberName AS promotedByName,
                   COALESCE(ga.IsEnabled, 0) AS goalSettingEnabled
            FROM member_roles mr
            JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id AND m.isdeleted = 0
            LEFT JOIN member_master_profile promoted_by_mem ON promoted_by_mem.pk_member_master_profile_id = mr.created_by
            LEFT JOIN goal_oversight_access ga ON ga.fk_member_id = m.pk_member_master_profile_id
            WHERE mr.fk_role_id = @Role AND mr.IsActive = 1
              AND (mr.isdeleted IS NULL OR mr.isdeleted = 0)
            ORDER BY mr.created_date DESC",
            new { Role = ROLE_SUPERADMIN });

        // Shape goalSettingEnabled as a real bool (tinyint → true/false) for the frontend checkbox.
        var shaped = rows.Select(r => new
        {
            memberId = r.memberId,
            memberName = r.memberName,
            mobile = r.mobile,
            email = r.email,
            promotedOn = r.promotedOn,
            promotedByName = r.promotedByName,
            goalSettingEnabled = Convert.ToInt32(r.goalSettingEnabled ?? 0) == 1,
        });
        return Ok(shaped);
    }

    // ── 1b. Toggle a SuperAdmin's "Goal Setting" access (per-member; instant save, no OTP) ──────────
    // Controls whether that SuperAdmin sees the Goal Setting oversight tile + observer view-as. Default OFF.
    public class GoalAccessRequest { public bool Enabled { get; set; } }

    [HttpPut("{memberId:int}/goal-setting-access")]
    public async Task<ActionResult> SetGoalSettingAccess(int memberId, [FromBody] GoalAccessRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (memberId <= 0) return BadRequest(new { message = "Invalid memberId" });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Only an active SuperAdmin can be granted Goal Setting access.
        var isSa = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @Id AND fk_role_id = @Role AND IsActive = 1
              AND (isdeleted IS NULL OR isdeleted = 0)",
            new { Id = memberId, Role = ROLE_SUPERADMIN });
        if (isSa == 0) return BadRequest(new { message = "This member is not an active SuperAdmin." });

        await conn.ExecuteAsync(@"
            INSERT INTO goal_oversight_access (fk_member_id, IsEnabled, created_date, modified_date, modified_by)
            VALUES (@Id, @En, NOW(), NOW(), @By)
            ON DUPLICATE KEY UPDATE IsEnabled = @En, modified_date = NOW(), modified_by = @By",
            new { Id = memberId, En = req.Enabled ? 1 : 0, By = CurrentUserId() });

        _logger.LogInformation("🎯 [SA] Goal Setting access {State} for member={Id} by={By}",
            req.Enabled ? "ENABLED" : "DISABLED", memberId, CurrentUserId());
        return Ok(new { message = $"Goal Setting {(req.Enabled ? "enabled" : "disabled")}.", goalSettingEnabled = req.Enabled });
    }

    // ── 2. Search members (for promotion picker) ───────────────────────────
    [HttpGet("search-members")]
    public async Task<ActionResult> SearchMembers([FromQuery] string q = "", [FromQuery] int limit = 20)
    {
        if (!IsSuperAdmin()) return Forbid();
        q = (q ?? "").Trim();
        if (q.Length < 2) return Ok(Array.Empty<object>());

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Exclude members who are already active SuperAdmins (can't promote twice).
        var rows = await conn.QueryAsync<dynamic>(@"
            SELECT m.pk_member_master_profile_id AS memberId,
                   m.MemberName AS memberName,
                   m.PrimaryMobileNumber AS mobile,
                   m.EmailId AS email,
                   m.RotaryId AS rotaryId,
                   c.ClubName AS clubName,
                   d.DistrictNumber AS districtNumber,
                   z.ZoneName AS zoneName,
                   (SELECT GROUP_CONCAT(r.RoleName)
                    FROM member_roles mr2
                    JOIN roles r ON r.pk_role_id = mr2.fk_role_id
                    WHERE mr2.fk_member_master_profile_id = m.pk_member_master_profile_id
                      AND mr2.IsActive = 1
                      AND (mr2.isdeleted IS NULL OR mr2.isdeleted = 0)) AS currentRoles
            FROM member_master_profile m
            LEFT JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0 AND cm.IsActive = 1
            LEFT JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
            LEFT JOIN district_master d ON d.pk_district_id = c.fk_district_id
            LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE m.isdeleted = 0
              AND (m.MemberName LIKE @Q OR m.PrimaryMobileNumber LIKE @Q OR m.EmailId LIKE @Q OR m.RotaryId LIKE @Q)
              AND NOT EXISTS (
                SELECT 1 FROM member_roles mr
                WHERE mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                  AND mr.fk_role_id = @SARole AND mr.IsActive = 1
                  AND (mr.isdeleted IS NULL OR mr.isdeleted = 0)
              )
            ORDER BY m.MemberName
            LIMIT @Limit",
            new { Q = $"%{q}%", SARole = ROLE_SUPERADMIN, Limit = limit });
        return Ok(rows);
    }

    // ── 3. Send OTP (to fixed approver) ────────────────────────────────────
    public class SendOtpRequest { public int MemberId { get; set; } public string Action { get; set; } = ""; }

    [HttpPost("send-otp")]
    public async Task<ActionResult> SendOtp([FromBody] SendOtpRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.MemberId <= 0) return BadRequest(new { message = "Invalid memberId" });
        var action = (req.Action ?? "").Trim().ToUpperInvariant();
        if (action != "PROMOTE" && action != "REMOVE")
            return BadRequest(new { message = "action must be PROMOTE or REMOVE" });
        if (string.IsNullOrWhiteSpace(_otpMobile) && string.IsNullOrWhiteSpace(_otpEmail))
            return StatusCode(500, new { message = "OTP approver not configured in appsettings (SuperAdminApproval.OtpMobile / OtpEmail)" });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        // Validate the target member exists
        var target = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = req.MemberId });
        if (target == null) return NotFound(new { message = "Member not found" });

        // Additional guard for REMOVE: the target must currently be SuperAdmin.
        if (action == "REMOVE")
        {
            var hasRole = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @Id AND fk_role_id = @Role AND IsActive = 1
                  AND (isdeleted IS NULL OR isdeleted = 0)",
                new { Id = req.MemberId, Role = ROLE_SUPERADMIN });
            if (hasRole == 0) return BadRequest(new { message = "This member is not a SuperAdmin." });

            if (req.MemberId == CurrentUserId())
                return BadRequest(new { message = "You cannot remove your own SuperAdmin role." });

            var saCount = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_role_id = @Role AND IsActive = 1 AND (isdeleted IS NULL OR isdeleted = 0)",
                new { Role = ROLE_SUPERADMIN });
            if (saCount <= 1) return BadRequest(new { message = "At least one SuperAdmin must remain — cannot remove the last one." });
        }

        // Generate 6-digit OTP, store in mobile_login_otp with identifier bound to action+memberId
        var otp = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
        var expiresAt = DateTime.UtcNow.AddMinutes(OTP_EXPIRY_MINUTES);
        var identifier = $"sa:{action}:{req.MemberId}";

        // Invalidate any prior unused OTP for this same action+member (prevents stale OTPs lingering).
        await conn.ExecuteAsync(@"
            UPDATE mobile_login_otp SET is_used = 1
            WHERE identifier = @Identifier AND login_type = @LoginType AND is_used = 0",
            new { Identifier = identifier, LoginType = OTP_LOGIN_TYPE });

        await conn.ExecuteAsync(@"
            INSERT INTO mobile_login_otp
                (fk_member_master_profile_id, login_type, identifier, country_id, otp_code, expires_at, max_attempts, is_used)
            VALUES (@MemberId, @LoginType, @Identifier, NULL, @Otp, @Exp, @MaxA, 0)",
            new
            {
                MemberId = req.MemberId,
                LoginType = OTP_LOGIN_TYPE,
                Identifier = identifier,
                Otp = otp,
                Exp = expiresAt,
                MaxA = OTP_MAX_ATTEMPTS
            });

        var targetName = (string)target.MemberName ?? "member";
        var actionVerb = action == "PROMOTE" ? "promote" : "remove SuperAdmin role from";
        var smsText = $"ROW: OTP {otp} to {actionVerb} {targetName}. Expires in {OTP_EXPIRY_MINUTES} min. Do not share.";
        var emailSubject = $"ROW — SuperAdmin {(action == "PROMOTE" ? "Promotion" : "Removal")} OTP";
        var emailBody = $@"{EmailService.EMAIL_HEADER}
<h2 style='color:#1a365d;margin-top:0;'>SuperAdmin {(action == "PROMOTE" ? "Promotion" : "Removal")} OTP</h2>
<p>An existing SuperAdmin requested to <strong>{actionVerb}</strong> <strong>{System.Net.WebUtility.HtmlEncode(targetName)}</strong>.</p>
<p>Please share this OTP with them only if you approve the action:</p>
<div style='background-color:#f7fafc;border:2px solid #3182ce;border-radius:8px;padding:20px;margin:16px 0;text-align:center;'>
  <p style='font-size:32px;font-weight:bold;color:#1a365d;letter-spacing:8px;margin:0;'>{otp}</p>
</div>
<p style='color:#e53e3e;'><strong>This OTP expires in {OTP_EXPIRY_MINUTES} minutes.</strong></p>
<p>If you did not expect this request, please contact the ROW team immediately.</p>
{EmailService.EMAIL_FOOTER}";

        bool smsOk = false, emailOk = false;
        // ROW sends no SMS: the code goes by email only.
        if (!string.IsNullOrWhiteSpace(_otpEmail))
        {
            try { await _email.SendGenericEmailAsync(_otpEmail, emailSubject, emailBody); emailOk = true; }
            catch (Exception ex) { _logger.LogWarning(ex, "SA-OTP email failed to {Email}", _otpEmail); }
        }

        if (!smsOk && !emailOk)
            return StatusCode(500, new { message = "Failed to deliver OTP via SMS and email. Please check logs." });

        _logger.LogInformation("🔐 [SA-OTP] action={Action} target={TargetId} by={ByUserId} sms={SmsOk} email={EmailOk}",
            action, req.MemberId, CurrentUserId(), smsOk, emailOk);

        return Ok(new
        {
            message = "OTP sent to approver. Ask them for the code.",
            // The OTP is NEVER returned here — echoing it let the requesting SuperAdmin read and paste
            // it themselves, which defeated the whole approver gate. Only the approver's SMS/email has it.
            sentSms = smsOk,
            sentEmail = emailOk,
            expiryMinutes = OTP_EXPIRY_MINUTES,
        });
    }

    // ── 4. Verify OTP and execute promote/remove ───────────────────────────
    public class VerifyOtpRequest { public int MemberId { get; set; } public string Action { get; set; } = ""; public string Otp { get; set; } = ""; }

    [HttpPost("verify-otp")]
    public async Task<ActionResult> VerifyOtp([FromBody] VerifyOtpRequest req)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (req.MemberId <= 0) return BadRequest(new { message = "Invalid memberId" });
        var action = (req.Action ?? "").Trim().ToUpperInvariant();
        if (action != "PROMOTE" && action != "REMOVE")
            return BadRequest(new { message = "action must be PROMOTE or REMOVE" });
        if (string.IsNullOrWhiteSpace(req.Otp) || req.Otp.Length != 6)
            return BadRequest(new { message = "OTP must be 6 digits" });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var identifier = $"sa:{action}:{req.MemberId}";
        var otpRow = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT pk_otp_id AS id, otp_code, attempts, max_attempts, expires_at
            FROM mobile_login_otp
            WHERE identifier = @Identifier AND login_type = @LoginType AND is_used = 0
            ORDER BY pk_otp_id DESC LIMIT 1",
            new { Identifier = identifier, LoginType = OTP_LOGIN_TYPE });
        if (otpRow == null) return BadRequest(new { message = "Please request an OTP first." });
        if (DateTime.UtcNow > (DateTime)otpRow.expires_at)
        {
            await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", new { Id = (int)otpRow.id });
            return BadRequest(new { message = "OTP expired. Please request a new one." });
        }
        int attempts = Convert.ToInt32(otpRow.attempts);
        int maxAttempts = Convert.ToInt32(otpRow.max_attempts);
        if (attempts >= maxAttempts)
        {
            await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", new { Id = (int)otpRow.id });
            return BadRequest(new { message = "Too many attempts. Please request a new OTP." });
        }
        if ((string)otpRow.otp_code != req.Otp)
        {
            await conn.ExecuteAsync("UPDATE mobile_login_otp SET attempts = attempts + 1 WHERE pk_otp_id = @Id", new { Id = (int)otpRow.id });
            return BadRequest(new { message = $"Invalid OTP. {maxAttempts - attempts - 1} attempts left." });
        }

        // OTP valid — mark used before doing work.
        await conn.ExecuteAsync("UPDATE mobile_login_otp SET is_used = 1 WHERE pk_otp_id = @Id", new { Id = (int)otpRow.id });

        var targetInfo = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
            SELECT MemberName, PrimaryMobileNumber, EmailId
            FROM member_master_profile WHERE pk_member_master_profile_id = @Id AND isdeleted = 0",
            new { Id = req.MemberId });
        if (targetInfo == null) return NotFound(new { message = "Member not found" });
        var targetName = (string?)targetInfo.MemberName ?? "";
        var targetMobile = (string?)targetInfo.PrimaryMobileNumber ?? "";
        var targetEmail = (string?)targetInfo.EmailId ?? "";

        var byUserId = CurrentUserId();
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var otpSentTo = string.Join(", ",
            new[] { _otpMobile, _otpEmail }.Where(s => !string.IsNullOrWhiteSpace(s)));

        using var tx = await conn.BeginTransactionAsync();
        try
        {
            if (action == "PROMOTE")
            {
                // Role mutual-exclusion REMOVED (2026-08-14): promoting to SuperAdmin no longer deactivates
                // ZonalCoordinator / RIDirector (or any other role). Every role the member holds STAYS —
                // a member can now be SuperAdmin AND District/Club Admin AND ZC/RID/AG/Moderator at once.

                // Upsert SuperAdmin row — reactivate if a soft-inactive one exists, else INSERT.
                var updated = await conn.ExecuteAsync(@"
                    UPDATE member_roles
                    SET IsActive = 1, modified_date = NOW(), modified_by = @By, isdeleted = 0
                    WHERE fk_member_master_profile_id = @Id AND fk_role_id = @Role",
                    new { Id = req.MemberId, By = byUserId, Role = ROLE_SUPERADMIN }, tx);
                if (updated == 0)
                {
                    await conn.ExecuteAsync(@"
                        INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, IsActive, created_by, created_date)
                        VALUES (@Id, @Role, 1, @By, NOW())",
                        new { Id = req.MemberId, By = byUserId, Role = ROLE_SUPERADMIN }, tx);
                }

                // Ensure the member has a credentials row — generate temp password if none.
                string? tempPassword = null;
                var credExists = await conn.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM member_credentials
                    WHERE fk_member_master_profile_id = @Id AND IsActive = 1 AND (isdeleted IS NULL OR isdeleted = 0)",
                    new { Id = req.MemberId }, tx);
                if (credExists == 0)
                {
                    tempPassword = GenerateTempPassword();
                    var hash = BCrypt.Net.BCrypt.HashPassword(tempPassword);
                    var credUpdated = await conn.ExecuteAsync(@"
                        UPDATE member_credentials
                        SET IsActive = 1, isdeleted = 0, PasswordHash = @Hash, IsTemporaryPassword = 1, modified_date = NOW()
                        WHERE fk_member_master_profile_id = @Id",
                        new { Id = req.MemberId, Hash = hash }, tx);
                    if (credUpdated == 0)
                    {
                        await conn.ExecuteAsync(@"
                            INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by)
                            VALUES (@Id, @Hash, 1, 1, @By)",
                            new { Id = req.MemberId, Hash = hash, By = byUserId }, tx);
                    }
                }

                await conn.ExecuteAsync(@"
                    INSERT INTO superadmin_audit (fk_target_member_id, fk_by_member_id, Action, OtpSentTo, IpAddress)
                    VALUES (@Id, @By, 'PROMOTED', @Otp, @Ip)",
                    new { Id = req.MemberId, By = byUserId, Otp = otpSentTo, Ip = ip }, tx);

                await tx.CommitAsync();

                // Send welcome email AFTER transaction committed.
                if (!string.IsNullOrWhiteSpace(targetEmail))
                {
                    try { await _email.SendSuperAdminWelcomeEmailAsync(targetEmail, targetName, targetMobile, tempPassword); }
                    catch (Exception ex) { _logger.LogWarning(ex, "SA welcome email failed to {Email}", targetEmail); }
                }
                _logger.LogInformation("🔐 [SA] PROMOTED member={Id} by={By}", req.MemberId, byUserId);
                return Ok(new { message = "Member promoted to SuperAdmin.", credentialsSent = !string.IsNullOrWhiteSpace(targetEmail) });
            }
            else // REMOVE
            {
                if (req.MemberId == byUserId)
                {
                    await tx.RollbackAsync();
                    return BadRequest(new { message = "You cannot remove your own SuperAdmin role." });
                }
                var saCount = await conn.ExecuteScalarAsync<int>(@"
                    SELECT COUNT(*) FROM member_roles
                    WHERE fk_role_id = @Role AND IsActive = 1 AND (isdeleted IS NULL OR isdeleted = 0)",
                    new { Role = ROLE_SUPERADMIN }, tx);
                if (saCount <= 1)
                {
                    await tx.RollbackAsync();
                    return BadRequest(new { message = "At least one SuperAdmin must remain." });
                }

                await conn.ExecuteAsync(@"
                    UPDATE member_roles
                    SET IsActive = 0, modified_date = NOW(), modified_by = @By
                    WHERE fk_member_master_profile_id = @Id AND fk_role_id = @Role AND IsActive = 1
                      AND (isdeleted IS NULL OR isdeleted = 0)",
                    new { Id = req.MemberId, By = byUserId, Role = ROLE_SUPERADMIN }, tx);

                await conn.ExecuteAsync(@"
                    INSERT INTO superadmin_audit (fk_target_member_id, fk_by_member_id, Action, OtpSentTo, IpAddress)
                    VALUES (@Id, @By, 'REMOVED', @Otp, @Ip)",
                    new { Id = req.MemberId, By = byUserId, Otp = otpSentTo, Ip = ip }, tx);

                await tx.CommitAsync();

                if (!string.IsNullOrWhiteSpace(targetEmail))
                {
                    try { await _email.SendSuperAdminRevokedEmailAsync(targetEmail, targetName); }
                    catch (Exception ex) { _logger.LogWarning(ex, "SA revoked email failed to {Email}", targetEmail); }
                }
                _logger.LogInformation("🔐 [SA] REMOVED member={Id} by={By}", req.MemberId, byUserId);
                return Ok(new { message = "SuperAdmin role removed." });
            }
        }
        catch
        {
            try { await tx.RollbackAsync(); } catch { }
            throw;
        }
    }

    private static string GenerateTempPassword()
    {
        // 12 chars, mixed: upper + lower + digits + a couple specials. Avoid ambiguous 0/O/l/1.
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$";
        var bytes = RandomNumberGenerator.GetBytes(12);
        var chars = new char[12];
        for (int i = 0; i < 12; i++) chars[i] = alphabet[bytes[i] % alphabet.Length];
        return new string(chars);
    }
}
