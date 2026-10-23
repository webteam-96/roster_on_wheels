using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Membership growth (club and district) and guest invite prompts (feature contacts_growth, spec B.4 #33-34).
/// Writes need a manager of the club (ScopeWriteGuardMiddleware); reads are open to the club's or district's
/// members, like the other dashboard figures.
/// </summary>
[ApiController]
[Authorize]
public class GrowthController : ControllerBase
{
    private readonly GrowthService _growth;
    private readonly InvitePromptService _prompts;
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<GrowthController> _logger;

    public GrowthController(GrowthService growth, InvitePromptService prompts, IServiceScopeFactory scopes, ILogger<GrowthController> logger)
    {
        _growth = growth;
        _prompts = prompts;
        _scopes = scopes;
        _logger = logger;
    }

    private int UserId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    [HttpGet("api/clubs/{clubId:int}/growth")]
    public async Task<ActionResult<ClubGrowthDto>> Club(int clubId, [FromQuery] int? yearId)
        => await _growth.GetClubAsync(clubId, yearId) is { } g ? Ok(g) : NotFound(new { message = "Rotary year not found." });

    [HttpPut("api/clubs/{clubId:int}/growth/target")]
    public async Task<ActionResult> SetTarget(int clubId, [FromBody] SetGrowthTargetDto dto)
    {
        try { await _growth.SetTargetAsync(clubId, dto, UserId); return Ok(new { message = "Target saved." }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("api/districts/{districtId:int}/growth")]
    public async Task<ActionResult<DistrictGrowthDto>> District(int districtId, [FromQuery] int? yearId)
        => await _growth.GetDistrictAsync(districtId, yearId) is { } g ? Ok(g) : NotFound(new { message = "Rotary year not found." });

    [HttpGet("api/clubs/{clubId:int}/invite-prompts")]
    public async Task<ActionResult<List<InvitePromptDto>>> Prompts(int clubId) => Ok(await _prompts.ListAsync(clubId));

    [HttpPost("api/clubs/{clubId:int}/invite-prompts")]
    public async Task<ActionResult> CreatePrompt(int clubId, [FromBody] CreateInvitePromptDto dto)
    {
        try { return Ok(new { id = await _prompts.CreateAsync(clubId, dto, UserId) }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>Sends a scheduled prompt now instead of on its date; delivery runs in the background.</summary>
    [HttpPost("api/clubs/{clubId:int}/invite-prompts/{id:int}/send")]
    public async Task<ActionResult> SendNow(int clubId, int id)
    {
        if (!await _prompts.ClaimAsync(clubId, id)) return Conflict(new { message = "This prompt was already sent or cancelled." });
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = _scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<InvitePromptService>().DeliverAsync(id);
            }
            catch (Exception ex) { _logger.LogError(ex, "Invite prompt {PromptId} failed to send.", id); }
        });
        return Ok(new { message = "The prompt is being sent to the club's members." });
    }

    [HttpDelete("api/clubs/{clubId:int}/invite-prompts/{id:int}")]
    public async Task<ActionResult> CancelPrompt(int clubId, int id)
        => await _prompts.CancelAsync(clubId, id) ? Ok(new { message = "Prompt cancelled." }) : NotFound(new { message = "No scheduled prompt found." });

    /// <summary>The signed-in member's personal guest invite link for this club (the app shares it).</summary>
    [HttpGet("api/clubs/{clubId:int}/invite-link")]
    public async Task<ActionResult> InviteLink(int clubId)
    {
        if (UserId <= 0 || !await _prompts.IsActiveMemberAsync(clubId, UserId))
            return StatusCode(403, new { message = "Only members of this club have an invite link." });
        return Ok(new { url = await _prompts.LinkAsync(clubId, UserId) });
    }
}
