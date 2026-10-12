using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DistrictsController : ControllerBase
{
    private readonly IDistrictService _districtService;
    private readonly IAuditLogService _auditLog;
    private readonly string _connectionString;

    public DistrictsController(IDistrictService districtService, IAuditLogService auditLog, IConfiguration configuration)
    {
        _districtService = districtService;
        _auditLog = auditLog;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    // Phase 4 kill-switch helper: drill-down into a district is blocked if the district
    // or its parent zone is inactive. Even SA must reactivate first (per project rule —
    // only the Edit/Update endpoint bypasses this check so SA can flip IsActive back).
    private async Task<bool> IsDistrictDrillReachableAsync(int districtId)
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM district_master d
            JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id
            WHERE d.pk_district_id = @Id
              AND d.IsActive = 1 AND d.isdeleted = 0
              AND z.IsActive = 1 AND z.isdeleted = 0",
            new { Id = districtId });
        return count > 0;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<DistrictListDto>>> GetAll(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 12,
        [FromQuery] string? search = null,
        [FromQuery] int? isActive = null,
        [FromQuery] int? zoneId = null,
        [FromQuery] bool? hasClubs = null,
        [FromQuery] bool? hasMembers = null,
        [FromQuery] bool? hasSyncClubs = null)
    {
        var result = await _districtService.GetAllAsync(page, pageSize, search, isActive, zoneId, hasClubs, hasMembers, hasSyncClubs);
        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<DistrictDetailDto>> GetById(int id)
    {
        var district = await _districtService.GetByIdAsync(id);
        if (district == null)
            return NotFound(new { message = "District not found" });
        return Ok(district);
    }

    [HttpGet("{id}/clubs")]
    public async Task<ActionResult<IEnumerable<ClubListDto>>> GetClubs(int id, [FromQuery] bool? hasMembers = null)
    {
        var district = await _districtService.GetByIdAsync(id);
        if (district == null)
            return NotFound(new { message = "District not found" });

        // Phase 4 kill-switch: block drill-down if district or its zone is inactive.
        if (!await IsDistrictDrillReachableAsync(id))
            return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access its clubs." });

        var clubs = await _districtService.GetClubsAsync(id, hasMembers);
        return Ok(clubs);
    }

    [HttpGet("{id}/members")]
    public async Task<ActionResult<PagedResult<DistrictMemberDto>>> GetMembers(
        int id,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string? search = null)
    {
        var district = await _districtService.GetByIdAsync(id);
        if (district == null)
            return NotFound(new { message = "District not found" });

        if (!await IsDistrictDrillReachableAsync(id))
            return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access its members." });

        var result = await _districtService.GetMembersAsync(id, page, pageSize, search);
        return Ok(result);
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] CreateDistrictDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can create districts." });

        try
        {
            var id = await _districtService.CreateAsync(dto, GetCurrentMemberId());
            await _auditLog.LogAsync(GetCurrentMemberId(), "CREATE", "district", id, dto.DistrictNumber, dto, HttpContext);
            return CreatedAtAction(nameof(GetById), new { id }, new { id });
        }
        catch (Exception ex)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateDistrictDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can update districts." });

        var existing = await _districtService.GetByIdAsync(id);
        if (existing == null)
            return NotFound(new { message = "District not found" });

        try
        {
            await _districtService.UpdateAsync(id, dto, GetCurrentMemberId());
            await _auditLog.LogAsync(GetCurrentMemberId(), "UPDATE", "district", id, dto.DistrictNumber, dto, HttpContext);
            return NoContent();
        }
        catch (Exception ex)
        {
            return Conflict(new { message = ex.Message });
        }
    }

    // Settings → Currency screen — bulk-editable list, one district at a time, no need to
    // resubmit the full district record (DistrictNumber/LogoPath/IsActive/FkZoneId/Country).
    [HttpPut("{id}/default-currency")]
    public async Task<ActionResult> UpdateDefaultCurrency(int id, [FromBody] UpdateDistrictCurrencyDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can update district currency." });

        var existing = await _districtService.GetByIdAsync(id);
        if (existing == null)
            return NotFound(new { message = "District not found" });

        await _districtService.UpdateDefaultCurrencyAsync(id, dto.DefaultCurrency, GetCurrentMemberId());
        await _auditLog.LogAsync(GetCurrentMemberId(), "UPDATE", "district_currency", id, existing.DistrictNumber, dto, HttpContext);
        return NoContent();
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can delete districts." });

        var existing = await _districtService.GetByIdAsync(id);
        if (existing == null)
            return NotFound(new { message = "District not found" });

        await _districtService.DeleteAsync(id, GetCurrentMemberId());
        await _auditLog.LogAsync(GetCurrentMemberId(), "DELETE", "district", id, existing.DistrictNumber, null, HttpContext);
        return NoContent();
    }

    [HttpPost("upload")]
    public async Task<ActionResult<object>> Upload(IFormFile file)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can upload district logos." });

        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });

        if (file.Length > 5 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 5MB" });

        var path = await _districtService.UploadLogoAsync(file);
        return Ok(new { path });
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
