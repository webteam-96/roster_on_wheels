using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// District-admin control (per district + year) over the Club Monthly Report
// submission email — Yes/No for emailing the District Governor + extra CC addresses.
// ONLY the district configures this; it is applied when any club in that district
// uploads its CMR to the district for that year (see CmrSubmissionMailer).
[ApiController]
[Authorize]
public class DistrictCmrEmailSettingsController : ControllerBase
{
    private readonly IDistrictCmrEmailSettingsService _service;
    public DistrictCmrEmailSettingsController(IDistrictCmrEmailSettingsService service) => _service = service;

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

    [HttpGet("api/districts/{districtId:int}/cmr-email-settings")]
    public async Task<ActionResult<DistrictCmrEmailSettingsDto>> Get(int districtId, [FromQuery] int yearId)
    {
        if (!IsDistrictAdmin()) return Forbid();
        if (districtId <= 0 || yearId <= 0) return BadRequest(new { message = "districtId and yearId are required." });
        return Ok(await _service.GetAsync(districtId, yearId));
    }

    [HttpPut("api/districts/{districtId:int}/cmr-email-settings")]
    public async Task<ActionResult> Save(int districtId, [FromQuery] int yearId, [FromBody] SaveDistrictCmrEmailSettingsRequest request)
    {
        if (!IsDistrictAdmin()) return Forbid();
        if (districtId <= 0 || yearId <= 0) return BadRequest(new { message = "districtId and yearId are required." });
        await _service.SaveAsync(districtId, yearId, request.SendToDistrictGovernor, request.CcEmails, GetUserId());
        return Ok(new { message = "Saved." });
    }
}
