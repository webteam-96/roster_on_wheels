using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

// Writes need a manager of the club (ScopeWriteGuardMiddleware); every record is looked up inside the URL's club.
[ApiController]
[Authorize]
[Route("api/clubs/{clubId}/potential-members")]
public class PotentialMembersController : ControllerBase
{
    private readonly IPotentialMemberService _service;
    private readonly IAuditLogService _auditLog;
    private readonly string _connectionString;

    public PotentialMembersController(IPotentialMemberService service, IAuditLogService auditLog, IConfiguration configuration)
    {
        _service = service;
        _auditLog = auditLog;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet]
    public async Task<ActionResult<PagedResult<PotentialMemberDto>>> GetByClub(
        int clubId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null,
        [FromQuery] string? stage = null)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByClubAsync(clubId, page, pageSize, search, stage);
        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<PotentialMemberDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByIdAsync(clubId, id);
        if (result == null) return NotFound(new { message = "Potential member not found." });
        return Ok(result);
    }

    [HttpPost]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreatePotentialMemberDto dto)
    {
        try { return Ok(new { id = await _service.CreateAsync(clubId, dto, GetUserId()) }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdatePotentialMemberDto dto)
    {
        try
        {
            if (!await _service.UpdateAsync(clubId, id, dto, GetUserId())) return NotFound(new { message = "Potential member not found." });
            return Ok(new { message = "Potential member updated successfully." });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        if (!await _service.DeleteAsync(clubId, id, GetUserId())) return NotFound(new { message = "Potential member not found." });
        return Ok(new { message = "Potential member deleted successfully." });
    }

    /// <summary>One-click conversion to a member of this club (feature contacts_growth).</summary>
    [HttpPost("{id}/convert")]
    public async Task<ActionResult> Convert(int clubId, int id)
    {
        try
        {
            var memberId = await _service.ConvertAsync(clubId, id, GetUserId());
            await _auditLog.LogAsync(GetUserId(), "CREATE", "member", memberId, null, new { fromPotentialMemberId = id, clubId }, HttpContext);
            return Ok(new { memberId, message = "Prospect added as a member of the club." });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }
}
