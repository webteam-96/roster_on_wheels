using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// District speaker bureau (gap #13 part 2, Services/SpeakerBureauService.cs). District routes: the district's admins
/// manage and approve; members of its clubs read approved speakers. Club routes (web club dashboard and the app): the
/// club's members find speakers of the club's district; its managers propose, share a club speaker, record a talk and
/// rate. Contact details only ever reach members of the district. Switches with "volunteers" (FeatureGate).
/// </summary>
[ApiController]
[Authorize]
public class SpeakerBureauController : ControllerBase
{
    private const string District = "api/districts/{districtId:int}/speaker-bureau", Club = "api/clubs/{clubId:int}/speaker-bureau";
    private readonly SpeakerBureauService _bureau;
    private readonly string _cs;

    public SpeakerBureauController(SpeakerBureauService bureau, IConfiguration configuration)
    {
        _bureau = bureau;
        _cs = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private Task<bool> ManagesAsync(bool isClub, int id) =>
        MemberId > 0 ? ScopeWriteGuardMiddleware.AllowedAsync(_cs, MemberId, isClub, id) : Task.FromResult(false);

    private Task<bool> ReadsAsync(bool isClub, int id) =>
        MemberId > 0 ? ScopeWriteGuardMiddleware.ReadAllowedAsync(_cs, MemberId, isClub, id) : Task.FromResult(false);

    private ObjectResult Forbidden(string what) => StatusCode(403, new { message = what });
    private NotFoundObjectResult NoEntry() => NotFound(new { message = "Speaker not found in this district's bureau." });

    // ===== District =====

    [HttpGet(District)]
    public async Task<IActionResult> List(int districtId, [FromQuery] BureauSearchDto search)
    {
        if (!await ReadsAsync(false, districtId)) return Forbidden("Only members of this district can see its speaker bureau.");
        return Ok(await _bureau.ListAsync(districtId, search, !await ManagesAsync(false, districtId)));
    }

    [HttpGet(District + "/{id:int}")]
    public async Task<IActionResult> Get(int districtId, int id)
    {
        if (!await ReadsAsync(false, districtId)) return Forbidden("Only members of this district can see its speaker bureau.");
        return await _bureau.GetAsync(districtId, id, await ManagesAsync(false, districtId)) is { } p ? Ok(p) : NoEntry();
    }

    [HttpPost(District)]
    public async Task<IActionResult> Create(int districtId, [FromBody] SaveBureauEntryDto dto) =>
        await ManagesAsync(false, districtId) ? Ok(await _bureau.CreateAsync(districtId, dto, MemberId, null)) : NotDistrictAdmin();

    [HttpPut(District + "/{id:int}")]
    public async Task<IActionResult> Update(int districtId, int id, [FromBody] SaveBureauEntryDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return await _bureau.UpdateAsync(districtId, id, dto, MemberId) is { } e ? Ok(e) : NoEntry();
    }

    [HttpPost(District + "/{id:int}/status")]
    public async Task<IActionResult> SetStatus(int districtId, int id, [FromBody] BureauStatusDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return await _bureau.SetStatusAsync(districtId, id, dto.Status, MemberId) is { } e ? Ok(e) : NoEntry();
    }

    [HttpDelete(District + "/{id:int}")]
    public async Task<IActionResult> Delete(int districtId, int id)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return await _bureau.DeleteAsync(districtId, id) ? NoContent() : NoEntry();
    }

    [HttpPost(District + "/{id:int}/photo")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<IActionResult> Photo(int districtId, int id, IFormFile file)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return await _bureau.SetPhotoAsync(districtId, id, file) is { } e ? Ok(e) : NoEntry();
    }

    [HttpPost(District + "/ratings/{ratingId:int}/hide")]
    public async Task<IActionResult> HideComment(int districtId, int ratingId, [FromBody] HideBureauCommentDto dto)
    {
        if (!await ManagesAsync(false, districtId)) return NotDistrictAdmin();
        return await _bureau.HideCommentAsync(districtId, ratingId, dto.Hidden, MemberId)
            ? NoContent() : NotFound(new { message = "Rating not found." });
    }

    private ObjectResult NotDistrictAdmin() => Forbidden("Only the district's admins can manage its speaker bureau.");

    // ===== Club =====

    /// <summary>The club's district when the caller may read (members) or manage (manager) the club; null otherwise.</summary>
    private async Task<int?> ClubDistrictAsync(int clubId, bool manager) =>
        await (manager ? ManagesAsync(true, clubId) : ReadsAsync(true, clubId)) ? await _bureau.ClubDistrictAsync(clubId) : null;

    [HttpGet(Club)]
    public async Task<IActionResult> Find(int clubId, [FromQuery] BureauSearchDto search) =>
        await ClubDistrictAsync(clubId, false) is { } d ? Ok(await _bureau.ListAsync(d, search, true)) : NotMember();

    [HttpGet(Club + "/{id:int}")]
    public async Task<IActionResult> Profile(int clubId, int id)
    {
        if (await ClubDistrictAsync(clubId, false) is not { } d) return NotMember();
        return await _bureau.GetAsync(d, id, false) is { } p ? Ok(p) : NoEntry();
    }

    [HttpPost(Club)]
    public async Task<IActionResult> Propose(int clubId, [FromBody] SaveBureauEntryDto dto) =>
        await ClubDistrictAsync(clubId, true) is { } d ? Ok(await _bureau.CreateAsync(d, dto, MemberId, clubId)) : NotClubAdmin();

    [HttpPost("api/clubs/{clubId:int}/speakers/{speakerId:int}/share-to-bureau")]
    public async Task<IActionResult> Share(int clubId, int speakerId)
    {
        if (await ClubDistrictAsync(clubId, true) is not { } d) return NotClubAdmin();
        return await _bureau.ShareClubSpeakerAsync(clubId, d, speakerId, MemberId) is { } e ? Ok(e) : NotFound(new { message = "Speaker not found." });
    }

    [HttpGet(Club + "/bookings")]
    public async Task<IActionResult> Bookings(int clubId) =>
        await ClubDistrictAsync(clubId, false) is not null ? Ok(await _bureau.ListBookingsAsync(clubId)) : NotMember();

    [HttpPost(Club + "/{id:int}/bookings")]
    public async Task<IActionResult> Book(int clubId, int id, [FromBody] BureauTalkDto dto)
    {
        if (await ClubDistrictAsync(clubId, true) is not { } d) return NotClubAdmin();
        return await _bureau.BookAsync(clubId, d, id, dto.TalkDate, MemberId) is { } b ? Ok(b) : NoEntry();
    }

    [HttpDelete(Club + "/bookings/{talkId:int}")]
    public async Task<IActionResult> CancelBooking(int clubId, int talkId)
    {
        if (await ClubDistrictAsync(clubId, true) is null) return NotClubAdmin();
        return await _bureau.CancelBookingAsync(clubId, talkId) ? NoContent() : NotFound(new { message = "Booking not found." });
    }

    [HttpPost(Club + "/{id:int}/ratings")]
    public async Task<IActionResult> Rate(int clubId, int id, [FromBody] SaveBureauRatingDto dto)
    {
        if (await ClubDistrictAsync(clubId, true) is not { } d) return NotClubAdmin();
        return await _bureau.RateAsync(clubId, d, id, dto, MemberId) is { } r ? Ok(r) : NoEntry();
    }

    private ObjectResult NotMember() => Forbidden("Only members of this club can find speakers in its district's bureau.");
    private ObjectResult NotClubAdmin() => Forbidden("Only the club's admins can propose, book or rate bureau speakers.");
}
