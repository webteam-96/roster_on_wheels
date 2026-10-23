using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace RotaryApi.Controllers;

// Mobile-facing twin of the web /api/clubs/{clubId}/club-report surface, for the
// Flutter Club Admin app. It DELEGATES to a per-request instance of the web
// ClubReportController (built via ActivatorUtilities so all its dependencies —
// IConfiguration, IYearTableResolver, IWebHostEnvironment, IClubMonthlyReportService —
// resolve from DI). That keeps every report's SQL/logic single-sourced with the
// web module without modifying it. Those report actions are pure (no User /
// HttpContext / Request usage), so delegation is safe.
//
// Authorisation: SuperAdmin or Admin role, and the clubId must be a club the caller
// may read on the web route (its members and managers).
[ApiController]
[Route("api/mobile/club-admin/club-report")]
[Authorize]
public class MobileClubAdminReportController : ControllerBase
{
    private ClubReportController Web()
        => ActivatorUtilities.CreateInstance<ClubReportController>(HttpContext.RequestServices);

    private bool IsSuperAdminOrAdmin()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("SuperAdmin") || roles.Contains("Admin");
    }

    // On top of the Admin role, the rule of the web club-report route this mirrors: members and managers of the club
    // (SuperAdmin always). Was: a "clubId" token claim that is never issued, so any Admin read any club's reports.
    private async Task<bool> CanReadClubAsync(int clubId)
    {
        if (!int.TryParse(User.FindFirst("memberId")?.Value, out var me) || me <= 0) return false;
        var cs = HttpContext.RequestServices.GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection")!;
        return await RotaryApi.Services.ScopeWriteGuardMiddleware.ReadAllowedAsync(cs, me, true, clubId);
    }

    private ObjectResult Denied() => StatusCode(StatusCodes.Status403Forbidden, new { message = "Access denied." });

    // GET /api/mobile/club-admin/club-report?clubId=&yearId=
    [HttpGet("")]
    public async Task<ActionResult> GetReport([FromQuery] int? clubId, [FromQuery] int yearId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = clubId;
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        if (!await CanReadClubAsync(cid.Value)) return Denied();
        return await Web().GetReport(cid.Value, yearId);
    }

    [HttpGet("avenue-of-service-raw-data")]
    public async Task<ActionResult> AvenueOfServiceRawData([FromQuery] int? clubId, [FromQuery] int yearId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = clubId;
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        if (!await CanReadClubAsync(cid.Value)) return Denied();
        return await Web().AvenueOfServiceRawData(cid.Value, yearId);
    }

    [HttpGet("annual-club-service-raw-data")]
    public async Task<ActionResult> AnnualClubServiceRawData([FromQuery] int? clubId, [FromQuery] int yearId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = clubId;
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        if (!await CanReadClubAsync(cid.Value)) return Denied();
        return await Web().AnnualClubServiceRawData(cid.Value, yearId);
    }

    [HttpGet("annual-report")]
    public async Task<ActionResult> AnnualReport([FromQuery] int? clubId, [FromQuery] int yearId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = clubId;
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        if (!await CanReadClubAsync(cid.Value)) return Denied();
        return await Web().AnnualReport(cid.Value, yearId);
    }

    [HttpGet("available-years")]
    public async Task<ActionResult> GetAvailableYears([FromQuery] int? clubId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = clubId;
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        if (!await CanReadClubAsync(cid.Value)) return Denied();
        return await Web().GetAvailableYears(cid.Value);
    }
}
