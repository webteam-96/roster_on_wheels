using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class ClubAdvertisementController : ControllerBase
{
    private readonly IClubAdvertisementService _service;
    private readonly string _connectionString;

    public ClubAdvertisementController(IClubAdvertisementService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/website-data/advertisements")]
    public async Task<ActionResult<List<ClubAdvertisementDto>>> GetByClub(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByClubAsync(clubId, yearId);
        return Ok(result);
    }

    // Years that actually have advertisement data for this club — used for the listing's year
    // filter (data-only). The add/edit popup uses the full rotary-year list instead.
    [HttpGet("api/clubs/{clubId}/website-data/advertisements/available-years")]
    public async Task<ActionResult> GetAvailableYears(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT ry.pk_year_id AS id, ry.YearLabel AS yearLabel, ry.IsCurrent AS isCurrent
            FROM club_website_advertisement a INNER JOIN rotary_year_master ry ON ry.pk_year_id = a.fk_year_id
            WHERE a.fk_club_id = @ClubId AND COALESCE(a.isdeleted,0) = 0 ORDER BY ry.YearLabel DESC", new { ClubId = clubId });
        return Ok(years);
    }

    [HttpGet("api/clubs/{clubId}/website-data/advertisements/{id}")]
    public async Task<ActionResult<ClubAdvertisementDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Advertisement not found." });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/website-data/advertisements")]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateClubAdvertisementDto dto)
    {
        var id = await _service.CreateAsync(clubId, dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/clubs/{clubId}/website-data/advertisements/{id}")]
    [OwnedBy(Owns.ClubAdvertisement, "id", "clubId")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdateClubAdvertisementDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Advertisement updated successfully." });
    }

    [HttpDelete("api/clubs/{clubId}/website-data/advertisements/{id}")]
    [OwnedBy(Owns.ClubAdvertisement, "id", "clubId")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Advertisement deleted successfully." });
    }

    [HttpPost("api/clubs/{clubId}/website-data/advertisements/upload-image")]
    public async Task<ActionResult<object>> UploadImage(int clubId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".jpg", ".jpeg", ".png", ".gif", ".webp" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: jpg, jpeg, png, gif, webp" });

        if (file.Length > 5 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 5MB" });

        var path = await _service.UploadImageAsync(file);
        // path = filename only (stored as-is). url = ready-to-use relative path for preview.
        return Ok(new { path, url = "/uploads/advertisement/" + path });
    }

    [HttpPost("api/clubs/{clubId}/website-data/advertisements/upload-document")]
    public async Task<ActionResult<object>> UploadDocument(int clubId, IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Allowed: pdf, doc, docx, xls, xlsx, ppt, pptx, jpg, jpeg, png" });

        if (file.Length > 10 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 10 MB." });

        var path = await _service.UploadDocumentAsync(file);
        return Ok(new { path });
    }

    [HttpPut("api/clubs/{clubId}/website-data/advertisements/reorder")]
    public async Task<ActionResult> Reorder(int clubId, [FromBody] ReorderAdvertisementsDto dto)
    {
        await _service.ReorderAsync(dto.Id1, dto.Id2);
        return Ok(new { message = "Advertisements reordered successfully." });
    }

    // Drag-and-drop reorder: takes the full ordered list of advertisement ids and rewrites sort_order.
    // Inline SQL to sidestep the SYSTEM_USER SP-replace privilege issue (mirrors banners).
    [HttpPut("api/clubs/{clubId}/website-data/advertisements/reorder-all")]
    public async Task<ActionResult> ReorderAll(int clubId, [FromBody] ReorderDto dto)
    {
        if (dto.OrderedIds == null || dto.OrderedIds.Count == 0)
            return BadRequest(new { message = "OrderedIds is required." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync(
                @"UPDATE club_website_advertisement SET sort_order=@S
                  WHERE pk_club_website_advertisement_id=@Id AND fk_club_id=@C",
                new { S = i, Id = dto.OrderedIds[i], C = clubId });
        return Ok(new { message = "Order saved." });
    }
}
