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
    private readonly string _connectionString;

    public AttendanceController(IAttendanceService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/attendance")]
    public async Task<ActionResult> GetAll(int clubId, [FromQuery] int yearId, [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var (items, totalCount) = await _service.GetAllAsync(clubId, yearId, search, page, pageSize);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/clubs/{clubId}/attendance/{id}")]
    public async Task<ActionResult<AttendanceDetailDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Attendance record not found." });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/attendance")]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateAttendanceDto dto)
    {
        var id = await _service.CreateAsync(clubId, dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/clubs/{clubId}/attendance/{id}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdateAttendanceDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Attendance updated successfully." });
    }

    [HttpDelete("api/clubs/{clubId}/attendance/{id}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Attendance deleted successfully." });
    }

    [HttpGet("api/clubs/{clubId}/attendance/years")]
    public async Task<ActionResult> GetYears(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetYearsAsync(clubId);
        return Ok(result);
    }

    [HttpGet("api/clubs/{clubId}/attendance/members")]
    public async Task<ActionResult> GetClubMembers(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetClubMembersAsync(clubId);
        return Ok(result);
    }
}
