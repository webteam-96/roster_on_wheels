using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ZonesController : ControllerBase
{
    private readonly IZoneService _zoneService;
    private readonly IAuditLogService _auditLog;

    public ZonesController(IZoneService zoneService, IAuditLogService auditLog)
    {
        _zoneService = zoneService;
        _auditLog = auditLog;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<ZoneListDto>>> GetAll(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 12,
        [FromQuery] string? search = null,
        [FromQuery] int? isActive = null)
    {
        var result = await _zoneService.GetAllAsync(page, pageSize, search, isActive);
        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<ZoneDetailDto>> GetById(int id)
    {
        var zone = await _zoneService.GetByIdAsync(id);
        if (zone == null)
            return NotFound(new { message = "Zone not found" });
        return Ok(zone);
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] CreateZoneDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can create zones." });

        try
        {
            var id = await _zoneService.CreateAsync(dto, GetCurrentMemberId());
            await _auditLog.LogAsync(GetCurrentMemberId(), "CREATE", "zone", id, dto.ZoneName, dto, HttpContext);
            return CreatedAtAction(nameof(GetById), new { id }, new { id });
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateZoneDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can update zones." });

        var existing = await _zoneService.GetByIdAsync(id);
        if (existing == null)
            return NotFound(new { message = "Zone not found" });

        try
        {
            await _zoneService.UpdateAsync(id, dto, GetCurrentMemberId());
            await _auditLog.LogAsync(GetCurrentMemberId(), "UPDATE", "zone", id, dto.ZoneName, dto, HttpContext);
            return NoContent();
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can delete zones." });

        var existing = await _zoneService.GetByIdAsync(id);
        if (existing == null)
            return NotFound(new { message = "Zone not found" });

        await _zoneService.DeleteAsync(id, GetCurrentMemberId());
        await _auditLog.LogAsync(GetCurrentMemberId(), "DELETE", "zone", id, existing.ZoneName, null, HttpContext);
        return NoContent();
    }

    private bool IsSuperAdmin()
    {
        return User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    }

    private int GetCurrentMemberId()
    {
        return int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    }
}
