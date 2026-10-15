using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class NewslettersController : ControllerBase
{
    private readonly INewsletterService _service;
    private readonly string _connectionString;
    private readonly IClubSiteCachePurger _purger;

    public NewslettersController(INewsletterService service, IConfiguration configuration, IClubSiteCachePurger purger)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _purger = purger;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/newsletters")]
    public async Task<ActionResult> GetAll(int clubId, [FromQuery] int yearId, [FromQuery] string status = "", [FromQuery] string search = "", [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var (items, totalCount) = await _service.GetAllAsync(clubId, yearId, status, search, page, pageSize);
        return Ok(new { items, totalCount });
    }

    [HttpGet("api/clubs/{clubId}/newsletters/{id}")]
    public async Task<ActionResult<NewsletterDetailDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Newsletter not found." });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/newsletters")]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateNewsletterDto dto)
    {
        var id = await _service.CreateAsync(clubId, dto, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { id });
    }

    [HttpPut("api/clubs/{clubId}/newsletters/{id}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdateNewsletterDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Newsletter updated successfully." });
    }

    [HttpDelete("api/clubs/{clubId}/newsletters/{id}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Newsletter deleted successfully." });
    }

    [HttpPost("api/clubs/{clubId}/newsletters/upload")]
    public async Task<ActionResult<object>> UploadFile(int clubId, IFormFile file)
    {
        if (clubId <= 0)
            return BadRequest(new { message = "Invalid club id. Files cannot be uploaded without a club context." });

        if (file == null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded" });

        var allowedExtensions = new[] { ".pdf" };
        var extension = Path.GetExtension(file.FileName).ToLower();
        if (!allowedExtensions.Contains(extension))
            return BadRequest(new { message = "Invalid file type. Only PDF files are allowed." });

        if (file.Length > 20 * 1024 * 1024)
            return BadRequest(new { message = "File size must be less than 20 MB." });

        var path = await _service.UploadFileAsync(clubId, file);
        return Ok(new { path });
    }

    [HttpGet("api/clubs/{clubId}/newsletters/years")]
    public async Task<ActionResult> GetYears(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetYearsAsync(clubId);
        return Ok(result);
    }
}
