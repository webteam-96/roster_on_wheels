using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class ThemesController : ControllerBase
{
    private readonly IThemeService _service;

    public ThemesController(IThemeService service)
    {
        _service = service;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    private bool IsSuperAdmin()
    {
        return User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    }

    [HttpGet("api/themes")]
    public async Task<ActionResult<List<ThemeDto>>> GetAll()
    {
        var result = await _service.GetAllAsync();
        return Ok(result);
    }

    [HttpPost("api/themes")]
    public async Task<ActionResult> Create([FromBody] CreateThemeDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can manage themes." });

        var id = await _service.CreateAsync(dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/themes/{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateThemeDto dto)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can manage themes." });

        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Theme updated successfully." });
    }

    [HttpDelete("api/themes/{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can manage themes." });

        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Theme deleted successfully." });
    }

    [HttpPost("api/themes/upload")]
    public async Task<ActionResult<object>> UploadImage(IFormFile file, [FromQuery] bool strict = false)
    {
        if (!IsSuperAdmin())
            return StatusCode(403, new { message = "Only SuperAdmin can upload theme images." });

        // Compress oversized (mobile-raw) photos to ≤5 MB before the size guard; web uploads pass through.
        file = RotaryApi.Services.ImageCompressor.EnsureWithinLimit(file);
        var v = RotaryApi.Services.ImageQualityValidator.Validate(file, strict);
        if (!v.Ok) return BadRequest(new { message = v.Error });

        var path = await _service.UploadImageAsync(file);
        return Ok(new { path, width = v.Width, height = v.Height, sizeBytes = v.SizeBytes });
    }
}
