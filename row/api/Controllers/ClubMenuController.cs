using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class ClubMenuController : ControllerBase
{
    private readonly IClubMenuService _service;
    private readonly string _connectionString;
    private readonly IClubSiteCachePurger _purger;

    public ClubMenuController(IClubMenuService service, IConfiguration configuration, IClubSiteCachePurger purger)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _purger = purger;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    // External links must be a real http(s) URL (mirrors the frontend validation — don't accept
    // arbitrary text). Returns an error message, or null when valid / not an external link.
    private static string? ValidateExternalLink(string? linkType, string? linkValue)
    {
        if (!string.Equals(linkType, "external", StringComparison.OrdinalIgnoreCase)) return null;
        var v = (linkValue ?? "").Trim();
        if (!Uri.TryCreate(v, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            return "External link must be a valid URL starting with http:// or https://.";
        return null;
    }

    // Returns whether the club has an active (non-soft-deleted) club_websites row.
    // Frontend uses this to gate the Website Data tiles + menu_list page.
    [HttpGet("api/clubs/{clubId}/has-website")]
    public async Task<ActionResult<object>> HasWebsite(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var count = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM club_websites WHERE fk_club_id = @ClubId AND isdeleted = 0",
            new { ClubId = clubId });
        return Ok(new { hasWebsite = count > 0 });
    }

    // ===== Menu Endpoints =====

    [HttpGet("api/clubs/{clubId}/website-data/menu_list")]
    public async Task<ActionResult<List<ClubMenuDto>>> GetMenusByClub(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetMenusByClubAsync(clubId);
        return Ok(result);
    }

    [HttpGet("api/clubs/{clubId}/website-data/menu_list/{id}")]
    public async Task<ActionResult<ClubMenuDto>> GetMenuById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetMenuByIdAsync(id);
        if (result == null) return NotFound(new { message = "Menu not found." });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/website-data/menu_list")]
    public async Task<ActionResult> CreateMenu(int clubId, [FromBody] CreateClubMenuDto dto)
    {
        var linkErr = ValidateExternalLink(dto.LinkType, dto.LinkValue);
        if (linkErr != null) return BadRequest(new { message = linkErr });

        var existing = await _service.GetMenusByClubAsync(clubId);

        // Spec: 8 default + max 1 custom = 9 total. Any menu created via this endpoint
        // is non-default, so at most one is allowed per club.
        var customCount = existing.Count(m => !m.IsDefault);
        if (customCount >= 1)
            return BadRequest(new { message = "Only 1 custom menu is allowed per club (in addition to the 8 default menus). Edit or delete the existing custom menu first." });

        // Defence-in-depth: still enforce the 9-active cap, in case defaults get re-flagged later.
        if (dto.IsActive)
        {
            var activeCount = existing.Count(m => m.IsActive);
            if (activeCount >= 9)
                return BadRequest(new { message = "Only 9 menus can be active at once. Deactivate one before adding another active menu." });
        }

        var id = await _service.CreateMenuAsync(clubId, dto, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { id });
    }

    [HttpPut("api/clubs/{clubId}/website-data/menu_list/{id}")]
    public async Task<ActionResult> UpdateMenu(int clubId, int id, [FromBody] UpdateClubMenuDto dto)
    {
        var existing = await _service.GetMenuByIdAsync(id);
        if (existing == null) return NotFound(new { message = "Menu not found." });
        if (existing.IsDefault)
            return BadRequest(new { message = "Default menus cannot be edited." });

        var linkErr = ValidateExternalLink(dto.LinkType, dto.LinkValue);
        if (linkErr != null) return BadRequest(new { message = linkErr });

        // If activating a previously-inactive menu, enforce 9-active cap.
        if (dto.IsActive && !existing.IsActive)
        {
            var all = await _service.GetMenusByClubAsync(clubId);
            var activeCount = all.Count(m => m.IsActive);
            if (activeCount >= 9)
                return BadRequest(new { message = "Only 9 menus can be active at once. Deactivate one first." });
        }

        await _service.UpdateMenuAsync(id, dto, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Menu updated successfully." });
    }

    // Active/Inactive switch only. Works on default menus too (which UpdateMenu refuses) —
    // name, link, content and order stay untouched. An inactive menu and its sub-menus drop
    // off the public site (the public GET only reads is_active = 1 menus).
    [HttpPut("api/clubs/{clubId}/website-data/menu_list/{id}/active")]
    public async Task<ActionResult> SetMenuActive(int clubId, int id, [FromBody] SetMenuActiveDto dto)
    {
        var existing = await _service.GetMenuByIdAsync(id);
        if (existing == null) return NotFound(new { message = "Menu not found." });
        if (existing.IsDefault && string.Equals((existing.LinkValue ?? "").Trim(), "home", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "The Home menu is always active." });

        if (dto.IsActive && !existing.IsActive)
        {
            var all = await _service.GetMenusByClubAsync(clubId);
            if (all.Count(m => m.IsActive) >= 9)
                return BadRequest(new { message = "Only 9 menus can be active at once. Deactivate one first." });
        }

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var rows = await conn.ExecuteAsync(@"
            UPDATE club_website_menu SET is_active = @IsActive, modified_by = @UserId, modified_date = NOW()
            WHERE pk_club_website_menu_id = @Id AND fk_club_id = @ClubId AND isdeleted = 0",
            new { Id = id, ClubId = clubId, IsActive = dto.IsActive ? 1 : 0, UserId = GetUserId() });
        if (rows == 0) return NotFound(new { message = "Menu not found." });
        _purger.PurgeByClub(clubId);
        return Ok(new { message = dto.IsActive ? "Menu activated." : "Menu deactivated." });
    }

    [HttpDelete("api/clubs/{clubId}/website-data/menu_list/{id}")]
    public async Task<ActionResult> DeleteMenu(int clubId, int id)
    {
        var existing = await _service.GetMenuByIdAsync(id);
        if (existing == null) return NotFound(new { message = "Menu not found." });
        if (existing.IsDefault)
            return BadRequest(new { message = "Default menus cannot be deleted." });

        await _service.DeleteMenuAsync(id, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Menu deleted successfully." });
    }

    [HttpPut("api/clubs/{clubId}/website-data/menu_list/reorder")]
    public async Task<ActionResult> ReorderMenus(int clubId, [FromBody] ReorderMenusDto dto)
    {
        await _service.ReorderMenusAsync(dto.Id1, dto.Id2);
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Menus reordered successfully." });
    }

    [HttpPost("api/clubs/{clubId}/website-data/menu_list/upload-document")]
    public async Task<ActionResult<object>> UploadDocument(int clubId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: pdf, doc, docx, xls, xlsx, ppt, pptx" });

        if (file.Length > 20 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 10MB" });

        var path = await _service.UploadDocumentAsync(clubId, file);
        return Ok(new { path });
    }

    // ===== SubMenu Endpoints =====

    [HttpGet("api/clubs/{clubId}/website-data/menu_list/{menuId}/submenus")]
    public async Task<ActionResult<List<ClubSubMenuDto>>> GetSubMenusByMenu(int clubId, int menuId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetSubMenusByMenuAsync(menuId);
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/website-data/menu_list/{menuId}/submenus")]
    public async Task<ActionResult> CreateSubMenu(int clubId, int menuId, [FromBody] CreateClubSubMenuDto dto)
    {
        var linkErr = ValidateExternalLink(dto.LinkType, dto.LinkValue);
        if (linkErr != null) return BadRequest(new { message = linkErr });
        var id = await _service.CreateSubMenuAsync(menuId, dto, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { id });
    }

    [HttpPut("api/clubs/{clubId}/website-data/menu_list/{menuId}/submenus/{id}")]
    public async Task<ActionResult> UpdateSubMenu(int clubId, int menuId, int id, [FromBody] UpdateClubSubMenuDto dto)
    {
        var linkErr = ValidateExternalLink(dto.LinkType, dto.LinkValue);
        if (linkErr != null) return BadRequest(new { message = linkErr });
        try
        {
            await _service.UpdateSubMenuAsync(id, dto, GetUserId());
            _purger.PurgeByClub(clubId);
            return Ok(new { message = "Sub-menu updated successfully." });
        }
        catch (InvalidOperationException ex)
        {
            // Service throws this on validation errors (e.g. empty name / link value).
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("api/clubs/{clubId}/website-data/menu_list/{menuId}/submenus/{id}")]
    public async Task<ActionResult> DeleteSubMenu(int clubId, int menuId, int id)
    {
        try
        {
            await _service.DeleteSubMenuAsync(id, GetUserId());
            _purger.PurgeByClub(clubId);
            return Ok(new { message = "Sub-menu deleted successfully." });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("api/clubs/{clubId}/website-data/menu_list/{menuId}/submenus/reorder")]
    public async Task<ActionResult> ReorderSubMenus(int clubId, int menuId, [FromBody] ReorderSubMenusDto dto)
    {
        await _service.ReorderSubMenusAsync(dto.Id1, dto.Id2);
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Sub-menus reordered successfully." });
    }

    /// <summary>Drag-and-drop full-list reorder. Body: { orderedIds: [1, 3, 2, ...] }</summary>
    [HttpPut("api/clubs/{clubId}/website-data/menu_list/reorder-bulk")]
    public async Task<ActionResult> ReorderMenusBulk(int clubId, [FromBody] BulkReorderDto dto)
    {
        await _service.ReorderMenusBulkAsync(clubId, dto.OrderedIds ?? new List<int>());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Menus reordered successfully." });
    }

    [HttpPut("api/clubs/{clubId}/website-data/menu_list/{menuId}/submenus/reorder-bulk")]
    public async Task<ActionResult> ReorderSubMenusBulk(int clubId, int menuId, [FromBody] BulkReorderDto dto)
    {
        await _service.ReorderSubMenusBulkAsync(menuId, dto.OrderedIds ?? new List<int>());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Sub-menus reordered successfully." });
    }

    public class BulkReorderDto
    {
        public List<int>? OrderedIds { get; set; }
    }
}
