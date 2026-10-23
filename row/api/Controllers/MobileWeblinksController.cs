using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// ════════════════════════════════════════════════════════════════════════
// Mobile VIEW-ONLY weblinks.
// Weblinks are managed (add/edit/delete) on the web side only; the mobile app
// merely displays them as a "Weblinks" section below the module list:
//   • District weblinks → mobile district dashboard (below district modules)
//   • Club weblinks     → mobile club dashboard (below club modules)
// Only active weblinks (IsActive = 1) are returned — the tree query filters IsActive = 1.
// ════════════════════════════════════════════════════════════════════════
[ApiController]
[Route("api/mobile")]
[Authorize]
public class MobileWeblinksController : ControllerBase
{
    private readonly IWeblinkService _weblinkService;
    private readonly string _connectionString;

    public MobileWeblinksController(IWeblinkService weblinkService, IConfiguration configuration)
    {
        _weblinkService = weblinkService;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    // ── District weblinks → mobile district dashboard (below modules) ───
    [HttpGet("districts/{districtId}/weblinks")]
    public async Task<ActionResult<List<WeblinkTreeDto>>> GetDistrictWeblinks(int districtId)
    {
        if (!await KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId))
            return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var tree = await _weblinkService.GetWeblinkTreeAsync(0, districtId);
        return Ok(tree);
    }

    // ── Club weblinks → mobile club dashboard (below modules) ───────────
    [HttpGet("clubs/{clubId}/weblinks")]
    public async Task<ActionResult<List<WeblinkTreeDto>>> GetClubWeblinks(int clubId)
    {
        if (!await KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId))
            return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var tree = await _weblinkService.GetWeblinkTreeAsync(clubId);
        return Ok(tree);
    }
}
