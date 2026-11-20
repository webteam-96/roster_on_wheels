using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Youth programs (gap #12, Services/YouthService.cs). Routes sit under api/youth so ScopeWriteGuardMiddleware (which
/// would admit every club member to reads and refuse an officer who is not an admin) does not apply: every action
/// checks access itself. Youth data: the district youth chair (whole district) and club youth officers (their club)
/// only. Appointments: the district's admins appoint the chair, the club's admins appoint club officers.
/// Off until a SuperAdmin switches on "youth_programs" (FeatureGate).
/// </summary>
[ApiController]
[Authorize]
public class YouthController : ControllerBase
{
    private const string District = "api/youth/districts/{districtId:int}";
    private const string Club = "api/youth/clubs/{clubId:int}";
    private readonly YouthService _youth;
    private readonly string _cs;

    public YouthController(YouthService youth, IConfiguration configuration)
    {
        _youth = youth;
        _cs = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> AdminOfAsync(bool isClub, int scopeId) =>
        MemberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_cs, MemberId, isClub, scopeId);

    private static ObjectResult Denied(string message) => new(new { message }) { StatusCode = 403 };
    private static ObjectResult NotChair => Denied("Only the district youth chair can see youth program records.");
    private static ObjectResult NotOfficer => Denied("Only the club youth officer can see youth program records.");
    private NotFoundObjectResult Missing(string what) => NotFound(new { message = $"{what} not found." });

    // ===== Shared =====

    [HttpGet("api/youth/years")]
    public async Task<IActionResult> Years() => Ok(await _youth.YearsAsync());

    /// <summary>The app: my clearances and where I am a youth officer.</summary>
    [HttpGet("api/youth/me")]
    public async Task<IActionResult> Me() => Ok(await _youth.MyAsync(MemberId));

    // ===== District =====

    [HttpGet(District + "/officers")]
    public async Task<IActionResult> DistrictOfficers(int districtId) =>
        await AdminOfAsync(false, districtId) || await _youth.IsChairAsync(MemberId, districtId)
            ? Ok(await _youth.OfficersAsync(districtId, 0)) : Denied("You do not manage this district.");

    [HttpPost(District + "/officers")]
    public async Task<IActionResult> AddDistrictOfficer(int districtId, [FromBody] YouthMemberRefDto dto)
    {
        if (!await AdminOfAsync(false, districtId)) return Denied("Only the district's admins can appoint the youth chair.");
        await _youth.AddOfficerAsync(districtId, 0, dto.MemberId, MemberId);
        return NoContent();
    }

    [HttpDelete(District + "/officers/{memberId:int}")]
    public async Task<IActionResult> RemoveDistrictOfficer(int districtId, int memberId)
    {
        if (!await AdminOfAsync(false, districtId)) return Denied("Only the district's admins can appoint the youth chair.");
        return await _youth.RemoveOfficerAsync(districtId, 0, memberId) ? NoContent() : Missing("Appointment");
    }

    [HttpGet(District + "/members")]
    public async Task<IActionResult> DistrictMembers(int districtId, [FromQuery] string? q) =>
        await AdminOfAsync(false, districtId) || await _youth.IsChairAsync(MemberId, districtId)
            ? Ok(await _youth.MembersAsync(districtId, 0, q)) : Denied("You do not manage this district.");

    [HttpGet(District + "/participants")]
    public async Task<IActionResult> DistrictParticipants(int districtId, [FromQuery] int yearId, [FromQuery] string? program) =>
        await _youth.IsChairAsync(MemberId, districtId) ? Ok(await _youth.ParticipantsAsync(districtId, 0, yearId, program)) : NotChair;

    [HttpPut(District + "/participants/{id:int}/status")]
    public async Task<IActionResult> DistrictStatus(int districtId, int id, [FromBody] YouthStatusDto dto)
    {
        if (!await _youth.IsChairAsync(MemberId, districtId)) return NotChair;
        return await _youth.SetStatusAsync(districtId, 0, id, dto.Status, true, MemberId) is { } p ? Ok(p) : Missing("Participant");
    }

    [HttpGet(District + "/clearances")]
    public async Task<IActionResult> DistrictClearances(int districtId) =>
        await _youth.IsChairAsync(MemberId, districtId) ? Ok(await _youth.ClearancesAsync(districtId, 0)) : NotChair;

    [HttpPut(District + "/clearances/{memberId:int}")]
    public async Task<IActionResult> DistrictSaveClearance(int districtId, int memberId, [FromBody] SaveClearanceDto dto)
    {
        if (!await _youth.IsChairAsync(MemberId, districtId)) return NotChair;
        return await _youth.SaveClearanceAsync(districtId, 0, memberId, dto, MemberId) is { } c ? Ok(c) : Missing("Member of this district");
    }

    // ===== Club =====

    /// <summary>The club's district when the caller is its youth officer; null otherwise.</summary>
    private async Task<int?> OfficerDistrictAsync(int clubId) =>
        await _youth.IsClubOfficerAsync(MemberId, clubId) ? await _youth.ClubDistrictAsync(clubId) : null;

    [HttpGet(Club + "/officers")]
    public async Task<IActionResult> ClubOfficers(int clubId)
    {
        if (await _youth.ClubDistrictAsync(clubId) is not int d) return Missing("Club");
        return await AdminOfAsync(true, clubId) || await _youth.IsClubOfficerAsync(MemberId, clubId)
            ? Ok(await _youth.OfficersAsync(d, clubId)) : Denied("You do not manage this club.");
    }

    [HttpPost(Club + "/officers")]
    public async Task<IActionResult> AddClubOfficer(int clubId, [FromBody] YouthMemberRefDto dto)
    {
        if (!await AdminOfAsync(true, clubId)) return Denied("Only the club's admins can appoint its youth officer.");
        if (await _youth.ClubDistrictAsync(clubId) is not int d) return Missing("Club");
        await _youth.AddOfficerAsync(d, clubId, dto.MemberId, MemberId);
        return NoContent();
    }

    [HttpDelete(Club + "/officers/{memberId:int}")]
    public async Task<IActionResult> RemoveClubOfficer(int clubId, int memberId)
    {
        if (!await AdminOfAsync(true, clubId)) return Denied("Only the club's admins can appoint its youth officer.");
        if (await _youth.ClubDistrictAsync(clubId) is not int d) return Missing("Club");
        return await _youth.RemoveOfficerAsync(d, clubId, memberId) ? NoContent() : Missing("Appointment");
    }

    [HttpGet(Club + "/members")]
    public async Task<IActionResult> ClubMembers(int clubId, [FromQuery] string? q)
    {
        if (await _youth.ClubDistrictAsync(clubId) is not int d) return Missing("Club");
        return await AdminOfAsync(true, clubId) || await _youth.IsClubOfficerAsync(MemberId, clubId)
            ? Ok(await _youth.MembersAsync(d, clubId, q)) : Denied("You do not manage this club.");
    }

    [HttpGet(Club + "/participants")]
    public async Task<IActionResult> ClubParticipants(int clubId, [FromQuery] int yearId, [FromQuery] string? program) =>
        await OfficerDistrictAsync(clubId) is int d ? Ok(await _youth.ParticipantsAsync(d, clubId, yearId, program)) : NotOfficer;

    [HttpPost(Club + "/participants")]
    public async Task<IActionResult> AddParticipant(int clubId, [FromBody] SaveYouthParticipantDto dto) =>
        await OfficerDistrictAsync(clubId) is int d ? Ok(await _youth.CreateParticipantAsync(d, clubId, dto, MemberId)) : NotOfficer;

    [HttpPut(Club + "/participants/{id:int}/status")]
    public async Task<IActionResult> ClubStatus(int clubId, int id, [FromBody] YouthStatusDto dto)
    {
        if (await OfficerDistrictAsync(clubId) is not int d) return NotOfficer;
        return await _youth.SetStatusAsync(d, clubId, id, dto.Status, false, MemberId) is { } p ? Ok(p) : Missing("Participant");
    }

    [HttpGet(Club + "/clearances")]
    public async Task<IActionResult> ClubClearances(int clubId) =>
        await OfficerDistrictAsync(clubId) is int d ? Ok(await _youth.ClearancesAsync(d, clubId)) : NotOfficer;

    [HttpPut(Club + "/clearances/{memberId:int}")]
    public async Task<IActionResult> ClubSaveClearance(int clubId, int memberId, [FromBody] SaveClearanceDto dto)
    {
        if (await OfficerDistrictAsync(clubId) is not int d) return NotOfficer;
        return await _youth.SaveClearanceAsync(d, clubId, memberId, dto, MemberId) is { } c ? Ok(c) : Missing("Member of this club");
    }
}
