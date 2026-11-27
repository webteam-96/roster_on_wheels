using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class AdminController : ControllerBase
{
    private readonly IRoleService _roleService;

    private readonly IAdminYearService _adminYears;

    /// <summary>Opens a connection, runs the work, closes it. Keeps the
    /// year-rights calls from repeating five lines of plumbing each time.</summary>
    private async Task<T> WithConnectionAsync<T>(Func<MySqlConnector.MySqlConnection, Task<T>> work)
    {
        var cs = HttpContext.RequestServices.GetRequiredService<IConfiguration>()
            .GetConnectionString("DefaultConnection");
        await using var conn = new MySqlConnector.MySqlConnection(cs);
        await conn.OpenAsync();
        return await work(conn);
    }

    /// <summary>
    /// What the "Make Admin" popup should offer for this club: the years the
    /// CALLER may hand on, and the years the TARGET already holds (so the popup
    /// can pre-tick them). Role-based years are flagged so the UI can lock them —
    /// they come from the board and cannot be given or taken here.
    /// </summary>
    [HttpGet("club-admin-years")]
    public async Task<ActionResult<object>> GetClubAdminYears([FromQuery] int clubId, [FromQuery] int memberId)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin or Admin can view admin years." });
        if (!await CanManageClubAdminsAsync(clubId))
            return StatusCode(403, new { message = "You can only manage admins for your own club." });

        return await WithConnectionAsync<ActionResult<object>>(async conn =>
        {
            var grantable = await _adminYears.GetGrantableClubYearsAsync(conn, GetCurrentMemberId(), clubId);
            var held = memberId > 0
                ? await _adminYears.GetClubRightsAsync(conn, memberId, clubId)
                : new AdminYearRights();

            var years = (await Dapper.SqlMapper.QueryAsync<dynamic>(conn, @"
                SELECT pk_year_id AS id, YearLabel AS label, IsCurrent AS isCurrent
                FROM rotary_year_master WHERE COALESCE(isdeleted,0) = 0
                ORDER BY StartDate DESC")).ToList();

            return Ok(new
            {
                // Everything, so the popup can show the full list greyed where needed.
                years,
                grantableYearIds = grantable.AllYears ? null : grantable.YearIds.ToList(),
                canGrantAllYears = grantable.AllYears,
                heldYearIds = held.YearIds.ToList(),
                heldAllYears = held.AllYears,
                // "Club President", "Club Executive Secretary" … — show these locked.
                heldSources = held.Sources,
            });
        });
    }

    /// <summary>Feeds the year picker for a DISTRICT admin. Same shape as
    /// club-admin-years so the popup can render either without branching.</summary>
    [HttpGet("district-admin-years")]
    public async Task<ActionResult<object>> GetDistrictAdminYears([FromQuery] int districtId, [FromQuery] int memberId)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin or Admin can view admin years." });
        if (!await CanManageDistrictAdminsAsync(districtId))
            return StatusCode(403, new { message = "You can only manage admins for your own district." });

        return await WithConnectionAsync<ActionResult<object>>(async conn =>
        {
            var grantable = await _adminYears.GetGrantableDistrictYearsAsync(conn, GetCurrentMemberId(), districtId);
            var held = memberId > 0
                ? await _adminYears.GetDistrictRightsAsync(conn, memberId, districtId)
                : new AdminYearRights();

            var years = (await Dapper.SqlMapper.QueryAsync<dynamic>(conn, @"
                SELECT pk_year_id AS id, YearLabel AS label, IsCurrent AS isCurrent
                FROM rotary_year_master WHERE COALESCE(isdeleted,0) = 0
                ORDER BY StartDate DESC")).ToList();

            return Ok(new
            {
                years,
                grantableYearIds = grantable.AllYears ? null : grantable.YearIds.ToList(),
                canGrantAllYears = grantable.AllYears,
                heldYearIds = held.YearIds.ToList(),
                heldAllYears = held.AllYears,
                heldSources = held.Sources,
            });
        });
    }

    public AdminController(IRoleService roleService, IAdminYearService adminYears)
    {
        _roleService = roleService;
        _adminYears = adminYears;
    }

    /// <summary>
    /// May the caller grant/revoke the Admin role IN THIS CLUB?
    ///
    /// ⚠️ This check did not exist. `IsSuperAdminOrAdmin()` only asks whether the
    /// caller holds an Admin role SOMEWHERE — so a Club Admin of club A could
    /// send clubId = B and mint an admin there. Both UI screens always send the
    /// caller's own club, which is why nothing misused it, but the club boundary
    /// lived entirely in the front-end. It belongs here.
    ///
    /// Rules: SuperAdmin may act anywhere. Otherwise the caller must hold an
    /// ACTIVE Club Admin row for that exact club, OR be a District Admin of the
    /// club's district WITH all-clubs access (the same reach that flag already
    /// grants elsewhere).
    /// </summary>
    /// <summary>
    /// District twin of <see cref="CanManageClubAdminsAsync"/>: a SuperAdmin
    /// anywhere, or an active District Admin of THAT district.
    /// </summary>
    private async Task<bool> CanManageDistrictAdminsAsync(int districtId)
    {
        if (IsSuperAdmin()) return true;
        if (districtId <= 0) return false;

        var callerId = GetCurrentMemberId();
        if (callerId <= 0) return false;

        return await WithConnectionAsync(async conn =>
            await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @Caller AND fk_role_id = 2
                  AND fk_district_id = @DistrictId AND COALESCE(fk_club_id,0) = 0
                  AND IsActive = 1 AND COALESCE(isdeleted,0) = 0",
                new { Caller = callerId, DistrictId = districtId }) > 0);
    }

    private async Task<bool> CanManageClubAdminsAsync(int clubId)
    {
        if (IsSuperAdmin()) return true;
        if (clubId <= 0) return false;

        var connectionString = HttpContext.RequestServices
            .GetRequiredService<IConfiguration>()
            .GetConnectionString("DefaultConnection");
        using var conn = new MySqlConnector.MySqlConnection(connectionString);
        await conn.OpenAsync();

        var callerId = GetCurrentMemberId();
        if (callerId <= 0) return false;

        var isClubAdmin = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @Caller AND fk_role_id = 2
              AND fk_club_id = @ClubId
              AND IsActive = 1 AND COALESCE(isdeleted,0) = 0",
            new { Caller = callerId, ClubId = clubId });
        if (isClubAdmin > 0) return true;

        // District Admin of this club's district, WITH all-clubs access.
        var viaDistrict = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN club_master c ON c.pk_club_id = @ClubId
            WHERE mr.fk_member_master_profile_id = @Caller AND mr.fk_role_id = 2
              AND mr.fk_district_id = c.fk_district_id
              AND COALESCE(mr.fk_club_id,0) = 0
              AND COALESCE(mr.AllClubsAccess,0) = 1
              AND mr.IsActive = 1 AND COALESCE(mr.isdeleted,0) = 0",
            new { Caller = callerId, ClubId = clubId });
        return viaDistrict > 0;
    }

    /// <summary>Is the target actually a member of that club? Stops a club admin
    /// granting rights over their own club to someone unconnected to it.</summary>
    private async Task<bool> IsMemberOfClubAsync(int memberId, int clubId)
    {
        var connectionString = HttpContext.RequestServices
            .GetRequiredService<IConfiguration>()
            .GetConnectionString("DefaultConnection");
        using var conn = new MySqlConnector.MySqlConnection(connectionString);
        await conn.OpenAsync();
        return await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM club_members
            WHERE fk_member_master_profile_id = @MemberId AND fk_club_id = @ClubId
              AND IsActive = 1 AND COALESCE(isdeleted,0) = 0",
            new { MemberId = memberId, ClubId = clubId }) > 0;
    }

    [HttpPost("assign-role")]
    public async Task<ActionResult<object>> AssignRole([FromBody] AssignRoleRequestDto request)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin or Admin can assign roles." });

        // Scope check — see CanManageClubAdminsAsync. Without this, holding an
        // Admin role anywhere let you grant one anywhere.
        var clubId = request.ClubId ?? 0;
        if (!await CanManageClubAdminsAsync(clubId))
            return StatusCode(403, new { message = "You can only manage admins for your own club." });

        if (!IsSuperAdmin() && !await IsMemberOfClubAsync(request.MemberId, clubId))
            return StatusCode(403, new { message = "That person is not a member of this club." });

        // Which years may the CALLER hand on? Everything below is clamped to this,
        // so a single-year admin cannot mint a wider one than they hold.
        var grantable = await WithConnectionAsync(conn =>
            _adminYears.GetGrantableClubYearsAsync(conn, GetCurrentMemberId(), clubId));

        var wantsAllYears = request.AllYears == true;
        if (wantsAllYears && !grantable.AllYears)
            return StatusCode(403, new { message = "Only a Super Admin can grant All Years." });

        // No years supplied (an older client) ⇒ the CURRENT year only.
        var requestedYears = request.YearIds?.Where(y => y > 0).Distinct().ToList() ?? new List<int>();
        if (!wantsAllYears && requestedYears.Count == 0)
        {
            var current = await WithConnectionAsync(AdminYearService.GetCurrentYearIdAsync);
            if (current is not int cy)
                return StatusCode(500, new { message = "No current Rotary year is configured." });
            requestedYears.Add(cy);
        }

        // Every requested year must be one the caller actually holds.
        if (!wantsAllYears && !grantable.AllYears)
        {
            var outside = requestedYears.Where(y => !grantable.Covers(y)).ToList();
            if (outside.Count > 0)
                return StatusCode(403, new { message = "You can only grant years you hold yourself." });
        }

        try
        {
            var result = await _roleService.AssignAdminRoleAsync(request, GetCurrentMemberId());

            await WithConnectionAsync(async conn =>
            {
                await _adminYears.SetManualGrantsAsync(
                    conn, request.MemberId, clubId, null,
                    requestedYears, wantsAllYears, GetCurrentMemberId());
                return true;
            });

            return Ok(new
            {
                result,
                years = wantsAllYears ? null : requestedYears,
                allYears = wantsAllYears,
            });
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (ClubAdminLimitException ex)
        {
            return Conflict(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to assign admin role: {ex.Message}" });
        }
    }

    /// <summary>
    /// "Edit Years" — change which Rotary years an EXISTING club admin holds,
    /// without Remove Admin + Make Admin. Clamped exactly like Make Admin: only
    /// years the caller holds can be added or taken away; the rest are kept.
    /// Marker: YWAR-EDIT-YEARS
    /// </summary>
    [HttpPost("club-admin-years")]
    public async Task<ActionResult<object>> EditClubAdminYears([FromBody] AssignRoleRequestDto request)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin or Admin can change admin years." });
        var clubId = request.ClubId ?? 0;
        if (!await CanManageClubAdminsAsync(clubId))
            return StatusCode(403, new { message = "You can only manage admins for your own club." });

        return await WithConnectionAsync<ActionResult<object>>(async conn =>
        {
            var isAdmin = await conn.ExecuteScalarAsync<int>(@"
                SELECT COUNT(*) FROM member_roles
                WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_club_id = @ClubId
                  AND IsActive = 1 AND COALESCE(isdeleted,0) = 0",
                new { request.MemberId, ClubId = clubId }) > 0;
            if (!isAdmin)
                return BadRequest(new { message = "This member is not an admin of this club. Use Make Admin first." });

            var result = await _adminYears.EditManualGrantsAsync(
                conn, request.MemberId, clubId, null, GetCurrentMemberId(),
                request.YearIds ?? new List<int>(), request.AllYears == true);
            if (result.Refusal != null)
                return StatusCode(result.RefusalStatus, new { message = result.Refusal });

            return Ok(new { message = "Admin years updated.", keptYears = result.KeptYears });
        });
    }

    [HttpPost("remove-role")]
    public async Task<ActionResult<object>> RemoveRole([FromBody] RemoveRoleRequestDto request)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin or Admin can remove roles." });

        // Removing is scoped exactly like granting.
        if (!await CanManageClubAdminsAsync(request.ClubId ?? 0))
            return StatusCode(403, new { message = "You can only manage admins for your own club." });

        // ⚠️ A SITTING President / Secretary / Executive Secretary cannot be
        // un-admined here. Their year is granted by the BOARD, read live, so
        // switching the role off would not remove their rights — it would only
        // remove their way IN, leaving a president who holds the year and cannot
        // open the dashboard. That exact state happened on a real account and
        // had to be repaired by hand. Change the board record instead.
        var sittingOffice = await WithConnectionAsync(conn =>
            _adminYears.SittingOfficeAsync(conn, request.MemberId, request.ClubId, null));
        if (sittingOffice != null)
            return BadRequest(new
            {
                message = $"This member is the {sittingOffice} for the current Rotary year, "
                        + "which is what makes them a Club Admin. Change the Board of Directors "
                        + "record to remove their access."
            });

        // ⚠️ Removing is scoped to the years the REMOVER holds — the mirror of
        // granting. A 2025-26 admin takes back 2025-26 and nothing else; a year
        // they could never have given is not theirs to destroy.
        var removal = await WithConnectionAsync(conn =>
            _adminYears.RemoveYearsYouHoldAsync(
                conn, request.MemberId, request.ClubId, null,
                GetCurrentMemberId(), GetCurrentMemberId()));

        if (removal.Refused)
            return BadRequest(new { message = removal.Refusal });

        // ⚠️ The Admin ROLE only comes off when nothing of theirs is left. Taking
        // it while they still hold another year would leave them with rights and
        // no way to reach them.
        if (removal.StillHasRights)
            return Ok(new
            {
                message = $"Removed {string.Join(", ", removal.RemovedYears)}. "
                        + "This member is still an admin for the other Rotary years they hold.",
                removedYears = removal.RemovedYears,
                stillAdmin = true,
            });

        try
        {
            var result = await _roleService.RemoveAdminRoleAsync(request, GetCurrentMemberId());
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to remove admin role: {ex.Message}" });
        }
    }

    [HttpGet("members-with-roles")]
    public async Task<ActionResult<PagedResult<MemberWithRolesDto>>> GetMembersWithRoles(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        [FromQuery] string? search = null)
    {
        // Every member's email and mobile across all clubs: a club or district Admin holds no such scope.
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can view member roles." });

        try
        {
            var result = await _roleService.GetAllMembersWithRolesAsync(page, pageSize, search);
            return Ok(result);
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return StatusCode(500, new { message = $"Failed to fetch member roles: {ex.Message}" });
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Audit Log viewer (SuperAdmin only)
    // ══════════════════════════════════════════════════════════════════════
    [HttpGet("audit-log")]
    public async Task<ActionResult> GetAuditLog(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? search = null,
        [FromQuery] string? action = null,
        [FromQuery] string? entityType = null,
        [FromQuery] DateTime? fromDate = null,
        [FromQuery] DateTime? toDate = null)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can view audit logs." });

        var connectionString = HttpContext.RequestServices
            .GetRequiredService<IConfiguration>()
            .GetConnectionString("DefaultConnection");
        using var conn = new MySqlConnector.MySqlConnection(connectionString);
        await conn.OpenAsync();

        var where = new List<string> { "1=1" };
        var p = new DynamicParameters();
        if (!string.IsNullOrWhiteSpace(search))
        {
            where.Add("(a.member_name LIKE @Search OR a.entity_name LIKE @Search OR a.details LIKE @Search OR a.ip_address LIKE @Search)");
            p.Add("Search", $"%{search}%");
        }
        if (!string.IsNullOrWhiteSpace(action))
        {
            where.Add("a.action = @Action");
            p.Add("Action", action);
        }
        if (!string.IsNullOrWhiteSpace(entityType))
        {
            where.Add("a.entity_type = @EntityType");
            p.Add("EntityType", entityType);
        }
        if (fromDate.HasValue)
        {
            where.Add("a.created_date >= @FromDate");
            p.Add("FromDate", fromDate.Value);
        }
        if (toDate.HasValue)
        {
            where.Add("a.created_date <= @ToDate");
            p.Add("ToDate", toDate.Value.AddDays(1));
        }

        var whereSql = string.Join(" AND ", where);
        var offset = Math.Max(0, (page - 1) * pageSize);
        p.Add("Limit", pageSize);
        p.Add("Offset", offset);

        var totalCount = await conn.ExecuteScalarAsync<int>(
            $"SELECT COUNT(*) FROM audit_log a WHERE {whereSql}", p);

        // Get distinct entity types for filter dropdown
        var entityTypes = await conn.QueryAsync<string>(
            "SELECT DISTINCT entity_type FROM audit_log ORDER BY entity_type");

        // Club / District are derived from the API path already stored in `details`
        // (e.g. /api/clubs/2765/... or /api/districts/5/...), so this works for every historical row
        // too — no schema change. A club action also resolves that club's own district.
        const string joinSql = @"
            LEFT JOIN club_master c ON c.pk_club_id =
                CASE WHEN a.details LIKE '%/clubs/%'
                     THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(a.details, '/clubs/', -1), '/', 1) AS UNSIGNED) END
            LEFT JOIN district_master dmp ON dmp.pk_district_id =
                CASE WHEN a.details LIKE '%/districts/%'
                     THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(a.details, '/districts/', -1), '/', 1) AS UNSIGNED) END
            LEFT JOIN district_master dmc ON dmc.pk_district_id = c.fk_district_id";

        var items = await conn.QueryAsync<dynamic>(
            $@"SELECT a.pk_audit_id AS id, a.fk_member_master_profile_id AS memberId, a.member_name AS memberName,
                      a.role_name AS roleName, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
                      a.entity_name AS entityName, a.details, a.ip_address AS ipAddress, a.user_agent AS userAgent,
                      a.created_date AS createdDate,
                      c.ClubName AS clubName,
                      COALESCE(dmp.DistrictNumber, dmc.DistrictNumber) AS districtNumber
               FROM audit_log a
               {joinSql}
               WHERE {whereSql}
               ORDER BY a.created_date DESC
               LIMIT @Limit OFFSET @Offset", p);

        return Ok(new { items, totalCount, page, pageSize, entityTypes });
    }

    private bool IsSuperAdmin()
    {
        return User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    }

    private bool IsSuperAdminOrAdmin()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("SuperAdmin") || roles.Contains("Admin");
    }

    private int GetCurrentMemberId()
    {
        return int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    }
}
