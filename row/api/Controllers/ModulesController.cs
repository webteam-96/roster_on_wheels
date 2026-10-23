using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api")]
[Authorize]
public class ModulesController : ControllerBase
{
    private readonly IModuleService _moduleService;
    private readonly string _connectionString;

    public ModulesController(IModuleService moduleService, IConfiguration configuration)
    {
        _moduleService = moduleService;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    // ===== MODULE CATEGORIES =====

    [HttpGet("module-categories")]
    public async Task<ActionResult<List<ModuleCategoryDto>>> GetCategories()
    {
        var result = await _moduleService.GetCategoriesAsync();
        return Ok(result);
    }

    [HttpPost("module-categories")]
    public async Task<ActionResult> CreateCategory([FromBody] CreateModuleCategoryDto dto)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can change the module masters." });
        var id = await _moduleService.CreateCategoryAsync(dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("module-categories/{id}")]
    public async Task<ActionResult> UpdateCategory(int id, [FromBody] UpdateModuleCategoryDto dto)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can change the module masters." });
        await _moduleService.UpdateCategoryAsync(id, dto, GetUserId());
        return Ok(new { message = "Category updated successfully." });
    }

    [HttpDelete("module-categories/{id}")]
    public async Task<ActionResult> DeleteCategory(int id)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can change the module masters." });
        await _moduleService.DeleteCategoryAsync(id, GetUserId());
        return Ok(new { message = "Category deleted successfully." });
    }

    // ===== MODULE MASTER =====

    [HttpGet("modules")]
    public async Task<ActionResult<List<ModuleDto>>> GetModules()
    {
        var result = await _moduleService.GetModulesAsync();
        return Ok(result);
    }

    [HttpGet("modules/{id}")]
    public async Task<ActionResult<ModuleDto>> GetModule(int id)
    {
        var result = await _moduleService.GetModuleByIdAsync(id);
        if (result == null) return NotFound(new { message = "Module not found" });
        return Ok(result);
    }

    [HttpPost("modules")]
    public async Task<ActionResult> CreateModule([FromBody] CreateModuleDto dto)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can change the module masters." });
        var moduleId = await _moduleService.CreateModuleAsync(dto, GetUserId());
        return Ok(new { id = moduleId });
    }

    [HttpPut("modules/{id}")]
    public async Task<ActionResult> UpdateModule(int id, [FromBody] UpdateModuleDto dto)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can change the module masters." });
        await _moduleService.UpdateModuleAsync(id, dto, GetUserId());
        return Ok(new { message = "Module updated successfully." });
    }

    [HttpDelete("modules/{id}")]
    public async Task<ActionResult> DeleteModule(int id)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "Only SuperAdmin can change the module masters." });
        await _moduleService.DeleteModuleAsync(id);
        return Ok(new { message = "Module deleted successfully." });
    }

    [HttpGet("modules/{id}/usage")]
    public async Task<ActionResult<ModuleUsageCountDto>> GetModuleUsage(int id)
    {
        var result = await _moduleService.GetModuleUsageCountAsync(id);
        return Ok(result);
    }

    // ===== COMING SOON (per-module placeholder for non-SuperAdmin during migration) =====

    /// <summary>List all modules' coming-soon status. Auth required so any logged-in user
    /// can read it; mobile app + web both use this. SuperAdmin still gets full access — the
    /// "bypass" is enforced on the client (it ignores IsComingSoon when user is SuperAdmin).</summary>
    [HttpGet("modules/coming-soon")]
    public async Task<ActionResult<List<ModuleComingSoonDto>>> GetModulesComingSoon()
    {
        var result = await _moduleService.GetModulesComingSoonAsync();
        return Ok(result);
    }

    /// <summary>SuperAdmin-only: flip a module's IsComingSoon flag and set its target date.</summary>
    [HttpPut("modules/{id}/coming-soon")]
    public async Task<ActionResult> UpdateModuleComingSoon(int id, [FromBody] UpdateModuleComingSoonDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can change Coming Soon status." });

        await _moduleService.UpdateModuleComingSoonAsync(id, dto, GetUserId());
        return Ok(new { message = "Coming Soon status updated." });
    }

    [HttpPost("modules/upload")]
    public async Task<ActionResult<object>> UploadIcon(IFormFile file)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can upload module icons." });

        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: jpg, jpeg, png, gif, webp, svg" });

        if (file.Length > 5 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 5MB" });

        var path = await _moduleService.UploadIconAsync(file);
        return Ok(new { path });
    }

    private bool IsSuperAdmin()
    {
        return User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    }

    // ===== DISTRICT MODULES =====

    [HttpGet("districts/{districtId}/modules")]
    public async Task<ActionResult<List<AssignedModuleDto>>> GetDistrictModules(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var result = await _moduleService.GetDistrictModulesAsync(districtId);
        return Ok(result);
    }

    [HttpGet("districts/{districtId}/modules/available")]
    public async Task<ActionResult<List<AvailableModuleDto>>> GetDistrictAvailableModules(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var result = await _moduleService.GetDistrictAvailableModulesAsync(districtId);
        return Ok(result);
    }

    [HttpPost("districts/{districtId}/modules/assign")]
    public async Task<ActionResult> AssignDistrictModules(int districtId, [FromBody] ModuleAssignRequestDto dto)
    {
        await _moduleService.AssignDistrictModulesAsync(districtId, dto.ModuleIds, GetUserId());
        return Ok(new { message = "Modules assigned successfully." });
    }

    [HttpPost("districts/{districtId}/modules/unassign")]
    public async Task<ActionResult> UnassignDistrictModules(int districtId, [FromBody] ModuleAssignRequestDto dto)
    {
        await _moduleService.UnassignDistrictModulesAsync(districtId, dto.ModuleIds);
        return Ok(new { message = "Modules unassigned successfully." });
    }

    // ===== CLUB MODULES =====

    [HttpGet("clubs/{clubId}/modules")]
    public async Task<ActionResult<List<AssignedModuleDto>>> GetClubModules(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _moduleService.GetClubModulesAsync(clubId);
        return Ok(result);
    }

    [HttpGet("clubs/{clubId}/modules/available")]
    public async Task<ActionResult<List<AvailableModuleDto>>> GetClubAvailableModules(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _moduleService.GetClubAvailableModulesAsync(clubId);
        return Ok(result);
    }

    [HttpPost("clubs/{clubId}/modules/assign")]
    public async Task<ActionResult> AssignClubModules(int clubId, [FromBody] ModuleAssignRequestDto dto)
    {
        await _moduleService.AssignClubModulesAsync(clubId, dto.ModuleIds, GetUserId());
        return Ok(new { message = "Modules assigned successfully." });
    }

    [HttpPost("clubs/{clubId}/modules/unassign")]
    public async Task<ActionResult> UnassignClubModules(int clubId, [FromBody] ModuleAssignRequestDto dto)
    {
        await _moduleService.UnassignClubModulesAsync(clubId, dto.ModuleIds);
        return Ok(new { message = "Modules unassigned successfully." });
    }

    // SuperAdmin one-shot: backfill default modules to any club that currently
    // has ZERO entries in club_modules. Clubs that already have any modules are
    // skipped entirely — manual customisations are never overwritten. Idempotent.
    [HttpPost("clubs/modules/bulk-assign-defaults-to-empty")]
    public async Task<ActionResult> BulkAssignClubDefaultsToEmpty()
    {
        // JWT carries roles in a comma-separated "roles" claim (custom schema),
        // not the ASP.NET default — User.IsInRole doesn't match. Same pattern
        // used in DistrictGovernor / ClubMemberHonorary controllers.
        if (User.FindFirst("roles")?.Value?.Contains("SuperAdmin", StringComparison.OrdinalIgnoreCase) != true)
            return Forbid();

        var (clubsTouched, rowsInserted) = await _moduleService.BulkAssignClubDefaultsToEmptyClubsAsync(GetUserId());
        return Ok(new
        {
            clubsTouched,
            rowsInserted,
            message = clubsTouched == 0
                ? "All clubs already have at least one module — nothing to do."
                : $"Assigned default modules to {clubsTouched} club(s); inserted {rowsInserted} row(s)."
        });
    }

    // ===== DASHBOARD =====
    // Single endpoint serves web admin + mobile member. The service inspects
    // the caller's member_roles for this scope:
    //   • Admin / SuperAdmin of THIS scope → full enabled module list
    //   • Pure member                       → only modules where
    //                                          module_master.IsDefaultForMember = 1
    // Web admins keep the same payload they had before (they ARE admin of the
    // scope they navigate to). Mobile members get the limited list via the
    // exact same URL — no separate /api/mobile twin needed.

    [HttpGet("districts/{districtId}/dashboard")]
    public async Task<ActionResult<DistrictDashboardDto>> GetDistrictDashboard(int districtId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsDistrictDrillReachableAsync(_connectionString, districtId)) return StatusCode(403, new { message = "This district or its zone is inactive. Reactivate it first to access this data." });
        var result = await _moduleService.GetDistrictDashboardForMemberAsync(districtId, GetUserId());
        if (result == null) return NotFound(new { message = "District not found" });
        return Ok(result);
    }

    [HttpGet("clubs/{clubId}/dashboard")]
    public async Task<ActionResult<ClubDashboardDto>> GetClubDashboard(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _moduleService.GetClubDashboardForMemberAsync(clubId, GetUserId());
        if (result == null) return NotFound(new { message = "Club not found" });
        return Ok(result);
    }
}
