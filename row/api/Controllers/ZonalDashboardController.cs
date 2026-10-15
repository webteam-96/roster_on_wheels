using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/zonal-dashboard")]
[Authorize]
public class ZonalDashboardController : ControllerBase
{
    private readonly IBeneficiaryApprovalService _approvalService;
    private readonly string _connectionString;

    public ZonalDashboardController(IBeneficiaryApprovalService approvalService, IConfiguration configuration)
    {
        _approvalService = approvalService;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetMemberId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    private bool IsZonalCoordinator()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("ZonalCoordinator");
    }

    private bool IsSuperAdmin()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("SuperAdmin");
    }

    [HttpGet("zone-info")]
    public async Task<ActionResult> GetZoneInfo()
    {
        if (!IsZonalCoordinator())
            return Forbid();

        var info = await _approvalService.GetZoneForMemberAsync(GetMemberId());
        if (info == null)
            return NotFound(new { message = "No zone assigned." });

        return Ok(info);
    }

    // SuperAdmin: zone info for any zone (used when a SuperAdmin opens a zone's dashboard from Global Search)
    [HttpGet("zone/{zoneId}/info")]
    public async Task<ActionResult> GetZoneInfoById(int zoneId)
    {
        if (!IsSuperAdmin())
            return Forbid();

        var info = await _approvalService.GetZoneInfoByIdAsync(zoneId);
        if (info == null)
            return NotFound(new { message = "Zone not found." });

        return Ok(info);
    }

    // Zonal Coordinator: get approval requests for their zone, optionally filtered by district + rotary year
    [HttpGet("approval-requests")]
    public async Task<ActionResult> GetApprovalRequests(
        [FromQuery] int districtId = 0,
        [FromQuery] int yearId = 0,
        [FromQuery] string? status = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        if (!IsZonalCoordinator())
            return Forbid();

        var zone = await _approvalService.GetZoneForMemberAsync(GetMemberId());
        if (zone == null)
            return NotFound(new { message = "No zone assigned." });

        var (items, totalCount) = await _approvalService.GetApprovalRequestsByZoneAsync(
            zone.ZoneId, districtId, yearId, status, page, pageSize);

        return Ok(new { items, totalCount, page, pageSize });
    }

    // Zonal Coordinator: data-only filter options (years + districts that have approvals) for their zone
    [HttpGet("approval-filters")]
    public async Task<ActionResult> GetApprovalFilters()
    {
        if (!IsZonalCoordinator())
            return Forbid();

        var zone = await _approvalService.GetZoneForMemberAsync(GetMemberId());
        if (zone == null)
            return NotFound(new { message = "No zone assigned." });

        return Ok(await _approvalService.GetZoneApprovalFiltersAsync(zone.ZoneId));
    }

    // SuperAdmin: get approval requests for any zone
    [HttpGet("zone/{zoneId}/approval-requests")]
    public async Task<ActionResult> GetZoneApprovalRequests(
        int zoneId,
        [FromQuery] int districtId = 0,
        [FromQuery] int yearId = 0,
        [FromQuery] string? status = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        if (!IsSuperAdmin())
            return Forbid();

        var (items, totalCount) = await _approvalService.GetApprovalRequestsByZoneAsync(
            zoneId, districtId, yearId, status, page, pageSize);

        return Ok(new { items, totalCount, page, pageSize });
    }

    // SuperAdmin: data-only filter options (years + districts that have approvals) for any zone
    [HttpGet("zone/{zoneId}/approval-filters")]
    public async Task<ActionResult> GetZoneApprovalFilters(int zoneId)
    {
        if (!IsSuperAdmin())
            return Forbid();

        return Ok(await _approvalService.GetZoneApprovalFiltersAsync(zoneId));
    }

    [HttpGet("approval-requests/{token}/detail")]
    public async Task<ActionResult> GetApprovalDetail(string token)
    {
        if (!IsZonalCoordinator() && !IsSuperAdmin())
            return Forbid();

        var detail = await _approvalService.GetByTokenAsync(token);
        if (detail == null)
            return NotFound(new { message = "Approval request not found." });

        if (IsZonalCoordinator() && !IsSuperAdmin())
        {
            var zone = await _approvalService.GetZoneForMemberAsync(GetMemberId());
            if (zone == null || detail.ZoneId != zone.ZoneId)
                return NotFound(new { message = "Approval request not found." });
        }

        return Ok(detail);
    }

    // Full approval history (all attempts) for the project behind an approval id.
    [HttpGet("approval-history/{approvalId}")]
    public async Task<ActionResult> GetApprovalHistory(int approvalId)
    {
        if (!IsZonalCoordinator() && !IsSuperAdmin())
            return Forbid();

        int zoneId;
        if (IsZonalCoordinator() && !IsSuperAdmin())
        {
            var zone = await _approvalService.GetZoneForMemberAsync(GetMemberId());
            if (zone == null) return NotFound(new { message = "No zone assigned." });
            zoneId = zone.ZoneId;
        }
        else
        {
            zoneId = await GetZoneIdFromApproval(approvalId);
            if (zoneId == 0) return NotFound(new { message = "Approval request not found." });
        }

        return Ok(await _approvalService.GetApprovalHistoryAsync(approvalId, zoneId));
    }

    [HttpPost("approve")]
    public async Task<ActionResult> Approve([FromBody] ApprovalActionDto dto)
    {
        if (!IsZonalCoordinator() && !IsSuperAdmin())
            return Forbid();

        int zoneId;
        if (IsZonalCoordinator())
        {
            var zone = await _approvalService.GetZoneForMemberAsync(GetMemberId());
            if (zone == null)
                return NotFound(new { message = "No zone assigned." });
            zoneId = zone.ZoneId;
        }
        else
        {
            zoneId = await GetZoneIdFromApproval(dto.ApprovalId);
            if (zoneId == 0)
                return NotFound(new { message = "Approval request not found." });
        }

        var (status, result) = await _approvalService.ZonalApproveAsync(
            dto.ApprovalId, zoneId, GetMemberId(), dto.Remark, dto.ApprovedBeneficiaries);

        if (result == "error")
            return NotFound(new { message = "Approval request not found." });
        if (result == "already_processed")
            return BadRequest(new { message = $"Request has already been {status}." });

        return Ok(new { message = "Approved successfully. Beneficiaries updated." });
    }

    [HttpPost("reject")]
    public async Task<ActionResult> Reject([FromBody] ApprovalActionDto dto)
    {
        if (!IsZonalCoordinator() && !IsSuperAdmin())
            return Forbid();

        if (string.IsNullOrWhiteSpace(dto.Remark))
            return BadRequest(new { message = "Remark is required when rejecting." });

        int zoneId;
        if (IsZonalCoordinator())
        {
            var zone = await _approvalService.GetZoneForMemberAsync(GetMemberId());
            if (zone == null)
                return NotFound(new { message = "No zone assigned." });
            zoneId = zone.ZoneId;
        }
        else
        {
            zoneId = await GetZoneIdFromApproval(dto.ApprovalId);
            if (zoneId == 0)
                return NotFound(new { message = "Approval request not found." });
        }

        var (status, result) = await _approvalService.ZonalRejectAsync(
            dto.ApprovalId, zoneId, GetMemberId(), dto.Remark);

        if (result == "error")
            return NotFound(new { message = "Approval request not found." });
        if (result == "already_processed")
            return BadRequest(new { message = $"Request has already been {status}." });

        return Ok(new { message = "Rejected successfully." });
    }

    [HttpGet("districts")]
    public async Task<ActionResult> GetDistricts()
    {
        if (!IsZonalCoordinator())
            return Forbid();

        var zone = await _approvalService.GetZoneForMemberAsync(GetMemberId());
        if (zone == null)
            return NotFound(new { message = "No zone assigned." });

        var districts = await _approvalService.GetZoneDistrictsAsync(zone.ZoneId);
        return Ok(districts);
    }

    // SuperAdmin: get districts for any zone
    [HttpGet("zone/{zoneId}/districts")]
    public async Task<ActionResult> GetZoneDistricts(int zoneId)
    {
        if (!IsSuperAdmin())
            return Forbid();

        var districts = await _approvalService.GetZoneDistrictsAsync(zoneId);
        return Ok(districts);
    }

    [HttpGet("districts/{districtId}/clubs")]
    public async Task<ActionResult> GetClubs(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        if (!IsZonalCoordinator() && !IsSuperAdmin())
            return Forbid();

        if (IsZonalCoordinator() && !IsSuperAdmin())
        {
            var zone = await _approvalService.GetZoneForMemberAsync(GetMemberId());
            if (zone == null)
                return NotFound(new { message = "No zone assigned." });

            var districts = await _approvalService.GetZoneDistrictsAsync(zone.ZoneId);
            if (!districts.Any(d => d.Id == districtId))
                return Forbid();
        }

        var clubs = await _approvalService.GetDistrictClubsAsync(districtId);
        return Ok(clubs);
    }

    private async Task<int> GetZoneIdFromApproval(int approvalId)
    {
        using var connection = new MySqlConnector.MySqlConnection(
            HttpContext.RequestServices.GetRequiredService<IConfiguration>()
                .GetConnectionString("DefaultConnection"));
        await connection.OpenAsync();
        return await Dapper.SqlMapper.ExecuteScalarAsync<int>(connection,
            "SELECT fk_zone_id FROM beneficiary_approval_requests WHERE pk_approval_id = @Id",
            new { Id = approvalId });
    }
}
