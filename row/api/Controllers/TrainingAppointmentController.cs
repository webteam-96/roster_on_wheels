using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Website training appointments (Calendly-style booking + Zoom). Club admins of a club with an
// active website subscription book/reschedule; super admins see all + reschedule any.
[ApiController]
[Authorize]
public class TrainingAppointmentController : ControllerBase
{
    private readonly ITrainingAppointmentService _svc;
    private readonly string _connectionString;

    public TrainingAppointmentController(ITrainingAppointmentService svc, IConfiguration config)
    {
        _svc = svc;
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    // SuperAdmin OR a club admin (role 2) of THIS club.
    private async Task<bool> CanActForClubAsync(int clubId)
    {
        if (IsSuperAdmin()) return true;
        var memberId = GetUserId();
        if (memberId == 0 || clubId <= 0) return false;
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var allowed = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2
              AND fk_club_id = @ClubId AND IsActive = 1 AND isdeleted = 0",
            new { MemberId = memberId, ClubId = clubId });
        return allowed > 0;
    }

    // Open 30-min slots (global), gated by the club having an active website.
    [HttpGet("api/training-appointments/availability")]
    public async Task<ActionResult> Availability([FromQuery] int clubId)
    {
        if (!await CanActForClubAsync(clubId)) return Forbid();
        if (!await _svc.HasActiveWebsiteAsync(clubId))
            return BadRequest(new { message = "Your club needs an active website subscription to book training." });
        return Ok(await _svc.GetAvailabilityAsync());
    }

    [HttpPost("api/training-appointments/book")]
    public async Task<ActionResult> Book([FromBody] BookAppointmentDto dto)
    {
        if (!await CanActForClubAsync(dto.ClubId)) return Forbid();
        var res = await _svc.BookAsync(dto, GetUserId());
        return res.IsSuccess ? Ok(res) : BadRequest(res);
    }

    // The booking club's upcoming appointments (for the My Club Website card).
    [HttpGet("api/training-appointments/mine")]
    public async Task<ActionResult> Mine([FromQuery] int clubId)
    {
        if (!await CanActForClubAsync(clubId)) return Forbid();
        return Ok(await _svc.GetForClubAsync(clubId));
    }

    [HttpPost("api/training-appointments/{id:long}/reschedule")]
    public async Task<ActionResult> Reschedule(long id, [FromBody] RescheduleAppointmentDto dto)
    {
        var clubId = await _svc.GetAppointmentClubIdAsync(id);
        if (clubId == null) return NotFound(new { message = "Appointment not found." });
        if (!await CanActForClubAsync(clubId.Value)) return Forbid();
        dto.AppointmentId = id;
        var res = await _svc.RescheduleAsync(dto, GetUserId());
        return res.IsSuccess ? Ok(res) : BadRequest(res);
    }

    // SuperAdmin — all appointments, for Settings → Club Websites → Website Training Appointments.
    [HttpGet("api/admin/training-appointments")]
    public async Task<ActionResult> All()
    {
        if (!IsSuperAdmin()) return Forbid();
        return Ok(await _svc.GetAllAsync());
    }

    // ── SuperAdmin — training availability (user 2026-09-29) ──────────────────
    // The weekly hours plus the date-by-date blocks. One shared calendar for the training team.
    [HttpGet("api/admin/training-availability")]
    public async Task<ActionResult> AvailabilitySettings()
    {
        if (!IsSuperAdmin()) return Forbid();
        return Ok(await _svc.GetAvailabilitySettingsAsync());
    }

    [HttpPut("api/admin/training-availability/week")]
    public async Task<ActionResult> SaveWeek([FromBody] SaveTrainingWeekRequest request)
    {
        if (!IsSuperAdmin()) return Forbid();
        try
        {
            await _svc.SaveWeeklyHoursAsync(request, GetUserId());
            return Ok(await _svc.GetAvailabilitySettingsAsync());
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    // Block a date (all day, or keep only the hours given). Saving a date replaces what it had.
    [HttpPost("api/admin/training-availability/overrides")]
    public async Task<ActionResult> SaveOverride([FromBody] SaveTrainingOverrideRequest request)
    {
        if (!IsSuperAdmin()) return Forbid();
        try
        {
            await _svc.SaveDateOverrideAsync(request, GetUserId());
            return Ok(await _svc.GetAvailabilitySettingsAsync());
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("api/admin/training-availability/overrides/{id:int}")]
    public async Task<ActionResult> DeleteOverride(int id)
    {
        if (!IsSuperAdmin()) return Forbid();
        await _svc.DeleteDateOverrideAsync(id, GetUserId());
        return Ok(await _svc.GetAvailabilitySettingsAsync());
    }
}
