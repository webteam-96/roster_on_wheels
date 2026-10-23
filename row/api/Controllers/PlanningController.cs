using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Planning mode, elect access and cut-over (ROW build spec 3.1, Services/PlanningService.cs). Off until a SuperAdmin
/// switches on "planning_mode" (FeatureGate answers 404). A district's planning is seen by SuperAdmin, its elect
/// district roles (DGE, DS, DT) and its district admins; it is run (appoint, invite, revoke, cut-over) only by its
/// governor-elect or a SuperAdmin; a SuperAdmin starts it. Roles are read from the database on every call.
/// </summary>
[ApiController]
[Authorize]
[Route("api/planning")]
public class PlanningController : ControllerBase
{
    private readonly PlanningService _planning;

    public PlanningController(PlanningService planning) => _planning = planning;

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private static ObjectResult Denied(string message) => new(new { message }) { StatusCode = StatusCodes.Status403Forbidden };

    /// <summary>Maps the service's refusals: not found 404, refused 403, invalid 400, wrong state 409.</summary>
    private async Task<IActionResult> Run(Func<Task<object?>> action)
    {
        try { return Ok(await action()); }
        catch (KeyNotFoundException e) { return NotFound(new { message = e.Message }); }
        catch (UnauthorizedAccessException e) { return Denied(e.Message); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
        catch (InvalidOperationException e) { return Conflict(new { message = e.Message }); }
    }

    /// <summary>A district's planning state for the banner (any signed-in user, like GET tenants/{id}/state).</summary>
    [HttpGet("state")]
    public async Task<IActionResult> State([FromQuery] int? districtId, [FromQuery] int? clubId)
    {
        if (districtId is not > 0 && clubId is not > 0) return BadRequest(new { message = "districtId or clubId is required." });
        var s = await _planning.StateAsync(districtId, clubId);
        return s == null ? NotFound(new { message = "Club not found." }) : Ok(s);
    }

    /// <summary>The signed-in member's invited and active elect roles (admin /planning page, the app).</summary>
    [HttpGet("me")]
    public async Task<IActionResult> Me() => Ok(await _planning.MyRolesAsync(MemberId));

    [HttpGet("districts/{districtId:int}")]
    public async Task<IActionResult> Overview(int districtId)
    {
        var a = await _planning.AccessAsync(MemberId, districtId);
        if (!a.CanView) return Denied("You do not take part in this district's planning.");
        return Ok(await _planning.OverviewAsync(districtId, a.SuperAdmin || a.Dge));
    }

    /// <summary>Starts planning, or while planning replaces the governor-elect.</summary>
    [HttpPost("districts/{districtId:int}/start")]
    public async Task<IActionResult> Start(int districtId, [FromBody] StartPlanningDto dto)
    {
        if (!(await _planning.AccessAsync(MemberId, districtId)).SuperAdmin) return Denied("Only a SuperAdmin can start planning.");
        if (dto.DgeMemberId is <= 0) return BadRequest(new { message = "Choose the governor-elect." });
        return await Run(async () => await _planning.StartAsync(districtId, dto.DgeMemberId, MemberId, HttpContext));
    }

    [HttpPost("districts/{districtId:int}/appointments")]
    public async Task<IActionResult> Appoint(int districtId, [FromBody] PlanningAppointDto dto)
    {
        if (!await RunsAsync(districtId)) return Denied("Only the governor-elect or a SuperAdmin can appoint the team.");
        if (dto.MemberId <= 0) return BadRequest(new { message = "Choose a member." });
        return await Run(async () => await _planning.AppointAsync(districtId, dto.Role, dto.MemberId, MemberId, HttpContext));
    }

    [HttpPost("districts/{districtId:int}/invites")]
    public async Task<IActionResult> Invite(int districtId, [FromBody] PlanningInviteDto dto)
    {
        if (!await RunsAsync(districtId)) return Denied("Only the governor-elect or a SuperAdmin can invite clubs.");
        if (dto.MemberId <= 0 || dto.ClubId <= 0) return BadRequest(new { message = "Choose a club and a member." });
        return await Run(async () => await _planning.InviteAsync(districtId, dto.ClubId, dto.Role, dto.MemberId, MemberId, HttpContext));
    }

    [HttpDelete("districts/{districtId:int}/roles/{roleId:int}")]
    public async Task<IActionResult> Revoke(int districtId, int roleId)
    {
        var a = await _planning.AccessAsync(MemberId, districtId);
        if (!a.SuperAdmin && !a.Dge) return Denied("Only the governor-elect or a SuperAdmin can revoke a role.");
        return await Run(async () =>
        {
            await _planning.RevokeAsync(districtId, roleId, MemberId, a.SuperAdmin, HttpContext);
            return new { message = "Role revoked." };
        });
    }

    [HttpPost("districts/{districtId:int}/cutover")]
    public async Task<IActionResult> CutOver(int districtId)
    {
        if (!await RunsAsync(districtId)) return Denied("Only the governor-elect or a SuperAdmin can run the cut-over.");
        return await Run(async () => await _planning.CutOverAsync(districtId, MemberId, HttpContext));
    }

    /// <summary>The accept link from the invitation email. No sign-in: the token is single use and the role is
    /// the invited member's.</summary>
    [AllowAnonymous]
    [EnableRateLimiting("unsubscribe")] // the token-link policy (30 a minute per IP); the token is 256 bits
    [HttpPost("invites/accept")]
    public Task<IActionResult> Accept([FromBody] PlanningAcceptDto dto) =>
        Run(async () => await _planning.AcceptAsync(dto.Token, HttpContext));

    private async Task<bool> RunsAsync(int districtId)
    {
        var a = await _planning.AccessAsync(MemberId, districtId);
        return a.SuperAdmin || a.Dge;
    }
}
