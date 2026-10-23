using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace RotaryApi.Controllers;

// Mobile-facing twin of the web /api/districts/{districtId}/district-report
// surface, for the Flutter District Admin app. It DELEGATES to a per-request
// instance of the web DistrictReportController (built via ActivatorUtilities so
// its dependencies — IConfiguration, IYearTableResolver, ILogger, IRotaryOrgApiClient —
// resolve from DI). Every report's SQL/logic stays single-sourced with the web
// module without modifying it. Those report actions are pure (no User /
// HttpContext / Request usage), so delegation is safe.
//
// Authorisation: SuperAdmin, Admin, or AG.
//   SuperAdmin / Admin → full district, and may filter by any AG via agMemberId.
//   AG                 → same endpoints, but agMemberId is FORCED server-side to their
//                        own member id (see EffectiveAgScope), so the report is always
//                        scoped to their clubs no matter what the app sends.
// districtId is supplied by the mobile app (it already knows the user's district context).
[ApiController]
[Route("api/mobile/district-admin/district-report")]
[Authorize]
public class MobileDistrictAdminReportController : ControllerBase
{
    private DistrictReportController Web()
        => ActivatorUtilities.CreateInstance<DistrictReportController>(HttpContext.RequestServices);

    private bool IsSuperAdminOrAdmin()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("SuperAdmin") || roles.Contains("Admin");
    }

    private bool IsAg()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("AG");
    }

    private int GetMemberId()
    {
        var id = User.FindFirst("memberId")?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    // AGs may read these reports, but only their own clubs.
    private bool CanRead() => IsSuperAdminOrAdmin() || IsAg();

    // The agMemberId actually handed to the report logic.
    //   SuperAdmin / Admin → whatever they asked for (they may filter by any AG, or none).
    //   AG (and not also SA/Admin) → FORCED to their own member id, ignoring the query
    //     string. Without this an AG could simply omit agMemberId — or pass another AG's —
    //     and pull the whole district. Never trust the client for this.
    private int? EffectiveAgScope(int? requested)
    {
        if (IsSuperAdminOrAdmin()) return requested;
        if (IsAg()) return GetMemberId();
        return requested;
    }

    private ObjectResult Denied() => StatusCode(StatusCodes.Status403Forbidden, new { message = "Access denied." });

    // GET /api/mobile/district-admin/district-report?districtId=&yearId=
    [HttpGet("")]
    public async Task<ActionResult> GetReport([FromQuery] int districtId, [FromQuery] int yearId, [FromQuery] int? agMemberId = null)
    {
        if (!CanRead()) return Denied();
        if (districtId <= 0) return BadRequest(new { message = "districtId is required." });
        return await Web().GetReport(districtId, yearId, EffectiveAgScope(agMemberId));
    }

    [HttpGet("ocv-gov")]
    public async Task<ActionResult> GetOcvGovReport([FromQuery] int districtId, [FromQuery] int yearId, [FromQuery] int? clubId = null, [FromQuery] int? agMemberId = null)
    {
        if (!CanRead()) return Denied();
        if (districtId <= 0) return BadRequest(new { message = "districtId is required." });
        return await Web().GetOcvGovReport(districtId, yearId, clubId, EffectiveAgScope(agMemberId));
    }

    [HttpGet("club-officers-ri")]
    public async Task<ActionResult> GetClubOfficersFromRi([FromQuery] int districtId, [FromQuery] int yearId, [FromQuery] int? clubId = null, [FromQuery] int? agMemberId = null)
    {
        if (!CanRead()) return Denied();
        if (districtId <= 0) return BadRequest(new { message = "districtId is required." });
        return await Web().GetClubOfficersFromRi(districtId, yearId, clubId, EffectiveAgScope(agMemberId));
    }

    [HttpGet("available-years")]
    public async Task<ActionResult> GetAvailableYears([FromQuery] int districtId)
    {
        if (!CanRead()) return Denied();
        if (districtId <= 0) return BadRequest(new { message = "districtId is required." });
        return await Web().GetAvailableYears(districtId);
    }

    [HttpGet("avenue-of-service-all-clubs")]
    public async Task<ActionResult> AvenueOfServiceAllClubs([FromQuery] int districtId, [FromQuery] int yearId, [FromQuery] int? agMemberId = null)
    {
        if (!CanRead()) return Denied();
        if (districtId <= 0) return BadRequest(new { message = "districtId is required." });
        return await Web().AvenueOfServiceAllClubs(districtId, yearId, EffectiveAgScope(agMemberId));
    }

    [HttpGet("avenue-of-service-club-count")]
    public async Task<ActionResult> AvenueOfServiceClubCount([FromQuery] int districtId, [FromQuery] int yearId, [FromQuery] int? agMemberId = null)
    {
        if (!CanRead()) return Denied();
        if (districtId <= 0) return BadRequest(new { message = "districtId is required." });
        return await Web().AvenueOfServiceClubCount(districtId, yearId, EffectiveAgScope(agMemberId));
    }
}
