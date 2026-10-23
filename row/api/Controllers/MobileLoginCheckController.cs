using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

// SuperAdmin diagnostic — simulates the first half of the mobile-login flow without
// sending an OTP or touching the mobile_login_otp table. Given a mobile number, it
// returns the same member + club-list payload the mobile app would render on its
// "pick your club" screen, plus an Allowed/Not-allowed verdict (with the reason) so
// SA can debug "why can't member X log in on the mobile app". No DB writes, no SMS,
// no email.
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
    public async Task<ActionResult> Check([FromQuery] string mobile, [FromQuery] int? countryId)
    {
        if (!await IsSuperAdminAsync())
            return StatusCode(403, new { message = "SuperAdmin access required." });

        if (string.IsNullOrWhiteSpace(mobile))
            return BadRequest(new { message = "Mobile number is required." });

        var trimmed = mobile.Trim();

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();

        // Look up member by mobile. CountryId is optional — if omitted we match on mobile
        // alone (any country) since the SA tool is a diagnostic, not a login.
        dynamic? member = null;
        if (countryId.HasValue)
        {
            member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT pk_member_master_profile_id AS id, MemberName, EmailId,
                       PrimaryMobileNumber, fk_primary_country_id AS countryId
                FROM member_master_profile
                WHERE PrimaryMobileNumber = @Mobile
                  AND fk_primary_country_id = @CId
                  AND isdeleted = 0
                ORDER BY pk_member_master_profile_id ASC LIMIT 1",
                new { Mobile = trimmed, CId = countryId.Value });
        }
        else
        {
            member = await conn.QueryFirstOrDefaultAsync<dynamic>(@"
                SELECT pk_member_master_profile_id AS id, MemberName, EmailId,
                       PrimaryMobileNumber, fk_primary_country_id AS countryId
                FROM member_master_profile
                WHERE PrimaryMobileNumber = @Mobile
                  AND isdeleted = 0
                ORDER BY pk_member_master_profile_id ASC LIMIT 1",
                new { Mobile = trimmed });
        }

        if (member == null)
        {
            return Ok(new
            {
                allowed = false,
                reason = "No active rotarian found with this mobile number.",
                mobile = trimmed,
                member = (object?)null,
                clubs = new object[0]
            });
        }

        int memberId = (int)member.id;
        string memberName = (string?)member.MemberName ?? "";
        string? memberEmail = (string?)member.EmailId;

        // SuperAdmin-on-mobile policy: SA cannot mobile-login UNLESS they ALSO hold
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
                return Ok(new
                {
                    allowed = false,
                    reason = "SuperAdmin-only member cannot login on mobile (no other role, no club membership). Web portal only.",
                    mobile = trimmed,
                    member = new
                    {
                        id = memberId,
                        name = memberName,
                        email = memberEmail
                    },
                    clubs = new object[0]
                });
            }
        }

        // Kill-switch: same chain check the real mobile-login flow runs. Everyone needs at least one active club→district→zone chain.
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
            return Ok(new
            {
                allowed = false,
                reason = "No active club→district→zone chain. Member has no usable club membership for mobile login.",
                mobile = trimmed,
                member = new
                {
                    id = memberId,
                    name = memberName,
                    email = memberEmail
                },
                clubs = new object[0]
            });
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
            mobile = trimmed,
            member = new
            {
                id = memberId,
                name = memberName,
                email = memberEmail
            },
            clubs
        });
    }

    private async Task<bool> IsSuperAdminAsync()
    {
        using var conn = new MySqlConnection(_connectionString);
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
