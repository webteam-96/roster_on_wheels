using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Officer progression (Services/OfficerProgressionService.cs). A club names its President-Nominee (a district its
/// DG-Nominee) and the chain PN, PE, P, IPP is suggested for the following years. Nothing is written to the board or
/// the governors list until an admin confirms that step, and a step never replaces someone already in the office.
/// Members of the club / district may view; naming and dismissing need current-year admin rights; confirming needs
/// admin rights for the year the step writes (the same year rule as the Board of Directors screen).
/// </summary>
[ApiController]
[Authorize]
[Route("api/officer-progression")]
public class OfficerProgressionController : ControllerBase
{
    private readonly IOfficerProgressionService _service;
    private readonly AdminYearGuard _guard;
    private readonly IAdminYearService _years;
    private readonly string _cs;

    public OfficerProgressionController(IOfficerProgressionService service, AdminYearGuard guard, IAdminYearService years, IConfiguration config)
    {
        _service = service;
        _guard = guard;
        _years = years;
        _cs = config.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    public sealed class CreateRequest
    {
        public string Scope { get; set; } = "";
        public int ScopeId { get; set; }
        public int MemberId { get; set; }
        public int NomineeStartYear { get; set; }
    }

    private async Task<IActionResult> Run(Func<Task<object?>> action)
    {
        try { return Ok(await action()); }
        catch (KeyNotFoundException e) { return NotFound(new { message = e.Message }); }
        catch (ArgumentException e) { return BadRequest(new { message = e.Message }); }
        catch (InvalidOperationException e) { return Conflict(new { message = e.Message }); }
    }

    private Task<ObjectResult?> AdminNowAsync(string scope, int scopeId) =>
        scope == OfficerProgressionChain.Club ? _guard.ClubYearlessAsync(User, scopeId) : _guard.DistrictYearlessAsync(User, scopeId);

    /// <summary>Viewers: members of the club / district, and anyone with admin standing there (incl. SuperAdmin).</summary>
    private async Task<bool> CanViewAsync(string scope, int scopeId)
    {
        await using var conn = new MySqlConnection(_cs);
        await conn.OpenAsync();
        if (await OfficerProgressionService.IsInScopeAsync(conn, scope, scopeId, MemberId)) return true;
        var rights = scope == OfficerProgressionChain.Club
            ? await _years.GetClubRightsAsync(conn, MemberId, scopeId)
            : await _years.GetDistrictRightsAsync(conn, MemberId, scopeId);
        return rights.Any;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string scope, [FromQuery] int scopeId)
    {
        if (!OfficerProgressionChain.IsScope(scope) || scopeId <= 0) return BadRequest(new { message = "scope (club or district) and scopeId are required." });
        if (!await CanViewAsync(scope, scopeId)) return StatusCode(403, new { message = "You are not a member of this club or district." });
        return Ok(await _service.ListAsync(scope, scopeId));
    }

    /// <summary>SuperAdmin: every pending step of a Rotary year (what the year-end rollover surfaces).</summary>
    [HttpGet("pending")]
    public async Task<IActionResult> Pending([FromQuery] int yearId)
    {
        await using (var conn = new MySqlConnection(_cs))
        {
            await conn.OpenAsync();
            if (!await ClubAdminAccessHelper.IsSuperAdminAsync(conn, MemberId)) return StatusCode(403, new { message = "SuperAdmin only." });
        }
        return Ok(await _service.GetPendingForYearAsync(yearId));
    }

    [HttpGet("candidates")]
    public async Task<IActionResult> Candidates([FromQuery] string scope, [FromQuery] int scopeId, [FromQuery] string? search)
    {
        if (!OfficerProgressionChain.IsScope(scope) || scopeId <= 0) return BadRequest(new { message = "scope (club or district) and scopeId are required." });
        if (await AdminNowAsync(scope, scopeId) is { } denied) return denied;
        return Ok(await _service.CandidatesAsync(scope, scopeId, search));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateRequest req)
    {
        if (!OfficerProgressionChain.IsScope(req.Scope) || req.ScopeId <= 0) return BadRequest(new { message = "scope (club or district) and scopeId are required." });
        if (await AdminNowAsync(req.Scope, req.ScopeId) is { } denied) return denied;
        return await Run(async () => new { id = await _service.CreateAsync(req.Scope, req.ScopeId, req.MemberId, req.NomineeStartYear, MemberId) });
    }

    [HttpDelete("{progressionId:int}")]
    public async Task<IActionResult> Delete(int progressionId)
    {
        if (await _service.ProgressionScopeAsync(progressionId) is not (string scope, int scopeId)) return NotFound(new { message = "Chain not found." });
        if (await AdminNowAsync(scope, scopeId) is { } denied) return denied;
        await _service.DeleteAsync(progressionId, MemberId);
        return Ok(new { message = "Chain removed." });
    }

    [HttpPost("steps/{stepId:int}/confirm")]
    public async Task<IActionResult> Confirm(int stepId)
    {
        if (await _service.StepScopeAsync(stepId) is not (string scope, int scopeId, var yearId)) return NotFound(new { message = "Suggestion not found." });
        // A year not open yet: standing is still checked here; the service then refuses with a clear message.
        var denied = yearId is int y
            ? scope == OfficerProgressionChain.Club ? await _guard.ClubYearAsync(User, scopeId, y) : await _guard.DistrictYearAsync(User, scopeId, y)
            : await AdminNowAsync(scope, scopeId);
        if (denied != null) return denied;
        return await Run(async () => new { message = await _service.ConfirmStepAsync(stepId, MemberId) });
    }

    [HttpPost("steps/{stepId:int}/dismiss")]
    public async Task<IActionResult> Dismiss(int stepId)
    {
        if (await _service.StepScopeAsync(stepId) is not (string scope, int scopeId, _)) return NotFound(new { message = "Suggestion not found." });
        if (await AdminNowAsync(scope, scopeId) is { } denied) return denied;
        return await Run(async () => { await _service.DismissStepAsync(stepId, MemberId); return new { message = "Suggestion dismissed." }; });
    }
}
