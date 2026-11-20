using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class AttendanceController : ControllerBase
{
    private readonly IAttendanceService _service;
    private readonly AdminYearGuard _guard;
    private readonly string _connectionString;

    public AttendanceController(IAttendanceService service, AdminYearGuard guard, IConfiguration configuration)
    {
        _guard = guard;
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    // Reads: the club must be reachable and the caller a member of it, one of its managers, a manager of its district or
    // a SuperAdmin. ScopeWriteGuardMiddleware checks the same for api/clubs/{id}; this keeps the rule next to the data
    // so a route or middleware change cannot open the member list (IDOR report of 2026-11-20).
    private async Task<ActionResult?> ReadDeniedAsync(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId))
            return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        return await ScopeWriteGuardMiddleware.ReadAllowedAsync(_connectionString, GetUserId(), true, clubId)
            ? null
            : StatusCode(403, new { message = "You do not have access to this club." });
    }

    // Closed meetings (gap #5 extras, AttendanceMakeupsController close/reopen) cannot be edited or deleted.
    private async Task<bool> MeetingClosedAsync(int id)
    {
        await using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        await conn.OpenAsync();
        return await AttendanceStandingService.IsMeetingClosedAsync(conn, id);
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/attendance")]
    public async Task<ActionResult> GetAll(int clubId, [FromQuery] int yearId, [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        if (await ReadDeniedAsync(clubId) is { } denied) return denied;
        var (items, totalCount) = await _service.GetAllAsync(clubId, yearId, search, page, pageSize);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/clubs/{clubId}/attendance/{id}")]
    public async Task<ActionResult<AttendanceDetailDto>> GetById(int clubId, int id)
    {
        if (await ReadDeniedAsync(clubId) is { } denied) return denied;
        var result = await _service.GetByIdAsync(id);
        // The record must belong to the club in the URL, or any reader of one club could open another club's meeting.
        if (result == null || result.ClubId != clubId) return NotFound(new { message = "Attendance record not found." });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/attendance")]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateAttendanceDto dto)
    {
        // club_attendance stores fk_year_id, but the caller never sends it — the
        // event date decides it, so the date is what gets authorised.
        var denied = await _guard.ClubYearForDateAsync(User, clubId, dto.EventDateTime);
        if (denied != null) return denied;

        try { return Ok(new { id = await _service.CreateAsync(clubId, dto, GetUserId()) }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("api/clubs/{clubId}/attendance/{id}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdateAttendanceDto dto)
    {
        // Editing the event date can move the record into another Rotary year, so
        // both the year it sits in now and the one it would land in must be yours.
        var scope = await _guard.LoadClubRecordScopeAsync("club_attendance", "pk_attendance_id", id);
        if (scope == null) return NotFound(new { message = "Attendance record not found." });
        if (scope.Value.ClubId != clubId) return NotFound(new { message = "Attendance record not found." });
        if (await MeetingClosedAsync(id)) return Conflict(new { message = "This meeting is closed. An officer must reopen it before it can be changed." });

        var deniedFrom = await _guard.ClubYearAsync(User, clubId, scope.Value.YearId);
        if (deniedFrom != null) return deniedFrom;
        var deniedTo = await _guard.ClubYearForDateAsync(User, clubId, dto.EventDateTime);
        if (deniedTo != null) return deniedTo;

        try
        {
            if (!await _service.UpdateAsync(clubId, id, dto, GetUserId())) return NotFound(new { message = "Attendance record not found." });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        return Ok(new { message = "Attendance updated successfully." });
    }

    [HttpDelete("api/clubs/{clubId}/attendance/{id}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        var scope = await _guard.LoadClubRecordScopeAsync("club_attendance", "pk_attendance_id", id);
        if (scope == null) return NotFound(new { message = "Attendance record not found." });
        if (scope.Value.ClubId != clubId) return NotFound(new { message = "Attendance record not found." });
        if (await MeetingClosedAsync(id)) return Conflict(new { message = "This meeting is closed. An officer must reopen it before it can be changed." });

        var denied = await _guard.ClubYearAsync(User, clubId, scope.Value.YearId);
        if (denied != null) return denied;

        if (!await _service.DeleteAsync(clubId, id, GetUserId())) return NotFound(new { message = "Attendance record not found." });
        return Ok(new { message = "Attendance deleted successfully." });
    }

    [HttpGet("api/clubs/{clubId}/attendance/years")]
    public async Task<ActionResult> GetYears(int clubId)
    {
        if (await ReadDeniedAsync(clubId) is { } denied) return denied;
        var result = await _service.GetYearsAsync(clubId);
        return Ok(result);
    }

    [HttpGet("api/clubs/{clubId}/attendance/members")]
    public async Task<ActionResult> GetClubMembers(int clubId)
    {
        if (await ReadDeniedAsync(clubId) is { } denied) return denied;
        var result = await _service.GetClubMembersAsync(clubId);
        return Ok(result);
    }
}
