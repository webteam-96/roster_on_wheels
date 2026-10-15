using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class ClubThemeController : ControllerBase
{
    private readonly IClubThemeService _clubThemeService;
    private readonly string _connectionString;

    public ClubThemeController(IClubThemeService clubThemeService, IConfiguration configuration)
    {
        _clubThemeService = clubThemeService;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/website-data/theme")]
    public async Task<ActionResult<ClubThemeDto>> GetClubTheme(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _clubThemeService.GetByClubYearAsync(clubId, yearId);
        if (result == null) return Ok(new { });
        return Ok(result);
    }

    [HttpPut("api/clubs/{clubId}/website-data/theme")]
    public async Task<ActionResult> SaveClubTheme(int clubId, [FromBody] SaveClubThemeDto dto)
    {
        await _clubThemeService.SaveAsync(clubId, dto, GetUserId());
        return Ok(new { message = "Theme saved successfully." });
    }
}
