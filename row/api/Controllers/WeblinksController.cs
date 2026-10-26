using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/clubs/{clubId}/weblinks")]
[Authorize]
public class WeblinksController : ControllerBase
{
    private readonly IWeblinkService _service;
    private readonly IWebHostEnvironment _env;
    private readonly string _connectionString;

    public WeblinksController(IWeblinkService service, IWebHostEnvironment env, IConfiguration configuration)
    {
        _service = service;
        _env = env;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    // ── GET: flat list (optionally filtered by parent) ──────────────────

    [HttpGet("")]
    public async Task<ActionResult> GetWeblinks(int clubId, [FromQuery] int? parentId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var weblinks = await _service.GetWeblinksAsync(clubId, parentId);
        return Ok(weblinks);
    }

    // ── GET: full tree for dashboard display ────────────────────────────

    [HttpGet("tree")]
    public async Task<ActionResult> GetWeblinkTree(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var tree = await _service.GetWeblinkTreeAsync(clubId);
        return Ok(tree);
    }

    // ── POST: create weblink ────────────────────────────────────────────

    [HttpPost("")]
    public async Task<ActionResult> CreateWeblink(int clubId, [FromForm] CreateWeblinkDto dto, IFormFile? logo, IFormFile? banner, IFormFile? pdf)
    {
        // Validate logo
        if (logo != null)
        {
            if (logo.Length > 5 * 1024 * 1024)
                return BadRequest(new { message = "Logo file size must be less than 5MB." });

            if (!logo.ContentType.StartsWith("image/"))
                return BadRequest(new { message = "Logo must be an image file." });
        }

        // Validate banner
        if (banner != null)
        {
            if (banner.Length > 5 * 1024 * 1024)
                return BadRequest(new { message = "Banner file size must be less than 5MB." });

            if (!banner.ContentType.StartsWith("image/"))
                return BadRequest(new { message = "Banner must be an image file." });
        }

        // Validate PDF
        if (pdf != null)
        {
            if (pdf.Length > 10 * 1024 * 1024)
                return BadRequest(new { message = "PDF file size must be less than 10MB." });

            var pdfExt = Path.GetExtension(pdf.FileName).ToLowerInvariant();
            if (pdfExt != ".pdf")
                return BadRequest(new { message = "Only .pdf files are allowed." });
        }

        try
        {
            var result = await _service.CreateWeblinkAsync(clubId, dto, logo, banner, pdf, GetUserId(), _env);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    // ── PUT: update weblink ─────────────────────────────────────────────

    [HttpPut("{weblinkId}")]
    public async Task<ActionResult> UpdateWeblink(int clubId, int weblinkId, [FromForm] UpdateWeblinkDto dto, IFormFile? logo, IFormFile? banner, IFormFile? pdf)
    {
        // Validate logo
        if (logo != null)
        {
            if (logo.Length > 5 * 1024 * 1024)
                return BadRequest(new { message = "Logo file size must be less than 5MB." });

            if (!logo.ContentType.StartsWith("image/"))
                return BadRequest(new { message = "Logo must be an image file." });
        }

        // Validate banner
        if (banner != null)
        {
            if (banner.Length > 5 * 1024 * 1024)
                return BadRequest(new { message = "Banner file size must be less than 5MB." });

            if (!banner.ContentType.StartsWith("image/"))
                return BadRequest(new { message = "Banner must be an image file." });
        }

        // Validate PDF
        if (pdf != null)
        {
            if (pdf.Length > 10 * 1024 * 1024)
                return BadRequest(new { message = "PDF file size must be less than 10MB." });

            var pdfExt = Path.GetExtension(pdf.FileName).ToLowerInvariant();
            if (pdfExt != ".pdf")
                return BadRequest(new { message = "Only .pdf files are allowed." });
        }

        try
        {
            var result = await _service.UpdateWeblinkAsync(clubId, weblinkId, dto, logo, banner, pdf, GetUserId(), _env);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    // ── DELETE: soft delete weblink (cascades to children) ──────────────

    [HttpDelete("{weblinkId}")]
    [OwnedBy(Owns.ClubWeblink, "weblinkId", "clubId")]
    public async Task<ActionResult> DeleteWeblink(int clubId, int weblinkId)
    {
        await _service.DeleteWeblinkAsync(weblinkId, GetUserId());
        return Ok(new { message = "Weblink deleted successfully." });
    }

    // ── PUT: toggle active status ───────────────────────────────────────

    [HttpPut("{weblinkId}/toggle-active")]
    [OwnedBy(Owns.ClubWeblink, "weblinkId", "clubId")]
    public async Task<ActionResult> ToggleActive(int clubId, int weblinkId)
    {
        await _service.ToggleActiveAsync(weblinkId, GetUserId());
        return Ok(new { message = "Weblink status toggled successfully." });
    }
}
