using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Prospect follow-up tasks and new-prospect notification settings (gap agent, 2026-11-19; feature contacts_growth,
/// gated in FeatureGate). Club routes: the club's managers only, reads included (ScopeWriteGuardMiddleware would let
/// members read). App routes: the member's own assigned tasks.
/// </summary>
[ApiController]
[Authorize]
public class ProspectFollowUpController : ControllerBase
{
    private const string Club = "api/clubs/{clubId:int}";
    private readonly ProspectFollowUpService _service;
    private readonly AdminYearGuard _guard;
    private readonly string _cs;

    public ProspectFollowUpController(ProspectFollowUpService service, AdminYearGuard guard, IConfiguration config)
    {
        _service = service;
        _guard = guard;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> ManagesAsync(int clubId) =>
        MemberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_cs, MemberId, true, clubId);

    private ObjectResult NotClubAdmin() => StatusCode(403, new { message = "Only the club's administrators can do this." });

    [HttpGet(Club + "/prospect-tasks")]
    public async Task<IActionResult> List(int clubId, [FromQuery] string? status, [FromQuery] int? prospectId) =>
        await ManagesAsync(clubId) ? Ok(await _service.ListAsync(clubId, status, prospectId)) : NotClubAdmin();

    [HttpPost(Club + "/prospect-tasks")]
    public async Task<IActionResult> Create(int clubId, [FromBody] SaveProspectTaskDto dto)
    {
        if (await _guard.ClubYearlessAsync(User, clubId) is { } denied) return denied;
        try { return Ok(new { id = await _service.CreateAsync(clubId, dto, MemberId) }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut(Club + "/prospect-tasks/{id:int}")]
    public async Task<IActionResult> Update(int clubId, int id, [FromBody] SaveProspectTaskDto dto)
    {
        if (await _guard.ClubYearlessAsync(User, clubId) is { } denied) return denied;
        try
        {
            return await _service.UpdateAsync(clubId, id, dto, MemberId)
                ? Ok(new { message = "Task saved." }) : NotFound(new { message = "Task not found." });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete(Club + "/prospect-tasks/{id:int}")]
    public async Task<IActionResult> Delete(int clubId, int id)
    {
        if (await _guard.ClubYearlessAsync(User, clubId) is { } denied) return denied;
        return await _service.DeleteAsync(clubId, id) ? NoContent() : NotFound(new { message = "Task not found." });
    }

    [HttpGet(Club + "/prospect-notify-settings")]
    public async Task<IActionResult> GetSettings(int clubId) =>
        await ManagesAsync(clubId) ? Ok(await _service.GetSettingsAsync(clubId)) : NotClubAdmin();

    [HttpPut(Club + "/prospect-notify-settings")]
    public async Task<IActionResult> SaveSettings(int clubId, [FromBody] ProspectNotifySettingsDto dto)
    {
        if (await _guard.ClubYearlessAsync(User, clubId) is { } denied) return denied;
        try
        {
            await _service.SaveSettingsAsync(clubId, dto, MemberId);
            return Ok(await _service.GetSettingsAsync(clubId));
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // ── The app: tasks assigned to the signed-in member ──

    [HttpGet("api/mobile/prospect-tasks")]
    public async Task<IActionResult> Mine([FromQuery] string? status) => Ok(await _service.ForMemberAsync(MemberId, status));

    [HttpPost("api/mobile/prospect-tasks/{id:int}/complete")]
    public async Task<IActionResult> Complete(int id, [FromBody] CompleteProspectTaskDto? dto)
    {
        try
        {
            return await _service.CompleteAsync(MemberId, id, dto?.Note)
                ? Ok(new { message = "Task done." }) : NotFound(new { message = "No open task of yours with this id." });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }
}
