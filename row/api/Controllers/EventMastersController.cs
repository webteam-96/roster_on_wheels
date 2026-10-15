using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/event-masters")]
[Authorize]
public class EventMastersController : ControllerBase
{
    private readonly IEventPaymentLinkService _service;

    public EventMastersController(IEventPaymentLinkService service)
    {
        _service = service;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    private bool IsSuperAdmin()
    {
        return User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    }

    // ── T-shirt Sizes ─────────────────────────────────────────────

    [HttpGet("tshirt-sizes")]
    public async Task<ActionResult> GetTshirtSizes()
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "SuperAdmin only." });
        var result = await _service.GetTshirtSizesAsync();
        return Ok(result);
    }

    [HttpPost("tshirt-sizes")]
    public async Task<ActionResult> CreateTshirtSize([FromBody] CreateEventTshirtSizeDto dto)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "SuperAdmin only." });
        var id = await _service.CreateTshirtSizeAsync(dto, GetUserId());
        return Ok(new { id, message = "T-shirt size created." });
    }

    [HttpPut("tshirt-sizes/{id}")]
    public async Task<ActionResult> UpdateTshirtSize(int id, [FromBody] CreateEventTshirtSizeDto dto)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "SuperAdmin only." });
        await _service.UpdateTshirtSizeAsync(id, dto, GetUserId());
        return Ok(new { message = "T-shirt size updated." });
    }

    [HttpDelete("tshirt-sizes/{id}")]
    public async Task<ActionResult> DeleteTshirtSize(int id)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "SuperAdmin only." });
        await _service.DeleteTshirtSizeAsync(id);
        return Ok(new { message = "T-shirt size deleted." });
    }

    // ── Food Preferences ──────────────────────────────────────────

    [HttpGet("food-preferences")]
    public async Task<ActionResult> GetFoodPreferences()
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "SuperAdmin only." });
        var result = await _service.GetFoodPreferencesAsync();
        return Ok(result);
    }

    [HttpPost("food-preferences")]
    public async Task<ActionResult> CreateFoodPreference([FromBody] CreateEventFoodPreferenceDto dto)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "SuperAdmin only." });
        var id = await _service.CreateFoodPreferenceAsync(dto, GetUserId());
        return Ok(new { id, message = "Food preference created." });
    }

    [HttpPut("food-preferences/{id}")]
    public async Task<ActionResult> UpdateFoodPreference(int id, [FromBody] CreateEventFoodPreferenceDto dto)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "SuperAdmin only." });
        await _service.UpdateFoodPreferenceAsync(id, dto, GetUserId());
        return Ok(new { message = "Food preference updated." });
    }

    [HttpDelete("food-preferences/{id}")]
    public async Task<ActionResult> DeleteFoodPreference(int id)
    {
        if (!IsSuperAdmin()) return StatusCode(403, new { message = "SuperAdmin only." });
        await _service.DeleteFoodPreferenceAsync(id);
        return Ok(new { message = "Food preference deleted." });
    }
}
