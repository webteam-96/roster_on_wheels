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

    public AdminController(IRoleService roleService)
    {
        _roleService = roleService;
    }

    [HttpPost("assign-role")]
    public async Task<ActionResult<object>> AssignRole([FromBody] AssignRoleRequestDto request)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin or Admin can assign roles." });

        try
        {
            var result = await _roleService.AssignAdminRoleAsync(request, GetCurrentMemberId());
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to assign admin role: {ex.Message}" });
        }
    }

    [HttpPost("remove-role")]
    public async Task<ActionResult<object>> RemoveRole([FromBody] RemoveRoleRequestDto request)
    {
        if (!IsSuperAdminOrAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin or Admin can remove roles." });

        try
        {
            var result = await _roleService.RemoveAdminRoleAsync(request, GetCurrentMemberId());
            return Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
        catch (Exception ex)
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
        catch (Exception ex)
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
