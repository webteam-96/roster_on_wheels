using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Year-end rollover (Services/YearRolloverService.cs). scope is "club" or "district". Preview and apply need
/// admin rights on BOTH years (the year rolled from and the year after it), read from the database on every call
/// through AdminYearService; undo needs the same rights on the run's years.
/// </summary>
[ApiController]
[Authorize]
[Route("api/rollover")]
public class YearRolloverController : ControllerBase
{
    private readonly YearRolloverService _svc;

    public YearRolloverController(YearRolloverService svc) => _svc = svc;

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private static ObjectResult Denied() =>
        new(new { message = "You need admin rights for both Rotary years to run the rollover." }) { StatusCode = StatusCodes.Status403Forbidden };

    private static bool ValidScope(string scope) => scope is YearRolloverService.Club or YearRolloverService.District;

    /// <summary>Resolves the years and checks access; returns an error result or the years.</summary>
    private async Task<(IActionResult? Error, YearRolloverService.Year From, YearRolloverService.Year To)> GateAsync(string scope, int scopeId, int? fromYearId)
    {
        if (!ValidScope(scope) || scopeId <= 0) return (BadRequest(new { message = "Unknown club or district." }), null!, null!);
        if (!await _svc.ScopeExistsAsync(scope, scopeId)) return (NotFound(new { message = "Club or district not found." }), null!, null!);
        try
        {
            var (from, to) = await _svc.YearsAsync(fromYearId is > 0 ? fromYearId : null);
            if (!await _svc.CanRunAsync(MemberId, scope, scopeId, from.Id, to.Id)) return (Denied(), from, to);
            return (null, from, to);
        }
        catch (KeyNotFoundException e) { return (NotFound(new { message = e.Message }), null!, null!); }
        catch (InvalidOperationException e) { return (Conflict(new { message = e.Message }), null!, null!); }
    }

    /// <summary>Every change the rollover would make, plus earlier runs. Changes nothing.</summary>
    [HttpGet("{scope}/{scopeId:int}")]
    public async Task<IActionResult> Preview(string scope, int scopeId, [FromQuery] int? fromYearId)
    {
        var (error, from, to) = await GateAsync(scope, scopeId, fromYearId);
        return error ?? Ok(await _svc.PreviewAsync(scope, scopeId, from, to));
    }

    [HttpPost("{scope}/{scopeId:int}/apply")]
    public async Task<IActionResult> Apply(string scope, int scopeId, [FromBody] RolloverApplyRequest req)
    {
        if (req == null || req.FromYearId <= 0) return BadRequest(new { message = "Choose the year to roll over from." });
        if ((req.OfficerIds?.Count ?? 0) > 500 || (req.Committees?.Count ?? 0) > 500 ||
            (req.Committees ?? []).Any(c => (c.MemberKeys?.Count ?? 0) > 2000))
            return BadRequest(new { message = "Too many items in one rollover." });
        var (error, from, to) = await GateAsync(scope, scopeId, req.FromYearId);
        if (error != null) return error;
        try { return Ok(await _svc.ApplyAsync(scope, scopeId, from, to, req, MemberId, HttpContext)); }
        catch (InvalidOperationException e) { return Conflict(new { message = e.Message }); }
    }

    [HttpPost("runs/{runId:int}/undo")]
    public async Task<IActionResult> Undo(int runId)
    {
        var run = await _svc.RunAsync(runId);
        if (run == null) return NotFound(new { message = "Rollover not found." });
        if (!await _svc.CanRunAsync(MemberId, run.Scope, run.ScopeId, run.FromYearId, run.ToYearId)) return Denied();
        try { return Ok(await _svc.UndoAsync(run, MemberId, HttpContext)); }
        catch (RolloverUndoBlockedException e) { return Conflict(new { message = e.Message, blockers = e.Blockers }); }
        catch (InvalidOperationException e) { return Conflict(new { message = e.Message }); }
    }
}
