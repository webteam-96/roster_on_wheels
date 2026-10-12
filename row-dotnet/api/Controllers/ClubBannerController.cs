using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

public class ClubBannerReorderAllDto
{
    public List<int> OrderedIds { get; set; } = new();
}

[ApiController]
[Authorize]
public class ClubBannerController : ControllerBase
{
    private readonly IClubBannerService _service;
    private readonly string _connectionString;
    private readonly IClubSiteCachePurger _purger;

    public ClubBannerController(IClubBannerService service, IConfiguration configuration, IClubSiteCachePurger purger)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _purger = purger;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/website-data/banners")]
    public async Task<ActionResult<List<ClubBannerDto>>> GetByClub(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByClubAsync(clubId, yearId);
        return Ok(result);
    }

    // Years that actually have banner data for this club — used for the listing's year filter
    // (data-only). The add/edit popup uses the full rotary-year list instead.
    [HttpGet("api/clubs/{clubId}/website-data/banners/available-years")]
    public async Task<ActionResult> GetAvailableYears(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT ry.pk_year_id AS id, ry.YearLabel AS yearLabel, ry.IsCurrent AS isCurrent
            FROM club_website_banner b INNER JOIN rotary_year_master ry ON ry.pk_year_id = b.fk_year_id
            WHERE b.fk_club_id = @ClubId AND b.isdeleted = 0 ORDER BY ry.YearLabel DESC", new { ClubId = clubId });
        return Ok(years);
    }

    [HttpGet("api/clubs/{clubId}/website-data/banners/{id}")]
    public async Task<ActionResult<ClubBannerDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Banner not found." });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/website-data/banners")]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateClubBannerDto dto)
    {
        var id = await _service.CreateAsync(clubId, dto, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { id });
    }

    [HttpPut("api/clubs/{clubId}/website-data/banners/{id}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdateClubBannerDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Banner updated successfully." });
    }

    [HttpDelete("api/clubs/{clubId}/website-data/banners/{id}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Banner deleted successfully." });
    }

    [HttpPost("api/clubs/{clubId}/website-data/banners/upload")]
    public async Task<ActionResult<object>> UploadImage(int clubId, IFormFile file, [FromQuery] bool strict = false)
    {
        // Compress oversized (mobile-raw) photos to ≤5 MB before the size guard; web uploads pass through.
        file = RotaryApi.Services.ImageCompressor.EnsureWithinLimit(file);
        var v = RotaryApi.Services.ImageQualityValidator.Validate(file, strict);
        if (!v.Ok) return BadRequest(new { message = v.Error });

        var path = await _service.UploadImageAsync(file);
        // path = filename only (stored as-is). url = ready-to-use relative path for preview.
        return Ok(new { path, url = "/uploads/banner/" + path, width = v.Width, height = v.Height, sizeBytes = v.SizeBytes });
    }

    // Optional document a banner can point to (alternative to a link). Mirrors the advertisement doc upload.
    [HttpPost("api/clubs/{clubId}/website-data/banners/upload-document")]
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

    [HttpPut("api/clubs/{clubId}/website-data/banners/reorder")]
    public async Task<ActionResult> Reorder(int clubId, [FromBody] ReorderBannersDto dto)
    {
        await _service.ReorderAsync(dto.Id1, dto.Id2);
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Banners reordered successfully." });
    }

    // Drag-and-drop reorder: takes the full ordered list of banner ids and rewrites sort_order.
    // Inline SQL to sidestep the SYSTEM_USER SP-replace privilege issue.
    [HttpPut("api/clubs/{clubId}/website-data/banners/reorder-all")]
    public async Task<ActionResult> ReorderAll(int clubId, [FromBody] ClubBannerReorderAllDto dto)
    {
        if (dto.OrderedIds == null || dto.OrderedIds.Count == 0)
            return BadRequest(new { message = "OrderedIds is required." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync(
                @"UPDATE club_website_banner SET sort_order=@S
                  WHERE pk_club_website_banner_id=@Id AND fk_club_id=@C",
                new { S = i, Id = dto.OrderedIds[i], C = clubId });
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Order saved." });
    }
}
