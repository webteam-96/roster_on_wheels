using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

public class AreaOfFocusReorderDto
{
    public int ModuleId { get; set; }
    public List<int> OrderedIds { get; set; } = new();
}

[ApiController]
[Authorize]
public class AreaOfFocusController : ControllerBase
{
    private readonly IAreaOfFocusService _service;
    private readonly string _connectionString;

    public AreaOfFocusController(IAreaOfFocusService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/area-of-focus")]
    public async Task<ActionResult<List<AreaOfFocusDto>>> GetAll([FromQuery] int? moduleId = null)
    {
        var result = await _service.GetAllAsync(moduleId);
        return Ok(result);
    }

    [HttpGet("api/area-of-focus/{id}")]
    public async Task<ActionResult<AreaOfFocusDto>> GetById(int id)
    {
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Area of focus not found." });
        return Ok(result);
    }

    [HttpPost("api/area-of-focus")]
    public async Task<ActionResult> Create([FromBody] CreateAreaOfFocusDto dto)
    {
        var id = await _service.CreateAsync(dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/area-of-focus/{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateAreaOfFocusDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Area of focus updated successfully." });
    }

    [HttpDelete("api/area-of-focus/{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Area of focus deleted successfully." });
    }

    [HttpPut("api/area-of-focus/reorder")]
    public async Task<ActionResult> Reorder([FromBody] AreaOfFocusReorderDto dto)
    {
        if (dto.OrderedIds == null || dto.OrderedIds.Count == 0)
            return BadRequest(new { message = "OrderedIds is required." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync(
                "UPDATE area_of_focus_master SET sort_order=@S WHERE pk_area_of_focus_id=@Id AND fk_module_id=@M",
                new { S = i, Id = dto.OrderedIds[i], M = dto.ModuleId });
        return Ok(new { message = "Order saved." });
    }

    [HttpPost("api/area-of-focus/upload")]
    public async Task<ActionResult> UploadImage(IFormFile file, [FromQuery] bool strict = false)
    {
        // Compress oversized (mobile-raw) photos to ≤5 MB before the size guard; web uploads pass through.
        file = RotaryApi.Services.ImageCompressor.EnsureWithinLimit(file);
        var v = RotaryApi.Services.ImageQualityValidator.Validate(file, strict);
        if (!v.Ok) return BadRequest(new { message = v.Error });

        var path = await _service.UploadImageAsync(file);
        return Ok(new { path, width = v.Width, height = v.Height, sizeBytes = v.SizeBytes });
    }
}
