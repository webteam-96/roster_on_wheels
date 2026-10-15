using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/clubs/{clubId}/past-presidents")]
[Authorize]
public class PastPresidentsController : ControllerBase
{
    private readonly IPastPresidentService _pastPresidentService;
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;

    public PastPresidentsController(IPastPresidentService pastPresidentService, IConfiguration configuration, IWebHostEnvironment env)
    {
        _pastPresidentService = pastPresidentService;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet]
    public async Task<ActionResult<List<PastPresidentDto>>> GetByClub(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _pastPresidentService.GetByClubAsync(clubId);
        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<PastPresidentDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _pastPresidentService.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Past president record not found" });
        return Ok(result);
    }

    // Multipart: accepts an optional `photo` file (used only for non-member entries).
    [HttpPost]
    public async Task<ActionResult> Create(int clubId, [FromForm] CreatePastPresidentDto dto, IFormFile? photo)
    {
        var id = await _pastPresidentService.CreateAsync(clubId, dto, photo, GetUserId(), _env);
        return Ok(new { id });
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromForm] UpdatePastPresidentDto dto, IFormFile? photo)
    {
        await _pastPresidentService.UpdateAsync(id, dto, photo, GetUserId(), _env);
        return Ok(new { message = "Past president updated successfully." });
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        await _pastPresidentService.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Past president deleted successfully." });
    }

    [HttpGet("search-members")]
    public async Task<ActionResult<List<ClubMemberSearchDto>>> SearchMembers(int clubId, [FromQuery] string? search)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _pastPresidentService.SearchClubMembersAsync(clubId, search);
        return Ok(result);
    }
}
