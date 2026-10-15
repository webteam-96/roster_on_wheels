using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class FundingController : ControllerBase
{
    private readonly IFundingService _service;

    public FundingController(IFundingService service)
    {
        _service = service;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/funding")]
    public async Task<ActionResult<List<FundingDto>>> GetAll()
    {
        var result = await _service.GetAllAsync();
        return Ok(result);
    }

    [HttpGet("api/funding/{id}")]
    public async Task<ActionResult<FundingDto>> GetById(int id)
    {
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Funding not found." });
        return Ok(result);
    }

    [HttpPost("api/funding")]
    public async Task<ActionResult> Create([FromBody] CreateFundingDto dto)
    {
        var id = await _service.CreateAsync(dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/funding/{id}")]
    public async Task<ActionResult> Update(int id, [FromBody] UpdateFundingDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Funding updated successfully." });
    }

    [HttpDelete("api/funding/{id}")]
    public async Task<ActionResult> Delete(int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Funding deleted successfully." });
    }
}
