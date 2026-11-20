using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Volunteer sheet extras (Services/VolunteerExtrasService.cs): confirmation text, follow-up emails, coordinators,
/// archive, copy, and emailing the volunteer list. Club routes need someone who manages the club (as
/// VolunteersController); the app route returns the signed-in member's own sign-ups. Behind the "volunteers" switch
/// (FeatureGate matches these paths).
/// </summary>
[ApiController]
[Authorize]
public class VolunteerExtrasController : ControllerBase
{
    private const string Sheet = "api/clubs/{clubId:int}/volunteer-sheets/{id:int}";
    private readonly VolunteerExtrasService _extras;
    private readonly string _connectionString;

    public VolunteerExtrasController(VolunteerExtrasService extras, IConfiguration configuration)
    {
        _extras = extras;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> ManagesAsync(int clubId) =>
        MemberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, MemberId, true, clubId);

    private ObjectResult NotClubAdmin() => StatusCode(403, new { message = "Only the club's admins can manage its volunteer sheets." });
    private NotFoundObjectResult Missing() => NotFound(new { message = "Volunteer sheet not found." });

    [HttpGet(Sheet + "/extras")]
    public async Task<IActionResult> Get(int clubId, int id)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _extras.GetExtrasAsync(clubId, id) is { } x ? Ok(x) : Missing();
    }

    [HttpPut(Sheet + "/extras")]
    public async Task<IActionResult> Save(int clubId, int id, [FromBody] SaveVolunteerSheetExtrasDto dto)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _extras.SaveExtrasAsync(clubId, id, dto) is { } x ? Ok(x) : Missing();
    }

    [HttpPut(Sheet + "/archive")]
    public async Task<IActionResult> Archive(int clubId, int id, [FromBody] VolunteerArchiveDto dto)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _extras.ArchiveAsync(clubId, id, dto.Archived) ? NoContent() : Missing();
    }

    [HttpPost(Sheet + "/copy")]
    public async Task<IActionResult> Copy(int clubId, int id, [FromBody] VolunteerCopyDto dto)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _extras.CopyAsync(clubId, id, dto.ShiftDays, MemberId) is int newId ? Ok(new { id = newId }) : Missing();
    }

    [HttpPost(Sheet + "/email-coordinators")]
    public async Task<IActionResult> EmailCoordinators(int clubId, int id)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _extras.EmailCoordinatorsAsync(clubId, id) is int sent ? Ok(new { sent }) : Missing();
    }

    [HttpGet("api/mobile/volunteers/my-signups")]
    public async Task<IActionResult> MySignups() => Ok(await _extras.ListMySignupsAsync(MemberId));
}
