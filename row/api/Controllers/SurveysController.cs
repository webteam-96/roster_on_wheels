using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Surveys and polls (gap #9, Services/SurveyService.cs). Club and district routes need someone who manages that club or
/// district, reads included (results carry names). The app's routes serve the signed-in member the surveys whose
/// audience they are in.
/// </summary>
[ApiController]
[Authorize]
public class SurveysController : ControllerBase
{
    private readonly SurveyService _surveys;
    private readonly string _connectionString;

    public SurveysController(SurveyService surveys, IConfiguration configuration)
    {
        _surveys = surveys;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    /// <summary>The owner when the caller manages it (scope "clubs" or "districts"), else null.</summary>
    private async Task<SurveyService.Owner?> OwnerAsync(string scope, int scopeId)
    {
        var isClub = scope == "clubs";
        if (MemberId <= 0 || !await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, MemberId, isClub, scopeId)) return null;
        return isClub ? SurveyService.Owner.Club(scopeId) : SurveyService.Owner.District(scopeId);
    }

    private ObjectResult NotAdmin() => StatusCode(403, new { message = "Only the club's or district's admins can manage its surveys." });
    private NotFoundObjectResult Missing() => NotFound(new { message = "Survey not found." });
    private BadRequestObjectResult Bad(InvalidOperationException e) => BadRequest(new { message = e.Message });

    private const string Admin = "api/{scope:regex(^(clubs|districts)$)}/{scopeId:int}/surveys";

    [HttpGet(Admin)]
    public async Task<IActionResult> List(string scope, int scopeId) =>
        await OwnerAsync(scope, scopeId) is { } o ? Ok(await _surveys.ListAsync(o)) : NotAdmin();

    [HttpGet("api/clubs/{clubId:int}/surveys/sub-groups")]
    public async Task<IActionResult> SubGroups(int clubId) =>
        await OwnerAsync("clubs", clubId) is not null ? Ok(await _surveys.SubGroupsAsync(clubId)) : NotAdmin();

    [HttpPost(Admin)]
    public async Task<IActionResult> Create(string scope, int scopeId, [FromBody] SaveSurveyDto dto)
    {
        if (await OwnerAsync(scope, scopeId) is not { } o) return NotAdmin();
        try { return Ok(new { id = await _surveys.CreateAsync(o, dto, MemberId) }); }
        catch (InvalidOperationException e) { return Bad(e); }
    }

    [HttpGet(Admin + "/{id:int}")]
    public async Task<IActionResult> Get(string scope, int scopeId, int id)
    {
        if (await OwnerAsync(scope, scopeId) is not { } o) return NotAdmin();
        return await _surveys.GetAsync(o, id) is { } s ? Ok(s) : Missing();
    }

    [HttpPut(Admin + "/{id:int}")]
    public async Task<IActionResult> Update(string scope, int scopeId, int id, [FromBody] SaveSurveyDto dto)
    {
        if (await OwnerAsync(scope, scopeId) is not { } o) return NotAdmin();
        try { return await _surveys.UpdateAsync(o, id, dto) is { } s ? Ok(s) : Missing(); }
        catch (InvalidOperationException e) { return Bad(e); }
    }

    [HttpDelete(Admin + "/{id:int}")]
    public async Task<IActionResult> Delete(string scope, int scopeId, int id)
    {
        if (await OwnerAsync(scope, scopeId) is not { } o) return NotAdmin();
        return await _surveys.DeleteAsync(o, id) ? NoContent() : Missing();
    }

    [HttpPost(Admin + "/{id:int}/publish")]
    public async Task<IActionResult> Publish(string scope, int scopeId, int id)
    {
        if (await OwnerAsync(scope, scopeId) is not { } o) return NotAdmin();
        try { return await _surveys.PublishAsync(o, id) is { } s ? Ok(s) : Missing(); }
        catch (InvalidOperationException e) { return Bad(e); }
    }

    [HttpPost(Admin + "/{id:int}/close")]
    public async Task<IActionResult> Close(string scope, int scopeId, int id)
    {
        if (await OwnerAsync(scope, scopeId) is not { } o) return NotAdmin();
        try { return await _surveys.CloseAsync(o, id) is { } s ? Ok(s) : Missing(); }
        catch (InvalidOperationException e) { return Bad(e); }
    }

    [HttpGet(Admin + "/{id:int}/results")]
    public async Task<IActionResult> Results(string scope, int scopeId, int id)
    {
        if (await OwnerAsync(scope, scopeId) is not { } o) return NotAdmin();
        return await _surveys.GetResultsAsync(o, id) is { } r ? Ok(r) : Missing();
    }

    [HttpGet(Admin + "/{id:int}/export")]
    public async Task<IActionResult> Export(string scope, int scopeId, int id)
    {
        if (await OwnerAsync(scope, scopeId) is not { } o) return NotAdmin();
        if (await _surveys.ExportCsvAsync(o, id) is not { } x) return Missing();
        return File(Encoding.UTF8.GetBytes("﻿" + x.Csv), "text/csv", $"survey-{id}.csv");
    }

    // ===== The app =====

    [HttpGet("api/mobile/surveys")]
    public async Task<IActionResult> MemberList() => Ok(await _surveys.ListForMemberAsync(MemberId));

    [HttpGet("api/mobile/surveys/{id:int}")]
    public async Task<IActionResult> MemberGet(int id) =>
        await _surveys.GetForMemberAsync(MemberId, id) is { } s ? Ok(s) : Missing();

    [HttpPost("api/mobile/surveys/{id:int}/responses")]
    public async Task<IActionResult> MemberSubmit(int id, [FromBody] SubmitSurveyDto dto)
    {
        try { return await _surveys.SubmitAsync(MemberId, id, dto) is null ? Missing() : NoContent(); }
        catch (InvalidOperationException e) { return Bad(e); }
    }

    [HttpGet("api/mobile/surveys/{id:int}/results")]
    public async Task<IActionResult> MemberResults(int id)
    {
        try { return await _surveys.MemberResultsAsync(MemberId, id) is { } r ? Ok(r) : Missing(); }
        catch (UnauthorizedAccessException e) { return StatusCode(403, new { message = e.Message }); }
    }
}
