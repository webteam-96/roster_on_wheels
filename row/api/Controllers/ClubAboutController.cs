using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class ClubAboutController : ControllerBase
{
    private readonly IClubAboutService _service;
    private readonly string _connectionString;
    private readonly IClubSiteCachePurger _purger;

    public ClubAboutController(IClubAboutService service, IConfiguration configuration, IClubSiteCachePurger purger)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _purger = purger;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/website-data/about")]
    public async Task<ActionResult<List<ClubAboutDto>>> GetByClub(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByClubAsync(clubId);
        return Ok(result);
    }

    [HttpGet("api/clubs/{clubId}/website-data/about/{id}")]
    public async Task<ActionResult<ClubAboutDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "About content not found." });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/website-data/about")]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateClubAboutDto dto)
    {
        try
        {
            var id = await _service.CreateAsync(clubId, dto, GetUserId());
            _purger.PurgeByClub(clubId);
            return Ok(new { id });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("api/clubs/{clubId}/website-data/about/{id}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdateClubAboutDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "About content updated successfully." });
    }

    [HttpDelete("api/clubs/{clubId}/website-data/about/{id}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "About content deleted successfully." });
    }

    [HttpPost("api/clubs/{clubId}/website-data/about/upload")]
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
        return Ok(new { path });
    }
}
