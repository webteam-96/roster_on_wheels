using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>Club email bulletins (gap #6). Managers compose, preview and send; members of the club read the archive
/// of sent bulletins (web and app). Writes are also guarded by ScopeWriteGuardMiddleware.</summary>
[ApiController]
[Route("api/clubs/{clubId}/bulletins")]
[Authorize]
public class ClubBulletinsController : ControllerBase
{
    private readonly BulletinService _service;
    private readonly AdminYearGuard _guard;
    private readonly string _cs;

    public ClubBulletinsController(BulletinService service, AdminYearGuard guard, IConfiguration config)
    {
        _service = service;
        _guard = guard;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private int UserId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;
    private ObjectResult Forbidden() => StatusCode(403, new { message = "Only the club's members can read its bulletins." });

    /// <summary>true = manages the club (sees drafts), false = member (sent only), null = no access.</summary>
    private async Task<bool?> AccessAsync(int clubId)
    {
        if (UserId <= 0 || !await KillSwitchHelper.IsClubDrillReachableAsync(_cs, clubId)) return null;
        if (await ScopeWriteGuardMiddleware.AllowedAsync(_cs, UserId, true, clubId)) return true;
        return await ScopeWriteGuardMiddleware.ReadAllowedAsync(_cs, UserId, true, clubId) ? false : null;
    }

    [HttpGet]
    public async Task<ActionResult> List(int clubId)
    {
        var manager = await AccessAsync(clubId);
        if (manager == null) return Forbidden();
        return Ok(await _service.ListAsync(clubId, sentOnly: manager == false));
    }

    [HttpGet("options")]
    public async Task<ActionResult> Options(int clubId)
    {
        if (await AccessAsync(clubId) != true) return Forbidden();
        return Ok(await _service.OptionsAsync(clubId));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult> Get(int clubId, int id)
    {
        var manager = await AccessAsync(clubId);
        if (manager == null) return Forbidden();
        var b = await _service.GetAsync(clubId, id, sentOnly: manager == false);
        return b == null ? NotFound(new { message = "Bulletin not found." }) : Ok(b);
    }

    [HttpPost("preview")]
    public async Task<ActionResult> Preview(int clubId, [FromBody] BulletinDto dto)
    {
        if (await AccessAsync(clubId) != true) return Forbidden();
        if (BulletinService.Validate(dto) is { } error) return BadRequest(new { message = error });
        return Ok(new { html = await _service.PreviewAsync(clubId, dto) });
    }

    [HttpPost]
    public async Task<ActionResult> Create(int clubId, [FromBody] BulletinDto dto)
    {
        if (await _guard.ClubYearlessAsync(User, clubId) is { } denied) return denied;
        if (BulletinService.Validate(dto) is { } error) return BadRequest(new { message = error });
        return Ok(new { id = await _service.CreateAsync(clubId, dto, UserId) });
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] BulletinDto dto)
    {
        if (await _guard.ClubYearlessAsync(User, clubId) is { } denied) return denied;
        if (BulletinService.Validate(dto) is { } error) return BadRequest(new { message = error });
        return await _service.UpdateAsync(clubId, id, dto, UserId) ? Ok(new { id }) : NotFound(new { message = "Draft not found." });
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        if (await _guard.ClubYearlessAsync(User, clubId) is { } denied) return denied;
        return await _service.DeleteAsync(clubId, id, UserId) ? Ok(new { id }) : NotFound(new { message = "Draft not found." });
    }

    [HttpPost("{id:int}/send")]
    public async Task<ActionResult> Send(int clubId, int id, [FromBody] BulletinSendDto dto)
    {
        if (await _guard.ClubYearlessAsync(User, clubId) is { } denied) return denied;
        try
        {
            var r = await _service.SendAsync(clubId, id, dto, UserId);
            var message = "The bulletin is being sent to members"
                + (r.Subscribers > 0 ? $" and {r.Subscribers} subscribers." : ".") + (r.SubscriberNote is { } n ? " " + n : "");
            return Ok(new { massEmailId = r.MassEmailId, subscribers = r.Subscribers, message });
        }
        catch (KeyNotFoundException) { return NotFound(new { message = "Bulletin not found." }); }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
