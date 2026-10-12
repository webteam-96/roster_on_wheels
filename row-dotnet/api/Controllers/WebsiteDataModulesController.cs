using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class WebsiteDataModulesController : ControllerBase
{
    private readonly IWebsiteDataModuleService _service;

    public WebsiteDataModulesController(IWebsiteDataModuleService service)
    {
        _service = service;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/website-data-modules")]
    public async Task<ActionResult<List<WebsiteDataModuleDto>>> GetAll()
    {
        var result = await _service.GetAllAsync();
        return Ok(result);
    }

    [HttpPost("api/website-data-modules")]
    public async Task<ActionResult> Create([FromBody] CreateWebsiteDataModuleDto dto)
    {
        var id = await _service.CreateAsync(dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/website-data-modules/{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateWebsiteDataModuleDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Website data module updated successfully." });
    }

    [HttpDelete("api/website-data-modules/{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Website data module deleted successfully." });
    }

    [HttpPut("api/website-data-modules/reorder")]
    public async Task<ActionResult> Reorder([FromBody] ReorderWebsiteDataModuleDto dto)
    {
        await _service.SwapOrderAsync(dto.Id1, dto.Id2);
        return Ok(new { message = "Order updated successfully." });
    }
}
