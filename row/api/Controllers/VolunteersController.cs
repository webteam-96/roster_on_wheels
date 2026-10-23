using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Volunteer sign-up sheets (ROW build spec 3.13, Services/VolunteerService.cs). Club routes need someone who manages
/// the club, reads included (sign-ups hold names and emails); ScopeWriteGuardMiddleware alone would let any member read.
/// The app's routes take the signed-in member's own sign-ups for clubs they belong to. The public routes serve the
/// sheet's share link. Off until a SuperAdmin switches on "volunteers" (FeatureGate).
/// </summary>
[ApiController]
[Authorize]
public class VolunteersController : ControllerBase
{
    private const string Club = "api/clubs/{clubId:int}/volunteer-sheets";
    private readonly VolunteerService _volunteers;
    private readonly string _connectionString;

    public VolunteersController(VolunteerService volunteers, IConfiguration configuration)
    {
        _volunteers = volunteers;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> ManagesAsync(int clubId) =>
        MemberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, MemberId, true, clubId);

    private ObjectResult NotClubAdmin() => StatusCode(403, new { message = "Only the club's admins can manage its volunteer sheets." });
    private NotFoundObjectResult Missing() => NotFound(new { message = "Volunteer sheet not found." });

    // ===== Club admins =====

    [HttpGet(Club)]
    public async Task<IActionResult> List(int clubId) =>
        await ManagesAsync(clubId) ? Ok(await _volunteers.ListAsync(clubId)) : NotClubAdmin();

    [HttpGet(Club + "/targets")]
    public async Task<IActionResult> Targets(int clubId, [FromQuery] int? yearId) =>
        await ManagesAsync(clubId) ? Ok(await _volunteers.GetTargetsAsync(clubId, yearId)) : NotClubAdmin();

    [HttpPost(Club)]
    public async Task<IActionResult> Create(int clubId, [FromBody] SaveVolunteerSheetDto dto) =>
        await ManagesAsync(clubId) ? Ok(new { id = await _volunteers.CreateSheetAsync(clubId, dto, MemberId) }) : NotClubAdmin();

    [HttpGet(Club + "/{id:int}")]
    public async Task<IActionResult> Get(int clubId, int id)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _volunteers.GetSheetAsync(clubId, id) is { } sheet ? Ok(sheet) : Missing();
    }

    [HttpPut(Club + "/{id:int}")]
    public async Task<IActionResult> Update(int clubId, int id, [FromBody] SaveVolunteerSheetDto dto)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _volunteers.UpdateSheetAsync(clubId, id, dto, MemberId) is { } sheet ? Ok(sheet) : Missing();
    }

    [HttpDelete(Club + "/{id:int}")]
    public async Task<IActionResult> Delete(int clubId, int id)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _volunteers.DeleteSheetAsync(clubId, id) ? NoContent() : Missing();
    }

    [HttpPut(Club + "/{id:int}/hours")]
    public async Task<IActionResult> Hours(int clubId, int id, [FromBody] VolunteerHoursDto dto)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _volunteers.SaveHoursAsync(clubId, id, dto) is { } sheet ? Ok(sheet) : Missing();
    }

    [HttpDelete(Club + "/{id:int}/signups/{signupId:int}")]
    public async Task<IActionResult> RemoveSignup(int clubId, int id, int signupId)
    {
        if (!await ManagesAsync(clubId)) return NotClubAdmin();
        return await _volunteers.RemoveSignupAsync(clubId, id, signupId) is { } sheet ? Ok(sheet) : NotFound(new { message = "Sign-up not found." });
    }

    // ===== The app: a member's own sign-ups =====

    [HttpGet("api/mobile/volunteers")]
    public async Task<IActionResult> MemberSheets() => Ok(await _volunteers.ListForMemberAsync(MemberId));

    [HttpPost("api/mobile/volunteers/slots/{slotId:int}/signup")]
    public async Task<IActionResult> MemberSignup(int slotId)
    {
        if (await _volunteers.OpenSlotClubAsync(slotId) is not int clubId) return NotFound(new { message = "Slot not found." });
        if (!await _volunteers.IsActiveMemberAsync(MemberId, clubId)) return StatusCode(403, new { message = "Only members of the club can sign up here." });
        await _volunteers.MemberSignupAsync(MemberId, slotId);
        return NoContent();
    }

    [HttpDelete("api/mobile/volunteers/slots/{slotId:int}/signup")]
    public async Task<IActionResult> MemberCancel(int slotId) =>
        await _volunteers.MemberCancelAsync(MemberId, slotId) ? NoContent() : NotFound(new { message = "No sign-up of yours to cancel on this slot." });

    // ===== The public sign-up link =====

    [AllowAnonymous]
    [HttpGet("api/public/volunteers/{token}")]
    public async Task<IActionResult> PublicSheet(string token) =>
        await _volunteers.GetPublicSheetAsync(token) is { } sheet ? Ok(sheet) : NotFound(new { message = "This sign-up sheet is not open." });

    [AllowAnonymous]
    [EnableRateLimiting("public-form")]
    [HttpPost("api/public/volunteers/{token}/signup")]
    public async Task<IActionResult> PublicSignup(string token, [FromBody] PublicVolunteerSignupDto dto)
    {
        const string thanks = "Thank you, you are signed up. You will get a reminder by email before your slot.";
        // honeypot: only a bot fills the hidden field; it gets the usual answer and nothing is stored
        if (!string.IsNullOrEmpty(dto.Website)) return Ok(new { message = thanks });
        return await _volunteers.PublicSignupAsync(token, dto) ? Ok(new { message = thanks }) : NotFound(new { message = "This sign-up sheet is not open." });
    }
}
