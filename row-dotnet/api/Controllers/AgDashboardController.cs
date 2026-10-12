using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

// Web routes for the new AG dashboard. Mobile twin lives in MobileAgDashboardController
// and delegates to the same IAgDashboardService — guaranteeing API parity per the
// "mobile API parity" rule.
[ApiController]
[Route("api/ag-dashboard")]
[Authorize]
public class AgDashboardController : ControllerBase
{
    private readonly IAgDashboardService _service;
    private readonly ILogger<AgDashboardController> _logger;

    public AgDashboardController(IAgDashboardService service, ILogger<AgDashboardController> logger)
    {
        _service = service;
        _logger = logger;
    }

    private int GetMemberId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    private bool IsAuthorisedRole()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("AG") || roles.Contains("SuperAdmin");
    }

    // Translate service-level UnauthorizedAccessException into a 403 with message.
    private ObjectResult ForbidWithMessage(string message)
        => StatusCode(StatusCodes.Status403Forbidden, new { message });

    // Years for the global topbar picker — scoped to the AG's own clubs, not the district's.
    [HttpGet("available-years")]
    public async Task<ActionResult<AgAvailableYearsResponse>> AvailableYears([FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetAvailableYearsAsync(GetMemberId(), districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("clubs")]
    public async Task<ActionResult<AgClubsResponse>> Clubs([FromQuery] int? yearId = null, [FromQuery] int? clubId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetClubsAsync(GetMemberId(), yearId, clubId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("clubs/{clubId:int}")]
    public async Task<ActionResult<AgClubDetailResponse>> ClubDetail(int clubId, [FromQuery] int? yearId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        var result = await _service.GetClubDetailAsync(GetMemberId(), clubId, yearId);
        if (result == null) return NotFound(new { message = "Club not in your AG group for this year." });
        return Ok(result);
    }

    [HttpGet("membership")]
    public async Task<ActionResult<AgMembershipResponse>> Membership([FromQuery] int? yearId = null, [FromQuery] int? clubId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetMembershipAsync(GetMemberId(), yearId, clubId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("trf")]
    public async Task<ActionResult<AgTrfResponse>> Trf([FromQuery] int? yearId = null, [FromQuery] int? clubId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetTrfAsync(GetMemberId(), yearId, clubId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("excellence")]
    public async Task<ActionResult<AgExcellenceResponse>> Excellence([FromQuery] int? yearId = null, [FromQuery] int? clubId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetExcellenceAsync(GetMemberId(), yearId, clubId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("youth")]
    public async Task<ActionResult<AgYouthResponse>> Youth([FromQuery] int? yearId = null, [FromQuery] int? clubId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetYouthAsync(GetMemberId(), yearId, clubId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    // Full detail + photos for one project (row-click popup). yearId picks the year table.
    [HttpGet("projects/{projectId:int}")]
    public async Task<ActionResult<AgProjectDetailDto>> ProjectDetail(int projectId, [FromQuery] int? yearId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetProjectDetailAsync(GetMemberId(), projectId, yearId, districtId);
            return r == null ? NotFound(new { message = "Project not found in your AG group for this year." }) : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("projects")]
    public async Task<ActionResult<AgProjectsResponse>> Projects([FromQuery] int? yearId = null, [FromQuery] int? clubId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetProjectsAsync(GetMemberId(), yearId, clubId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpGet("district")]
    public async Task<ActionResult<AgDistrictResponse>> District([FromQuery] int? yearId = null, [FromQuery] int? clubId = null, [FromQuery] int? districtId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try { return Ok(await _service.GetDistrictAsync(GetMemberId(), yearId, clubId, districtId)); }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }
}
