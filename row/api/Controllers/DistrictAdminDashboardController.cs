using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/district-admin-dashboard")]
[Authorize]
public class DistrictAdminDashboardController : ControllerBase
{
    private readonly IDistrictAdminDashboardService _service;
    private readonly IDistrictRotaryRefreshJobRunner _refreshJobRunner;
    public DistrictAdminDashboardController(IDistrictAdminDashboardService service, IDistrictRotaryRefreshJobRunner refreshJobRunner)
    {
        _service = service;
        _refreshJobRunner = refreshJobRunner;
    }

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
    private bool IsElect() => (User.FindFirst("roles")?.Value ?? "").Split(',').Contains("Elect");
    private ActionResult NotConfigured() => NotFound(new { message = "No district admin assignment found for this user." });

    // Translate service-level UnauthorizedAccessException into a 403 with message.
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

    // ─── Wave 13A2 sub-endpoints ────────────────────────────────────────

    // Paginated member directory for the Membership page.
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

    // District-wide Rotary Network — Terminated + Potential members across every club.
    [HttpGet("rotary-network")]
    public async Task<ActionResult<DistrictAdminRotaryNetworkResponse>> RotaryNetwork(
        [FromQuery] int? yearId = null,
        [FromQuery] int? districtId = null,
        [FromQuery] string? search = null,
        [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetRotaryNetworkAsync(GetMemberId(), yearId, search, clubId, districtId);
            return r is { } ok ? Ok(ok) : NotConfigured();
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // Live Rotary.org terminated members — fanned out across every linked club in the
    // district (or one club, when clubId is passed). Never persisted; display-only.
    [HttpGet("rotary-network/live-terminated")]
    public async Task<ActionResult<DistrictAdminLiveTerminatedResponse>> RotaryNetworkLiveTerminated(
        [FromQuery] int? districtId = null,
        [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetLiveTerminatedMembersAsync(GetMemberId(), districtId, clubId);
            return Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // Starts (or, if one's already running, just reports) the server-side background job that
    // warms rotary_org_terminated_cache for every linked club in the district. Returns
    // immediately — the actual refresh keeps running even if this admin closes the tab or
    // navigates away; poll rotary-network/refresh-terminated-cache/status from anywhere to
    // watch its progress.
    [HttpPost("rotary-network/refresh-terminated-cache/start")]
    public async Task<ActionResult<DistrictRotaryRefreshJobStatusDto>> StartRotaryNetworkTerminatedCacheRefresh(
        [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        var resolvedDistrictId = await _service.ResolveDistrictIdForMemberAsync(GetMemberId(), districtId);
        if (resolvedDistrictId == 0) return NotConfigured();
        var status = await _refreshJobRunner.StartAsync(resolvedDistrictId, GetMemberId());
        return Ok(status);
    }

    // The latest refresh job for this district (running, or the most recently finished one) —
    // poll this to show progress regardless of which tab/session started it.
    [HttpGet("rotary-network/refresh-terminated-cache/status")]
    public async Task<ActionResult<DistrictRotaryRefreshJobStatusDto>> GetRotaryNetworkTerminatedCacheRefreshStatus(
        [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        var resolvedDistrictId = await _service.ResolveDistrictIdForMemberAsync(GetMemberId(), districtId);
        if (resolvedDistrictId == 0) return NotConfigured();
        var status = await _refreshJobRunner.GetStatusAsync(resolvedDistrictId);
        return status == null ? Ok(new DistrictRotaryRefreshJobStatusDto { DistrictId = resolvedDistrictId, Status = "NeverRun" }) : Ok(status);
    }

    // Per-club CMR 12-month grid drill for the E-Governance > CMR sub-tab.
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

    // ─── Wave 13A3 — DG goal-setting + AG-feeding endpoints ───────────────
    // GET = read goal/status row (null when unset). POST = upsert; requires
    // active District Admin assignment at the requested district (else 403).

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
        // N7: an elect-only member ("Elect") may set the goals of the year being planned; the service checks which
        if (!IsAuthorisedRole() && !IsElect()) return Forbid();
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
        if (!IsAuthorisedRole() && !IsElect()) return Forbid();
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

    // Bulk upsert — body: { districtId, yearId, targets: [{ fkModuleId, targetCount }, ...] }
    [HttpPost("project-targets")]
    public async Task<ActionResult<List<DistrictProjectTargetDto>>> UpsertProjectTargets([FromBody] DistrictProjectTargetsBulkRequest req)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.UpsertProjectTargetsAsync(GetMemberId(), req)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }
}

// ─── Wave 13A3 — Club-scoped DG endpoints (award status + MyRotary tracking).
// Mounted at /api directly (the spec gave bare `/club-award-status` and
// `/club-myrotary` paths). Reused by AG dashboard reads.
[ApiController]
[Route("api")]
[Authorize]
public class DistrictAdminClubGoalsController : ControllerBase
{
    private readonly IDistrictAdminDashboardService _service;
    public DistrictAdminClubGoalsController(IDistrictAdminDashboardService service) => _service = service;

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
