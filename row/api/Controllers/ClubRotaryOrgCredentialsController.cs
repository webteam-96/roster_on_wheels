using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class ClubRotaryOrgCredentialsController : ControllerBase
{
    private readonly IClubRotaryOrgCredentialService _service;

    private readonly AdminYearGuard _guard;
    public ClubRotaryOrgCredentialsController(AdminYearGuard guard, IClubRotaryOrgCredentialService service)
    {
        _guard = guard;
        _service = service;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/rotary-org-credentials")]
    public async Task<ActionResult<ClubRotaryOrgCredentialDto>> Get(int clubId)
    {
        try
        {
            var result = await _service.GetAsync(clubId, GetUserId());
            return Ok(result);
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { message = ex.Message });
        }
    }

    [HttpPut("api/clubs/{clubId}/rotary-org-credentials")]
    public async Task<ActionResult> Upsert(int clubId, [FromBody] UpsertClubRotaryOrgCredentialDto dto)
    {
        var denied = await _guard.ClubYearlessAsync(User, clubId);
        if (denied != null) return denied;

        if (string.IsNullOrWhiteSpace(dto.Username) || string.IsNullOrWhiteSpace(dto.Password))
            return BadRequest(new { message = "Username and password are both required." });

        try
        {
            await _service.UpsertAsync(clubId, dto, GetUserId());
            return Ok(new { message = "Rotary.org credentials saved." });
        }
        catch (UnauthorizedAccessException ex)
        {
            return StatusCode(403, new { message = ex.Message });
        }
    }
}
