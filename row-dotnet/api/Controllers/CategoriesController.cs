using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

public class CategoryReorderDto
{
    public int AreaOfFocusId { get; set; }
    public List<int> OrderedIds { get; set; } = new();
}

[ApiController]
[Authorize]
public class CategoriesController : ControllerBase
{
    private readonly ICategoryService _service;
    private readonly string _connectionString;

    public CategoriesController(ICategoryService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/categories")]
    public async Task<ActionResult<List<CategoryDto>>> GetByAreaOfFocus([FromQuery] int areaOfFocusId)
    {
        var result = await _service.GetByAreaOfFocusAsync(areaOfFocusId);
        return Ok(result);
    }

    [HttpGet("api/categories/{id}")]
    public async Task<ActionResult<CategoryDto>> GetById(int id)
    {
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Category not found." });
        return Ok(result);
    }

    [HttpPost("api/categories")]
    public async Task<ActionResult> Create([FromBody] CreateCategoryDto dto)
    {
        var id = await _service.CreateAsync(dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/categories/{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateCategoryDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Category updated successfully." });
    }

    [HttpDelete("api/categories/{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Category deleted successfully." });
    }

    [HttpPut("api/categories/reorder")]
    public async Task<ActionResult> Reorder([FromBody] CategoryReorderDto dto)
    {
        if (dto.OrderedIds == null || dto.OrderedIds.Count == 0)
            return BadRequest(new { message = "OrderedIds is required." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync(
                "UPDATE category_master SET sort_order=@S WHERE pk_category_id=@Id AND fk_area_of_focus_id=@A",
                new { S = i, Id = dto.OrderedIds[i], A = dto.AreaOfFocusId });
        return Ok(new { message = "Order saved." });
    }
}
