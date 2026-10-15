using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/club-foundation-goals")]
[Authorize]
public class ClubFoundationGoalsController : ControllerBase
{
    private readonly IFoundationGoalsService _service;
    public ClubFoundationGoalsController(IFoundationGoalsService service) => _service = service;

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

    private ObjectResult ForbidWithMessage(string message)
        => StatusCode(StatusCodes.Status403Forbidden, new { message });

    [HttpGet("list")]
    public async Task<ActionResult<FoundationGoalListResponse>> List([FromQuery] int? yearId = null, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.GetListAsync(GetMemberId(), yearId, clubId);
            return r == null ? NotFound(new { message = "No club admin assignment found." }) : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
    }

    [HttpPost]
    public async Task<ActionResult<FoundationGoalDto>> Save([FromBody] FoundationGoalSaveRequest request, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var r = await _service.SaveAsync(GetMemberId(), request, clubId);
            return r == null
                ? NotFound(new { message = "No club admin assignment found." })
                : Ok(r);
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("{yearId:int}")]
    public async Task<IActionResult> Delete([FromRoute] int yearId, [FromQuery] int? clubId = null)
    {
        if (!IsAuthorisedRole()) return Forbid();
        try
        {
            var ok = await _service.DeleteAsync(GetMemberId(), yearId, clubId);
            return ok ? NoContent() : NotFound(new { message = "No goal to delete." });
        }
        catch (UnauthorizedAccessException ex) { return ForbidWithMessage(ex.Message); }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
