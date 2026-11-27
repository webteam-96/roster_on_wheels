using RotaryApi.Services;
using System.Data;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

// SuperAdmin diagnostic: would this member get into the app? Runs the app's own sign-in guards for an email, without
// the password, and returns the member, the clubs the app would show and the reason when the answer is no.
// No writes, no email.
[ApiController]
[Route("api/admin/mobile-login-check")]
[Authorize]
public class MobileLoginCheckController : ControllerBase
{
    private readonly string _connectionString;

    public MobileLoginCheckController(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet]
    public async Task<ActionResult> Check([FromQuery] string? email)
    {
        if (!await IsSuperAdminAsync())
            return StatusCode(403, new { message = "SuperAdmin access required." });

        var trimmed = (email ?? "").Trim();
        if (trimmed.Length == 0)
            return BadRequest(new { message = "Email is required." });

        using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();

        var found = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "sp_auth_get_member_by_email", new { p_Email = trimmed }, commandType: CommandType.StoredProcedure);
        if (found == null)
            return Ok(new { allowed = false, reason = "No member has this email.", email = trimmed, member = (object?)null, clubs = Array.Empty<object>() });

        int memberId = (int)found.Id;
        var member = new { id = memberId, name = (string?)found.MemberName ?? "", email = (string?)found.EmailId };
        ActionResult Refuse(string reason) =>
            Ok(new { allowed = false, reason, email = trimmed, member, clubs = Array.Empty<object>() });

        // In the order the app meets them (MobileAuthService.LoginWithPasswordAsync, then IssueSessionAsync).
        var cred = await conn.QueryFirstOrDefaultAsync<dynamic>(
            "sp_auth_get_credentials", new { p_MemberId = memberId }, commandType: CommandType.StoredProcedure);
        if (cred == null)
            return Refuse("No password yet. The member can set one with \"Forgot password?\" in the app.");
        int failed = cred.FailedLoginAttempts != null ? Convert.ToInt32(cred.FailedLoginAttempts) : 0;
        if (failed >= 5 && cred.LockoutEndTime is DateTime lockedUntil && lockedUntil > DateTime.UtcNow)
            return Refuse("Locked after 5 wrong passwords. It opens again within 15 minutes.");
        try
        {
            await TrialLock.RefuseIfLockedAsync(conn, memberId);
            await NonSyncLoginGuardHelper.EnsureCanLoginAsync(conn, memberId);
        }
        catch (UnauthorizedAccessException ex)
        {
            return Refuse(ex.Message);
        }

        // SuperAdmin-on-mobile policy: a SuperAdmin cannot use the app UNLESS they ALSO hold
        // another usable role (Admin / AG) or have at least
        // one active club membership. SA-only members are web-only.
        var isSuperAdmin = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND r.RoleName = 'SuperAdmin'
              AND mr.IsActive = 1 AND mr.isdeleted = 0",
            new { MemberId = memberId });

        if (isSuperAdmin > 0)
        {
            var hasOtherUsableRole = await conn.ExecuteScalarAsync<int>(@"
                SELECT
                    (SELECT COUNT(*) FROM member_roles mr
                     JOIN roles r ON r.pk_role_id = mr.fk_role_id
                     WHERE mr.fk_member_master_profile_id = @MemberId
                       AND r.RoleName <> 'SuperAdmin'
                       AND mr.IsActive = 1 AND mr.isdeleted = 0)
                  + (SELECT COUNT(*) FROM club_members
                     WHERE fk_member_master_profile_id = @MemberId
                       AND IsActive = 1 AND isdeleted = 0)",
                new { MemberId = memberId });

            if (hasOtherUsableRole == 0)
            {
                return Refuse("SuperAdmin only, with no other role and no club: web portal only.");
            }
        }

        // Kill-switch: same chain check the real sign-in runs. Everyone needs at least one active club→district→zone chain.
        var hasActiveChain = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*)
            FROM club_members cm
            JOIN club_master c ON c.pk_club_id = cm.fk_club_id
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE cm.fk_member_master_profile_id = @MemberId
              AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND c.IsActive = 1 AND c.isdeleted = 0
              AND d.IsActive = 1 AND d.isdeleted = 0
              AND z.IsActive = 1 AND z.isdeleted = 0",
            new { MemberId = memberId });

        if (hasActiveChain == 0)
        {
            return Refuse("No active club in an active district and zone.");
        }

        // Fetch the same club list the mobile app would render on its "pick your club" screen:
        // every active club this member belongs to where the whole chain is healthy.
        var clubs = (await conn.QueryAsync<dynamic>(@"
            SELECT c.pk_club_id   AS clubId,
                   c.ClubName     AS clubName,
                   CAST(NULL AS CHAR) AS clubCode,
                   d.pk_district_id AS districtId,
                   d.DistrictNumber AS districtNumber,
                   z.pk_zone_id     AS zoneId,
                   z.ZoneName       AS zoneName
            FROM club_members cm
            JOIN club_master c   ON c.pk_club_id   = cm.fk_club_id
            JOIN district_master d ON d.pk_district_id = c.fk_district_id
            JOIN zone_master z   ON z.pk_zone_id   = d.fk_zone_id
            WHERE cm.fk_member_master_profile_id = @MemberId
              AND cm.IsActive = 1 AND cm.isdeleted = 0
              AND c.IsActive  = 1 AND c.isdeleted  = 0
              AND d.IsActive  = 1 AND d.isdeleted  = 0
              AND z.IsActive  = 1 AND z.isdeleted  = 0
            ORDER BY c.ClubName",
            new { MemberId = memberId })).ToList();

        return Ok(new
        {
            allowed = true,
            reason = (string?)null,
            email = trimmed,
            member,
            clubs
        });
    }

    private async Task<bool> IsSuperAdminAsync()
    {
        using var conn = RowDb.Connect(_connectionString);
        await conn.OpenAsync();
        var count = await conn.ExecuteScalarAsync<int>(
            @"SELECT COUNT(*) FROM member_roles
              WHERE fk_member_master_profile_id = @MemberId
                AND fk_role_id = 3
                AND IsActive = 1
                AND isdeleted = 0",
            new { MemberId = GetUserId() });
        return count > 0;
    }
}
