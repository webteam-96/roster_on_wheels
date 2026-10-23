using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Speakers and meeting duties (ROW build spec 3.13, Services/SpeakerService.cs). Club routes need someone who manages
/// the club, reads included (speakers' contact details); the bulletin reads GET speakers?from&amp;to. The website and
/// the app read the public list (no contact details); the app reads the member's own duties. Off until a SuperAdmin
/// switches on "volunteers" (FeatureGate).
/// </summary>
[ApiController]
[Authorize]
public class SpeakersController : ControllerBase
{
    private const string Speakers = "api/clubs/{clubId:int}/speakers", Duties = "api/clubs/{clubId:int}/meeting-duties";
    private readonly SpeakerService _speakers;
    private readonly string _connectionString;

    public SpeakersController(SpeakerService speakers, IConfiguration configuration)
    {
        _speakers = speakers;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> ManagesAsync(int clubId) =>
        MemberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, MemberId, true, clubId);

    private ObjectResult NotClubAdmin() => StatusCode(403, new { message = "Only the club's admins can manage its speakers and meeting duties." });

    [HttpGet(Speakers)]
    public async Task<IActionResult> List(int clubId, [FromQuery] DateTime? from, [FromQuery] DateTime? to) =>
        await ManagesAsync(clubId) ? Ok(await _speakers.ListAsync(clubId, from, to)) : NotClubAdmin();

    [HttpPost(Speakers)]
    public async Task<IActionResult> Create(int clubId, [FromBody] SaveSpeakerDto dto) =>
        await ManagesAsync(clubId) ? Ok(await _speakers.SaveAsync(clubId, null, dto, MemberId)) : NotClubAdmin();

    [HttpPut(Speakers + "/{id:int}")]
    public async Task<IActionResult> Update(int clubId, int id, [FromBody] SaveSpeakerDto dto)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _speakers.SaveAsync(clubId, id, dto, MemberId) is { } s ? Ok(s) : NotFound(new { message = "Speaker not found." });
    }

    [HttpDelete(Speakers + "/{id:int}")]
    public async Task<IActionResult> Delete(int clubId, int id)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _speakers.DeleteAsync(clubId, id) ? NoContent() : NotFound(new { message = "Speaker not found." });
    }

    [HttpPost(Speakers + "/{id:int}/photo")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<IActionResult> Photo(int clubId, int id, IFormFile file)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _speakers.SetPhotoAsync(clubId, id, file) is { } s ? Ok(s) : NotFound(new { message = "Speaker not found." });
    }

    [HttpGet(Duties)]
    public async Task<IActionResult> ListDuties(int clubId, [FromQuery] DateTime? from, [FromQuery] DateTime? to) =>
        await ManagesAsync(clubId) ? Ok(await _speakers.ListDutiesAsync(clubId, from, to)) : NotClubAdmin();

    [HttpPost(Duties)]
    public async Task<IActionResult> AddDuty(int clubId, [FromBody] SaveMeetingDutyDto dto) =>
        await ManagesAsync(clubId) ? Ok(await _speakers.AddDutyAsync(clubId, dto, MemberId)) : NotClubAdmin();

    [HttpDelete(Duties + "/{id:int}")]
    public async Task<IActionResult> DeleteDuty(int clubId, int id)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _speakers.DeleteDutyAsync(clubId, id) ? NoContent() : NotFound(new { message = "Meeting duty not found." });
    }

    [HttpGet("api/mobile/meeting-duties")]
    public async Task<IActionResult> MyDuties() => Ok(await _speakers.MyDutiesAsync(MemberId));

    [AllowAnonymous]
    [HttpGet("api/public/club/{clubId:int}/speakers")]
    public async Task<IActionResult> Upcoming(int clubId, [FromQuery] int limit = 6) =>
        await _speakers.ListPublicAsync(clubId, limit) is { } list ? Ok(list) : NotFound(new { message = "Club not found." });
}
