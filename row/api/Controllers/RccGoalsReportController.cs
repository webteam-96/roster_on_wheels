using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// "RCC & District Goals" combined report (user 2026-11-16, step 5): RCC + District Goals in one .xlsx,
// for one district or one club. Same access as the New Goal Setting's Rotary.org figures
// ROW: Super Admin, the club's managers or whoever manages its district (ScopeWriteGuardMiddleware).
[ApiController]
[Route("api/rcc-goals/report")]
[Authorize]
public class RccGoalsReportController : ControllerBase
{
    private readonly IGoalSettingService _goals;
    private readonly string _cs;
    public RccGoalsReportController(IGoalSettingService goals, IConfiguration config)
    {
        _goals = goals;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    [HttpGet("district/{districtId:int}")]
    public async Task<ActionResult> District(int districtId, [FromQuery] int? yearId)
    {
        if (!await ScopeWriteGuardMiddleware.AllowedAsync(_cs, MemberId(), false, districtId)) return Forbid();
        var bytes = await new RccCombinedReport(_goals, _cs).BuildAsync(MemberId(), districtId, null, yearId);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "RCC_District_Goals.xlsx");
    }

    [HttpGet("club/{clubId:int}")]
    public async Task<ActionResult> Club(int clubId, [FromQuery] int? yearId)
    {
        if (!await ScopeWriteGuardMiddleware.ReadAllowedAsync(_cs, MemberId(), true, clubId, members: false)) return Forbid();
        var bytes = await new RccCombinedReport(_goals, _cs).BuildAsync(MemberId(), null, clubId, yearId);
        return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "RCC_Club_Goals.xlsx");
    }
}
