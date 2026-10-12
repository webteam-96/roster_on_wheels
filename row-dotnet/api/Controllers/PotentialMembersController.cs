using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
[Route("api/clubs/{clubId}/potential-members")]
public class PotentialMembersController : ControllerBase
{
    private readonly IPotentialMemberService _service;
    private readonly string _connectionString;

    public PotentialMembersController(IPotentialMemberService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet]
    public async Task<ActionResult<PagedResult<PotentialMemberDto>>> GetByClub(
        int clubId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByClubAsync(clubId, page, pageSize, search);
        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<PotentialMemberDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Potential member not found." });
        return Ok(result);
    }

    [HttpPost]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreatePotentialMemberDto dto)
    {
        var id = await _service.CreateAsync(clubId, dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdatePotentialMemberDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Potential member updated successfully." });
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Potential member deleted successfully." });
    }
}
