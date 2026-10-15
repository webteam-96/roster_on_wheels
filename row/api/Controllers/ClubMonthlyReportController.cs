using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;
using System.Security.Claims;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/clubs/{clubId}/monthly-reports")]
[Authorize]
public class ClubMonthlyReportController : ControllerBase
{
    private readonly IClubMonthlyReportService _service;
    private readonly string _connectionString;
    private readonly IWebHostEnvironment _env;
    private readonly string? _mediaRedirectBase;
    private readonly IServiceScopeFactory _scopeFactory;

    public ClubMonthlyReportController(IClubMonthlyReportService service, IConfiguration configuration, IWebHostEnvironment env, IServiceScopeFactory scopeFactory)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _env = env;
        _mediaRedirectBase = configuration["Media:RedirectBaseUrl"];
        _scopeFactory = scopeFactory;
    }

    private int GetUserId() => int.Parse(User.FindFirstValue("memberId") ?? "0");

    [HttpGet("years")]
    public async Task<IActionResult> GetYears(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var years = await _service.GetYearsAsync(clubId);
        return Ok(years);
    }

    [HttpGet("months/{yearId:int}")]
    public async Task<IActionResult> GetMonths(int clubId, int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var months = await _service.GetMonthsAsync(clubId, yearId);
        return Ok(months);
    }

    [HttpGet("detail/{yearId:int}/{month:int}")]
    public async Task<IActionResult> GetReport(int clubId, int yearId, int month)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var report = await _service.GetReportAsync(clubId, yearId, month);
        return Ok(report);
    }

    [HttpPost("init/{yearId:int}/{month:int}")]
    public async Task<IActionResult> CreateOrGetReport(int clubId, int yearId, int month)
    {
        var reportId = await _service.CreateOrGetReportAsync(clubId, yearId, month, GetUserId());
        return Ok(new { reportId });
    }

    [HttpGet("meetings/{yearId:int}/{month:int}")]
    public async Task<IActionResult> GetMeetings(int clubId, int yearId, int month)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var meetings = await _service.GetMeetingsForMonthAsync(clubId, yearId, month);
        return Ok(meetings);
    }

    [HttpGet("projects/{yearId:int}/{month:int}")]
    public async Task<IActionResult> GetProjects(int clubId, int yearId, int month)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var projects = await _service.GetProjectsForMonthAsync(clubId, yearId, month);
        return Ok(projects);
    }

    // Detailed Word (.docx): Summary + Meetings + each service avenue rendered in full,
    // with every project's photos embedded. Members stay at the analytics/summary level.
    [HttpGet("word/{yearId:int}/{month:int}")]
    public async Task<IActionResult> DownloadWord(int clubId, int yearId, int month)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        try
        {
            // Ensure the report row exists so the summary (preview) can be built.
            await _service.CreateOrGetReportAsync(clubId, yearId, month, GetUserId());
            var summary = await _service.GetPreviewAsync(clubId, yearId, month, GetUserId());
            var items = await _service.GetWordProjectsForMonthAsync(clubId, yearId, month);

            // Load photo bytes (disk-first, then the configured media host). Best-effort —
            // a photo that can't be fetched is simply omitted; the doc still generates.
            foreach (var it in items)
                foreach (var ph in it.Photos)
                    await CmrMediaLoader.LoadAsync(_env, _mediaRedirectBase, ph);

            // Absolute base for clickable Agenda/MoM links in the doc (works wherever it's opened).
            var mediaBase = !string.IsNullOrWhiteSpace(_mediaRedirectBase)
                ? _mediaRedirectBase!
                : $"{Request.Scheme}://{Request.Host}{Request.PathBase}";

            var bytes = ClubMonthlyReportWordBuilder.BuildReport(summary, items, mediaBase);
            var fileName = $"{summary.ClubName}_Monthly_Report_{summary.MonthName}_{summary.YearLabel}.docx"
                .Replace(" ", "_").Replace("/", "-");
            return File(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to generate Word report: {ex.Message}", detail = ex.InnerException?.Message });
        }
    }

    // Live member stats (last-month count / deleted / added) derived from club_members.
    // Used by the Members Info step to pre-fill the fields (admin can still edit).
    [HttpGet("member-stats/{yearId:int}/{month:int}")]
    public async Task<IActionResult> GetMemberStats(int clubId, int yearId, int month)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var stats = await _service.ComputeMemberInfoAsync(clubId, yearId, month);
        return Ok(stats);
    }

    [HttpPut("member-info/{reportId:int}")]
    public async Task<IActionResult> SaveMemberInfo(int clubId, int reportId, [FromBody] SaveMemberInfoDto dto)
    {
        try
        {
            await _service.SaveMemberInfoAsync(reportId, dto, GetUserId());
            return Ok(new { message = "Member info saved." });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to save member info: {ex.Message}", detail = ex.InnerException?.Message });
        }
    }

    [HttpGet("preview/{yearId:int}/{month:int}")]
    public async Task<IActionResult> GetPreview(int clubId, int yearId, int month)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        try
        {
            var preview = await _service.GetPreviewAsync(clubId, yearId, month, GetUserId());
            return Ok(preview);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to load preview: {ex.Message}", detail = ex.InnerException?.Message });
        }
    }

    [HttpPost("upload-to-district/{reportId:int}")]
    public async Task<IActionResult> UploadToDistrict(int clubId, int reportId)
    {
        await _service.UploadToDistrictAsync(reportId, GetUserId());

        // Fire-and-forget: build the detailed PDF and email it to DG / AG / President / Secretary.
        // Runs in the background (own DI scope) so the submit returns immediately and survives the
        // user leaving the page. Best-effort — the mailer swallows + logs any failure.
        var userId = GetUserId();
        _ = Task.Run(async () =>
        {
            using var scope = _scopeFactory.CreateScope();
            var mailer = scope.ServiceProvider.GetRequiredService<ICmrSubmissionMailer>();
            await mailer.SendSubmissionEmailsAsync(clubId, reportId, userId);
        });

        return Ok(new { message = "Report uploaded to district. The report PDF is being emailed to the DG, AG, President and Secretary." });
    }

    [HttpPost("send-report-email")]
    public async Task<IActionResult> SendReportEmail(int clubId, [FromBody] SendReportEmailDto dto)
    {
        try
        {
            var result = await _service.SendReportEmailAsync(clubId, dto);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { message = $"Failed to send report email: {ex.Message}", detail = ex.InnerException?.Message });
        }
    }
}
