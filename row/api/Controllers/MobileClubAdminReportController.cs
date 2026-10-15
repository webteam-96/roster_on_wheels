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
// Authorisation mirrors the club-admin mobile pattern: SuperAdmin (any club) or
// Admin (auto-scoped to their own club from the token, ignoring any clubId query
// value to prevent cross-club access).
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

    private bool IsSuperAdmin() => (User.FindFirst("roles")?.Value ?? "").Contains("SuperAdmin");

    private int? GetScopedClubId()
    {
        if (IsSuperAdmin()) return null;
        var clubId = User.FindFirst("clubId")?.Value;
        return int.TryParse(clubId, out var cid) ? cid : (int?)null;
    }

    // Club Admin is pinned to their own club regardless of any clubId query value;
    // SuperAdmin uses the supplied clubId.
    private int? ResolveClubId(int? requestedClubId) => GetScopedClubId() ?? requestedClubId;

    private ObjectResult Denied() => StatusCode(StatusCodes.Status403Forbidden, new { message = "Access denied." });

    // GET /api/mobile/club-admin/club-report?clubId=&yearId=
    [HttpGet("")]
    public async Task<ActionResult> GetReport([FromQuery] int? clubId, [FromQuery] int yearId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = ResolveClubId(clubId);
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        return await Web().GetReport(cid.Value, yearId);
    }

    [HttpGet("data-collection/all-members")]
    public async Task<ActionResult> DataCollectionAllMembers([FromQuery] int? clubId, [FromQuery] int yearId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = ResolveClubId(clubId);
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        return await Web().DataCollectionAllMembers(cid.Value, yearId);
    }

    [HttpGet("data-collection/bod")]
    public async Task<ActionResult> DataCollectionBod([FromQuery] int? clubId, [FromQuery] int yearId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = ResolveClubId(clubId);
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        return await Web().DataCollectionBod(cid.Value, yearId);
    }

    [HttpGet("data-collection/dc")]
    public async Task<ActionResult> DataCollectionDc([FromQuery] int? clubId, [FromQuery] int yearId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = ResolveClubId(clubId);
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        return await Web().DataCollectionDc(cid.Value, yearId);
    }

    [HttpGet("avenue-of-service-raw-data")]
    public async Task<ActionResult> AvenueOfServiceRawData([FromQuery] int? clubId, [FromQuery] int yearId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = ResolveClubId(clubId);
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        return await Web().AvenueOfServiceRawData(cid.Value, yearId);
    }

    [HttpGet("annual-club-service-raw-data")]
    public async Task<ActionResult> AnnualClubServiceRawData([FromQuery] int? clubId, [FromQuery] int yearId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = ResolveClubId(clubId);
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        return await Web().AnnualClubServiceRawData(cid.Value, yearId);
    }

    [HttpGet("annual-report")]
    public async Task<ActionResult> AnnualReport([FromQuery] int? clubId, [FromQuery] int yearId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = ResolveClubId(clubId);
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        return await Web().AnnualReport(cid.Value, yearId);
    }

    [HttpGet("available-years")]
    public async Task<ActionResult> GetAvailableYears([FromQuery] int? clubId)
    {
        if (!IsSuperAdminOrAdmin()) return Denied();
        var cid = ResolveClubId(clubId);
        if (cid == null) return BadRequest(new { message = "clubId is required." });
        return await Web().GetAvailableYears(cid.Value);
    }
}
