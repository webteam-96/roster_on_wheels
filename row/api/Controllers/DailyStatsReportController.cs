using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Manual trigger for the daily statistics report (SuperAdmin only) — lets an admin send it
// on demand for testing/verification instead of waiting for the 06:00 brand-time schedule. On a dev
// machine (remote DB) the service suppresses the real email and only logs the computed counts.
[ApiController]
[Authorize]
public class DailyStatsReportController : ControllerBase
{
    private readonly IDailyStatsReportService _service;
    public DailyStatsReportController(IDailyStatsReportService service) => _service = service;

    private bool IsSuperAdmin()
        => (User.FindFirst("roles")?.Value ?? "").Contains("SuperAdmin");

    [HttpPost("api/daily-stats-report/run")]
    public async Task<ActionResult> RunNow()
    {
        if (!IsSuperAdmin()) return Forbid();
        try
        {
            // Manual admin trigger → force=true so it actually sends + logs even on a dev/remote-DB
            // machine (the scheduled 06:00 job stays suppressed on dev).
            await _service.SendDailyReportAsync(HttpContext.RequestAborted, force: true);
            return Ok(new { message = "Daily statistics report sent to the configured recipients. Check the recipient inboxes and the email logs." });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { message = $"Failed to run the daily statistics report: {ex.Message}" });
        }
    }

    // Local-test / verification: build the report and DOWNLOAD the Excel (no email is sent, so it
    // works on a dev machine too). Add ?format=counts to get the metric counts as JSON instead.
    [HttpGet("api/daily-stats-report/preview")]
    public async Task<ActionResult> Preview([FromQuery] string? format = null)
    {
        if (!IsSuperAdmin()) return Forbid();
        try
        {
            var r = await _service.BuildReportAsync(HttpContext.RequestAborted);
            if (string.Equals(format, "counts", StringComparison.OrdinalIgnoreCase))
                return Ok(new
                {
                    subject = r.Subject,
                    counts = r.Metrics.Select(m => new { metric = m.Key, count = m.Value }),
                    breakdowns = r.Breakdowns.Select(b => new
                    {
                        title = b.Title,
                        rows = b.Rows.Select(x => new
                        {
                            avenue = x.Avenue, oneTime = x.OneTime, ongoing = x.Ongoing, total = x.Total,
                            // What the counting rules left out — the email shows these as columns.
                            notRepeat = x.NotRepeat,
                            isProject = x.IsProject,
                        })
                    })
                });
            return File(r.Excel,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                r.FileName);
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return BadRequest(new { message = $"Failed to build the daily statistics report: {ex.Message}" });
        }
    }
}
