using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/mobile/district-admin-dashboard")]
[Authorize]
public class MobileDistrictAdminDashboardController : ControllerBase
{
    private readonly IDistrictAdminDashboardService _service;
    public MobileDistrictAdminDashboardController(IDistrictAdminDashboardService service) => _service = service;

    private int GetMemberId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }
    private bool IsAuthorisedRole()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("Admin") || roles.Contains("SuperAdmin");
    }
    private ActionResult NotConfigured() => NotFound(new { message = "No district admin assignment found." });

    private ObjectResult ForbidWithMessage(string message)
        => StatusCode(StatusCodes.Status403Forbidden, new { message });

    [HttpGet("overview")]
    public async Task<ActionResult<DistrictAdminOverviewResponse>> Overview([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetOverviewAsync(GetMemberId(), yearId, districtId); return r is { } ok ? Ok(ok) : NotConfigured(); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("membership")]
    public async Task<ActionResult<DistrictAdminMembershipResponse>> Membership([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetMembershipAsync(GetMemberId(), yearId, districtId); return r is { } ok ? Ok(ok) : NotConfigured(); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("foundation")]
    public async Task<ActionResult<DistrictAdminFoundationResponse>> Foundation([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetFoundationAsync(GetMemberId(), yearId, districtId); return r is { } ok ? Ok(ok) : NotConfigured(); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("communication")]
    public async Task<ActionResult<DistrictAdminCommunicationResponse>> Communication([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetCommunicationAsync(GetMemberId(), yearId, districtId); return r is { } ok ? Ok(ok) : NotConfigured(); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("egovernance")]
    public async Task<ActionResult<DistrictAdminEGovernanceResponse>> EGovernance([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetEGovernanceAsync(GetMemberId(), yearId, districtId); return r is { } ok ? Ok(ok) : NotConfigured(); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ─── Wave 13A2 sub-endpoints (mobile mirror) ────────────────────────

    [HttpGet("members")]
    public async Task<ActionResult<DistrictAdminDirectoryPagedResponse>> Members(
        [FromQuery] int? yearId = null,
        [FromQuery] int? districtId = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetMembershipDirectoryAsync(GetMemberId(), yearId, page, pageSize, search, districtId);
            return r is { } ok ? Ok(ok) : NotConfigured();
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("egovernance/per-club")]
    public async Task<ActionResult<DistrictAdminCmrPerClubGridResponse>> EGovernancePerClub(
        [FromQuery] int? yearId = null,
        [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetEGovernancePerClubGridAsync(GetMemberId(), yearId, districtId);
            return r is { } ok ? Ok(ok) : NotConfigured();
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ─── Wave 13A3 — DG goal-setting + AG-feeding endpoints (mobile mirror) ────

    [HttpGet("membership-goal")]
    public async Task<ActionResult<DistrictMembershipGoalDto?>> GetMembershipGoal([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetMembershipGoalAsync(GetMemberId(), yearId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("membership-goal")]
    public async Task<ActionResult<DistrictMembershipGoalDto>> UpsertMembershipGoal([FromBody] DistrictMembershipGoalDto dto)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.UpsertMembershipGoalAsync(GetMemberId(), dto)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("foundation-goal")]
    public async Task<ActionResult<DistrictFoundationGoalDto?>> GetFoundationGoal([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetFoundationGoalAsync(GetMemberId(), yearId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("foundation-goal")]
    public async Task<ActionResult<DistrictFoundationGoalDto>> UpsertFoundationGoal([FromBody] DistrictFoundationGoalDto dto)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.UpsertFoundationGoalAsync(GetMemberId(), dto)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("project-targets")]
    public async Task<ActionResult<List<DistrictProjectTargetDto>>> GetProjectTargets([FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetProjectTargetsAsync(GetMemberId(), yearId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("project-targets")]
    public async Task<ActionResult<List<DistrictProjectTargetDto>>> UpsertProjectTargets([FromBody] DistrictProjectTargetsBulkRequest req)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.UpsertProjectTargetsAsync(GetMemberId(), req)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }
}

// Mobile mirror of the bare /api/club-award-status + /api/club-myrotary routes.
[ApiController]
[Route("api/mobile")]
[Authorize]
public class MobileDistrictAdminClubGoalsController : ControllerBase
{
    private readonly IDistrictAdminDashboardService _service;
    public MobileDistrictAdminClubGoalsController(IDistrictAdminDashboardService service) => _service = service;

    private int GetMemberId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }
    private bool IsAuthorisedRole()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("Admin") || roles.Contains("SuperAdmin") || roles.Contains("AG");
    }
    private ObjectResult ForbidWithMessage(string message)
        => StatusCode(StatusCodes.Status403Forbidden, new { message });

    [HttpGet("club-award-status")]
    public async Task<ActionResult<ClubAwardStatusDto?>> GetClubAwardStatus([FromQuery] int clubId, [FromQuery] int? yearId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetClubAwardStatusAsync(GetMemberId(), clubId, yearId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("club-award-status")]
    public async Task<ActionResult<ClubAwardStatusDto>> UpsertClubAwardStatus([FromBody] ClubAwardStatusDto dto)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.UpsertClubAwardStatusAsync(GetMemberId(), dto)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("club-myrotary")]
    public async Task<ActionResult<ClubMyRotaryTrackingDto?>> GetClubMyRotary([FromQuery] int clubId, [FromQuery] int? yearId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetClubMyRotaryAsync(GetMemberId(), clubId, yearId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost("club-myrotary")]
    public async Task<ActionResult<ClubMyRotaryTrackingDto>> UpsertClubMyRotary([FromBody] ClubMyRotaryTrackingDto dto)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.UpsertClubMyRotaryAsync(GetMemberId(), dto)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }
}
