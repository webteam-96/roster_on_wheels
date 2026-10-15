using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class GreetingsController : ControllerBase
{
    private readonly IGreetingService _greetingService;
    private readonly string _connectionString;

    public GreetingsController(IGreetingService greetingService, IConfiguration configuration)
    {
        _greetingService = greetingService;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/greetings")]
    public async Task<ActionResult<GreetingSettingsDto>> GetSettings(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _greetingService.GetSettingsAsync(clubId);
        if (result == null) return Ok(new { });
        return Ok(result);
    }

    [HttpPut("api/clubs/{clubId}/greetings")]
    public async Task<ActionResult> UpdateSettings(int clubId, [FromBody] UpdateGreetingSettingsDto dto)
    {
        await _greetingService.UpdateSettingsAsync(clubId, dto, GetUserId());
        return Ok(new { message = "Greeting settings updated successfully." });
    }
}
