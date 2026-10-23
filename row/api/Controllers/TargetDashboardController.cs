using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Live target dashboard (feature target_dashboard, spec B.3 #30). Read only. ScopeWriteGuardMiddleware first limits
/// reads to the club's or district's members and managers; the service then narrows to managers: the district sees
/// every club, an Assistant Governor their clubs for the year, a club admin their own club.
/// </summary>
[ApiController]
[Authorize]
public class TargetDashboardController : ControllerBase
{
    private readonly TargetDashboardService _targets;

    public TargetDashboardController(TargetDashboardService targets) => _targets = targets;

    private int UserId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    [HttpGet("api/districts/{districtId:int}/targets")]
    public Task<ActionResult<TargetDashboardDto>> District(int districtId, [FromQuery] int? yearId)
        => Run(() => _targets.GetDistrictAsync(districtId, UserId, yearId));

    [HttpGet("api/clubs/{clubId:int}/targets")]
    public Task<ActionResult<TargetDashboardDto>> Club(int clubId, [FromQuery] int? yearId)
        => Run(() => _targets.GetClubAsync(clubId, UserId, yearId));

    private async Task<ActionResult<TargetDashboardDto>> Run(Func<Task<TargetDashboardDto?>> load)
    {
        try
        {
            return await load() is { } dto ? Ok(dto) : NotFound(new { message = "Club or Rotary year not found." });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = ex.Message });
        }
    }
}
