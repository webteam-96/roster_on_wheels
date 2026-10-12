using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/clubs/{clubId}/pph-camps")]
[Authorize]
public class PphCampsController : ControllerBase
{
    private readonly IPphCampService _service;
    private readonly IWebHostEnvironment _env;
    private readonly string _connectionString;

    public PphCampsController(IPphCampService service, IWebHostEnvironment env, IConfiguration configuration)
    {
        _service = service;
        _env = env;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    private static readonly HashSet<string> AllowedImageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg"
    };

    // ── Camps ──────────────────────────────────────────────────────────

    [HttpGet("")]
    public async Task<ActionResult> GetCamps(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var camps = await _service.GetCampsAsync(clubId);
        return Ok(camps);
    }

    [HttpPost("")]
    public async Task<ActionResult> CreateCamp(int clubId, [FromForm] CreatePphCampDto dto, IFormFile? logo)
    {
        if (logo != null)
        {
            if (logo.Length > 5 * 1024 * 1024)
                return BadRequest(new { message = "Logo file size must be less than 5MB." });

            var ext = Path.GetExtension(logo.FileName);
            if (!AllowedImageTypes.Contains(ext))
                return BadRequest(new { message = "Only image files are allowed for camp logo." });
        }

        try
        {
            var result = await _service.CreateCampAsync(clubId, dto, logo, GetUserId(), _env);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{campId}")]
    public async Task<ActionResult> UpdateCamp(int clubId, int campId, [FromForm] UpdatePphCampDto dto, IFormFile? logo)
    {
        if (logo != null)
        {
            if (logo.Length > 5 * 1024 * 1024)
                return BadRequest(new { message = "Logo file size must be less than 5MB." });

            var ext = Path.GetExtension(logo.FileName);
            if (!AllowedImageTypes.Contains(ext))
                return BadRequest(new { message = "Only image files are allowed for camp logo." });
        }

        try
        {
            var result = await _service.UpdateCampAsync(clubId, campId, dto, logo, GetUserId(), _env);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("{campId}")]
    public async Task<ActionResult> DeleteCamp(int clubId, int campId)
    {
        try
        {
            await _service.DeleteCampAsync(campId, GetUserId());
            return Ok(new { message = "Camp deleted successfully." });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{campId}/toggle-active")]
    public async Task<ActionResult> ToggleCampActive(int clubId, int campId)
    {
        await _service.ToggleCampActiveAsync(campId, GetUserId());
        return Ok(new { message = "Camp active status toggled." });
    }

    // ── Attendees (person) + medical readings ───────────────────────────

    [HttpGet("{campId}/attendees")]
    public async Task<ActionResult> GetAttendees(int clubId, int campId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        return Ok(await _service.GetAttendeesAsync(campId));
    }

    // History for a mobile across ALL clubs/camps/years (never deduped), grouped club-wise.
    // clubId is only used for the reachability guard — the result spans every club.
    [HttpGet("attendee-history")]
    public async Task<ActionResult> GetAttendeeHistoryByMobile(int clubId, [FromQuery] string mobile)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (string.IsNullOrWhiteSpace(mobile)) return BadRequest(new { message = "Mobile number is required." });
        return Ok(await _service.GetAttendeeHistoryByMobileAsync(mobile));
    }

    // Scoped attendee report — CLUB scope: only this club's attendee entries (never deduped),
    // ordered club-wise. Used by the "Download Attendee Report" button on the club camps list.
    [HttpGet("attendees-report")]
    public async Task<ActionResult> GetAttendeeReport(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        return Ok(await _service.GetAttendeeReportAsync("club", clubId));
    }

    [HttpGet("{campId}/attendees/{attendeeId}")]
    public async Task<ActionResult> GetAttendeeDetail(int clubId, int campId, int attendeeId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var detail = await _service.GetAttendeeDetailAsync(campId, attendeeId);
        if (detail == null) return NotFound(new { message = "Attendee not found." });
        return Ok(detail);
    }

    // Add a reading (creates/reuses attendee by mobile, always inserts a new reading)
    [HttpPost("{campId}/readings")]
    public async Task<ActionResult> AddReading(int clubId, int campId, [FromBody] CreatePphReadingDto dto)
    {
        try
        {
            return Ok(await _service.AddReadingAsync(campId, dto, GetUserId()));
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("{campId}/attendees/{attendeeId}")]
    public async Task<ActionResult> UpdateAttendee(int clubId, int campId, int attendeeId, [FromBody] UpdatePphAttendeeDto dto)
    {
        try
        {
            return Ok(await _service.UpdateAttendeeAsync(campId, attendeeId, dto, GetUserId()));
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpPut("{campId}/readings/{readingId}")]
    public async Task<ActionResult> UpdateReading(int clubId, int campId, int readingId, [FromBody] UpdatePphReadingDto dto)
    {
        try
        {
            return Ok(await _service.UpdateReadingAsync(campId, readingId, dto, GetUserId()));
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpDelete("{campId}/readings/{readingId}")]
    public async Task<ActionResult> DeleteReading(int clubId, int campId, int readingId)
    {
        await _service.DeleteReadingAsync(campId, readingId, GetUserId());
        return Ok(new { message = "Reading deleted successfully." });
    }

    [HttpDelete("{campId}/attendees/{attendeeId}")]
    public async Task<ActionResult> DeleteAttendee(int clubId, int campId, int attendeeId)
    {
        await _service.DeleteAttendeeAsync(campId, attendeeId, GetUserId());
        return Ok(new { message = "Attendee deleted successfully." });
    }
}
