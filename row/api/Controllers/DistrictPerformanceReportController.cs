using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// District Performance Report — SuperAdmin only (Settings → District Performance Report).
// View the counts for any district, download the .xlsx, or send a TEST email to the configured test
// recipients before the report is switched on for the District Governors.
[ApiController]
[Authorize]
public class DistrictPerformanceReportController : ControllerBase
{
    private readonly IDistrictPerformanceReportService _service;
    public DistrictPerformanceReportController(IDistrictPerformanceReportService service) => _service = service;

    private bool IsSuperAdmin()
        => (User.FindFirst("roles")?.Value ?? "").Contains("SuperAdmin");

    private int GetMemberId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    [HttpGet("api/district-performance-report/settings")]
    public async Task<ActionResult> Settings()
    {
        if (!IsSuperAdmin()) return Forbid();
        return Ok(await _service.GetSettingsAsync());
    }

    [HttpGet("api/district-performance-report/districts")]
    public async Task<ActionResult> Districts()
    {
        if (!IsSuperAdmin()) return Forbid();
        return Ok(await _service.GetDistrictsAsync());
    }

    // On-screen view — counts only (no attachment), so it stays quick.
    [HttpGet("api/district-performance-report/view")]
    public async Task<ActionResult> ViewReport([FromQuery] int districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (districtId <= 0) return BadRequest(new { message = "Select a district." });
        try
        {
            var r = await _service.BuildReportAsync(districtId, includeAttachment: false, HttpContext.RequestAborted);
            return Ok(new
            {
                r.DistrictId, r.DistrictNumber, r.ZoneName, r.YearId, r.YearLabel, r.PeriodLabel,
                r.GovernorName, r.GovernorEmail, r.GovernorMobile, r.Subject, r.Highlights, r.ScopeNote, r.Sections,
                Html = _service.BuildPrintHtml(r),   // the screen's "Print" prints the email itself
            });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex) { return BadRequest(new { message = $"Failed to build the report: {ex.Message}" }); }
    }

    [HttpGet("api/district-performance-report/excel")]
    public async Task<ActionResult> Excel([FromQuery] int districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (districtId <= 0) return BadRequest(new { message = "Select a district." });
        try
        {
            var r = await _service.BuildReportAsync(districtId, includeAttachment: true, HttpContext.RequestAborted);
            return File(r.Excel!, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", r.FileName);
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex) { return BadRequest(new { message = $"Failed to build the Excel: {ex.Message}" }); }
    }

    // Sends to the TEST recipients only (never to the DG) — for checking before go-live.
    [HttpPost("api/district-performance-report/send-test")]
    public async Task<ActionResult> SendTest([FromQuery] int districtId)
    {
        if (!IsSuperAdmin()) return Forbid();
        if (districtId <= 0) return BadRequest(new { message = "Select a district." });
        try
        {
            var message = await _service.SendTestAsync(districtId, GetMemberId(), HttpContext.RequestAborted);
            return Ok(new { message });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (Exception ex) { return BadRequest(new { message = $"Failed to send the test email: {ex.Message}" }); }
    }
}
