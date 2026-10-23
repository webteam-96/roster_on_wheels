using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/mobile/club-admin-dashboard")]
[Authorize]
public class MobileClubAdminDashboardController : ControllerBase
{
    private readonly IClubAdminDashboardService _service;
    public MobileClubAdminDashboardController(IClubAdminDashboardService service) => _service = service;

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

    private ActionResult NotConfigured() => NotFound(new { message = "No club admin assignment found." });

    // Translate service-level UnauthorizedAccessException into a 403 with message.
    private ObjectResult ForbidWithMessage(string message)
        => StatusCode(StatusCodes.Status403Forbidden, new { message });

    // Mirror of the web /club-admin-dashboard/available-years endpoint —
    // powers a global year selector inside the mobile app's dashboard scope.
    [HttpGet("available-years")]
    public async Task<ActionResult<ClubAdminAvailableYearsResponse>> AvailableYears([FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetAvailableYearsAsync(GetMemberId(), clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("overview")]
    public async Task<ActionResult<ClubAdminOverviewResponse>> Overview([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetOverviewAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("foundation")]
    public async Task<ActionResult<ClubAdminFoundationResponse>> Foundation([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetFoundationAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("membership")]
    public async Task<ActionResult<ClubAdminMembershipResponse>> Membership([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetMembershipAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("avenue")]
    public async Task<ActionResult<ClubAdminAvenueResponse>> Avenue([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetAvenueAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("egovernance")]
    public async Task<ActionResult<ClubAdminEGovernanceResponse>> EGovernance([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetEGovernanceAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("communication")]
    public async Task<ActionResult<ClubAdminCommunicationResponse>> Communication([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetCommunicationAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("website")]
    public async Task<ActionResult<ClubAdminWebsiteResponse>> Website([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetWebsiteAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("payments")]
    public async Task<ActionResult<ClubAdminPaymentsResponse>> Payments([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetPaymentsAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Dashboard sub-tabs (Phase B) ────────────────────────────────────

    [HttpGet("dashboard-directory")]
    public async Task<ActionResult<ClubAdminDashboardDirectoryResponse>> DashboardDirectory([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetDashboardDirectoryAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("dashboard-bod")]
    public async Task<ActionResult<ClubAdminDashboardBodResponse>> DashboardBod([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetDashboardBodAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("dashboard-rotary-network")]
    public async Task<ActionResult<ClubAdminDashboardRotaryNetworkResponse>> DashboardRotaryNetwork([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetDashboardRotaryNetworkAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // ── Service Projects & Public Image (Phase C) ────────────────────────

    [HttpGet("service-projects-overview")]
    public async Task<ActionResult<ServiceProjectsOverviewResponse>> ServiceProjectsOverview([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetServiceProjectsOverviewAsync(GetMemberId(), yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("service-projects-avenue")]
    public async Task<ActionResult<ServiceProjectsAvenueDetailResponse>> ServiceProjectsAvenue([FromQuery] string avenueKey, [FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { var r = await _service.GetServiceProjectsAvenueDetailAsync(GetMemberId(), avenueKey ?? "", yearId, clubId); return r == null ? NotConfigured() : Ok(r); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }
}
