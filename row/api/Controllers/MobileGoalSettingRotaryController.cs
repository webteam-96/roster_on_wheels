using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Mobile twins of the NEW Goal Setting (Rotary.org) endpoints (user 2026-11-09: new Goal Setting live on
// web AND mobile). Same actions, same access rules, same JSON - only the route prefix differs:
//   api/mobile/goal-setting-rotary/...       = api/goal-setting-rotary/...      (Rotary.org figures, source
//                                              dates, RAG, years, lock all clubs, reports)
//   api/mobile/goal-setting-rotary/sync/...  = api/goal-setting-rotary/sync/... (DG "Sync from Rotary.org")
// The goal forms / saves / locks themselves stay on api/mobile/goal-setting/... (shared service, so the
// year-wise admin rights and goal-role scope are enforced there for mobile exactly as for web).
// Login required ([Authorize] inherited); read access = Super Admin, the district / club admin, or a goal
// role for its own districts (CanViewRotaryScopeAsync).
[ApiController]
[Route("api/mobile/goal-setting-rotary")]
[Authorize]
public class MobileGoalSettingRotaryController : GoalSettingRotaryController
{
    public MobileGoalSettingRotaryController(IConfiguration configuration, IGoalSettingService goals)
        : base(configuration, goals) { }
}

[ApiController]
[Route("api/mobile/goal-setting-rotary/sync")]
[Authorize]
public class MobileGoalRotarySyncController : GoalRotarySyncController
{
    public MobileGoalRotarySyncController(IConfiguration config, ILogger<GoalRotarySyncController> logger)
        : base(config, logger) { }
}
