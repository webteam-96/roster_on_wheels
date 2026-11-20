using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Service hours and contributions (Services/ServiceHoursService.cs). The app's routes act on the signed-in member's
/// own entries, for clubs they are an active member of. Club routes need someone who manages the club (reads too:
/// entries carry names and notes), district routes someone who manages the district; ScopeWriteGuardMiddleware alone
/// would let any member read. Off until a SuperAdmin switches on "service_hours" (FeatureGate).
/// </summary>
[ApiController]
[Authorize]
public class ServiceHoursController : ControllerBase
{
    private const string Club = "api/clubs/{clubId:int}/service-hours";
    private const string District = "api/districts/{districtId:int}/service-hours";
    private const string Mine = "api/mobile/service-hours";
    private const string Xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private readonly ServiceHoursService _hours;
    private readonly string _connectionString;

    public ServiceHoursController(ServiceHoursService hours, IConfiguration configuration)
    {
        _hours = hours;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> ManagesAsync(bool isClub, int scopeId) =>
        MemberId > 0 && await ScopeWriteGuardMiddleware.ReadAllowedAsync(_connectionString, MemberId, isClub, scopeId, members: false);

    private ObjectResult NotManager() => StatusCode(403, new { message = "Only the club's or district's admins can see service hours here." });

    // ===== The app: the member's own hours =====

    [HttpGet(Mine)]
    public async Task<IActionResult> MyHours() => MemberId > 0 ? Ok(await _hours.MineAsync(MemberId)) : Unauthorized();

    [HttpGet(Mine + "/options")]
    public async Task<IActionResult> Options([FromQuery] DateTime? date) =>
        MemberId > 0 ? Ok(await _hours.OptionsAsync(MemberId, date ?? DateTime.UtcNow)) : Unauthorized();

    [HttpPost(Mine)]
    public async Task<IActionResult> Log([FromBody] SaveServiceHoursDto dto)
    {
        // ReadAllowedAsync also refuses a club closed by its subscription
        if (MemberId <= 0 || !await _hours.IsActiveMemberAsync(MemberId, dto.ClubId)
            || !await ScopeWriteGuardMiddleware.ReadAllowedAsync(_connectionString, MemberId, true, dto.ClubId))
            return StatusCode(403, new { message = "You can log hours only for a club you are a member of." });
        return Ok(await _hours.LogAsync(MemberId, dto));
    }

    [HttpPost(Mine + "/{id:int}/photo")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<IActionResult> Photo(int id, IFormFile file) =>
        await _hours.SetPhotoAsync(MemberId, id, file) is { } e ? Ok(e) : NotFound(new { message = "No pending entry of yours with that number." });

    [HttpDelete(Mine + "/{id:int}")]
    public async Task<IActionResult> DeleteMine(int id) =>
        await _hours.DeleteOwnAsync(MemberId, id) ? NoContent() : NotFound(new { message = "No entry of yours that can still be removed." });

    // ===== Club managers =====

    [HttpGet(Club)]
    public async Task<IActionResult> List(int clubId, [FromQuery] int? yearId, [FromQuery] string? status) =>
        await ManagesAsync(true, clubId) ? Ok(await _hours.ListAsync(clubId, yearId, status)) : NotManager();

    [HttpPost(Club + "/{id:int}/review")]
    public async Task<IActionResult> Review(int clubId, int id, [FromBody] ReviewServiceHoursDto dto)
    {
        if (!await ManagesAsync(true, clubId)) return NotManager();
        return await _hours.ReviewAsync(clubId, id, dto, MemberId) is { } e ? Ok(e) : NotFound(new { message = "Entry not found." });
    }

    [HttpGet(Club + "/projects")]
    public async Task<IActionResult> Projects(int clubId, [FromQuery] int yearId) =>
        await ManagesAsync(true, clubId) ? Ok(await _hours.ClubProjectsAsync(clubId, yearId)) : NotManager();

    [HttpGet(Club + "/contributions")]
    public async Task<IActionResult> Contributions(int clubId, [FromQuery] int yearId) =>
        await ManagesAsync(true, clubId) ? Ok(await _hours.ContributionsAsync(clubId, yearId)) : NotManager();

    [HttpPost(Club + "/contributions")]
    public async Task<IActionResult> AddContribution(int clubId, [FromBody] SaveContributionDto dto) =>
        await ManagesAsync(true, clubId) ? Ok(await _hours.AddContributionAsync(clubId, dto, MemberId)) : NotManager();

    [HttpDelete(Club + "/contributions/{id:int}")]
    public async Task<IActionResult> DeleteContribution(int clubId, int id)
    {
        if (!await ManagesAsync(true, clubId)) return NotManager();
        return await _hours.DeleteContributionAsync(clubId, id) ? NoContent() : NotFound(new { message = "Contribution not found." });
    }

    [HttpGet(Club + "/report")]
    public async Task<IActionResult> ClubReport(int clubId, [FromQuery] int? yearId) =>
        await ManagesAsync(true, clubId) ? Ok(await _hours.ClubReportAsync(clubId, yearId)) : NotManager();

    [HttpGet(Club + "/report/export")]
    public async Task<IActionResult> ClubExport(int clubId, [FromQuery] int? yearId)
    {
        if (!await ManagesAsync(true, clubId)) return NotManager();
        var (file, name) = await _hours.ExportAsync(true, clubId, yearId);
        return File(file, Xlsx, name);
    }

    // ===== District managers =====

    [HttpGet(District + "/report")]
    public async Task<IActionResult> DistrictReport(int districtId, [FromQuery] int? yearId) =>
        await ManagesAsync(false, districtId) ? Ok(await _hours.DistrictReportAsync(districtId, yearId)) : NotManager();

    [HttpGet(District + "/report/export")]
    public async Task<IActionResult> DistrictExport(int districtId, [FromQuery] int? yearId)
    {
        if (!await ManagesAsync(false, districtId)) return NotManager();
        var (file, name) = await _hours.ExportAsync(false, districtId, yearId);
        return File(file, Xlsx, name);
    }
}
