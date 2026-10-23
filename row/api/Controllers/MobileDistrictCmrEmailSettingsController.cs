using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Mobile twin of DistrictCmrEmailSettingsController — same behaviour, same
// IDistrictCmrEmailSettingsService (no logic duplicated), separate api/mobile
// route prefix. District admin controls, per district + year, what happens when
// any club in the district uploads its Club Monthly Report to the district:
// Yes/No for emailing the District Governor + extra always-CC addresses. The
// settings are read by CmrSubmissionMailer at submission time, so a club's upload
// from web OR mobile honours whatever the district last saved (from web or mobile).
[ApiController]
[Authorize]
public class MobileDistrictCmrEmailSettingsController : ControllerBase
{
    private readonly IDistrictCmrEmailSettingsService _service;
    private readonly string _connectionString;

    public MobileDistrictCmrEmailSettingsController(IDistrictCmrEmailSettingsService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private bool IsDistrictAdmin()
    {
        var roles = User.FindFirst("roles")?.Value ?? "";
        return roles.Contains("Admin") || roles.Contains("SuperAdmin");
    }

    public class SaveDistrictCmrEmailSettingsRequest
    {
        public bool SendToDistrictGovernor { get; set; } = true;
        public string? CcEmails { get; set; }
    }

    [HttpGet("api/mobile/districts/{districtId:int}/cmr-email-settings")]
    public async Task<ActionResult<DistrictCmrEmailSettingsDto>> Get(int districtId, [FromQuery] int yearId)
    {
        if (!IsDistrictAdmin()) return Forbid();
        if (districtId <= 0 || yearId <= 0) return BadRequest(new { message = "districtId and yearId are required." });
        // the district's own admins (SuperAdmin always): the CC list holds people's email addresses. Was: any Admin.
        if (!await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, GetUserId(), false, districtId))
            return StatusCode(403, new { message = "You do not manage this district." });
        return Ok(await _service.GetAsync(districtId, yearId));
    }

    [HttpPut("api/mobile/districts/{districtId:int}/cmr-email-settings")]
    public async Task<ActionResult> Save(int districtId, [FromQuery] int yearId, [FromBody] SaveDistrictCmrEmailSettingsRequest request)
    {
        if (!IsDistrictAdmin()) return Forbid();
        if (districtId <= 0 || yearId <= 0) return BadRequest(new { message = "districtId and yearId are required." });
        await _service.SaveAsync(districtId, yearId, request.SendToDistrictGovernor, request.CcEmails, GetUserId());
        return Ok(new { message = "Saved." });
    }
}
