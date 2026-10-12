using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

public class SubCategoryReorderDto
{
    public int CategoryId { get; set; }
    public List<int> OrderedIds { get; set; } = new();
}

[ApiController]
[Authorize]
public class SubCategoriesController : ControllerBase
{
    private readonly ISubCategoryService _service;
    private readonly string _connectionString;

    public SubCategoriesController(ISubCategoryService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/sub-categories")]
    public async Task<ActionResult<List<SubCategoryDto>>> GetByCategory([FromQuery] int categoryId)
    {
        var result = await _service.GetByCategoryAsync(categoryId);
        return Ok(result);
    }

    [HttpGet("api/sub-categories/{id}")]
    public async Task<ActionResult<SubCategoryDto>> GetById(int id)
    {
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Sub category not found." });
        return Ok(result);
    }

    [HttpPost("api/sub-categories")]
    public async Task<ActionResult> Create([FromBody] CreateSubCategoryDto dto)
    {
        var id = await _service.CreateAsync(dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/sub-categories/{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateSubCategoryDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Sub category updated successfully." });
    }

    [HttpDelete("api/sub-categories/{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Sub category deleted successfully." });
    }

    [HttpPut("api/sub-categories/reorder")]
    public async Task<ActionResult> Reorder([FromBody] SubCategoryReorderDto dto)
    {
        if (dto.OrderedIds == null || dto.OrderedIds.Count == 0)
            return BadRequest(new { message = "OrderedIds is required." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync(
                "UPDATE sub_category_master SET sort_order=@S WHERE pk_sub_category_id=@Id AND fk_category_id=@C",
                new { S = i, Id = dto.OrderedIds[i], C = dto.CategoryId });
        return Ok(new { message = "Order saved." });
    }
}
