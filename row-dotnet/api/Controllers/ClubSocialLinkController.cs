using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class ClubSocialLinkController : ControllerBase
{
    private readonly IClubSocialLinkService _service;
    private readonly string _connectionString;

    public ClubSocialLinkController(IClubSocialLinkService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/website-data/social_media_links")]
    public async Task<ActionResult<List<ClubSocialLinkDto>>> GetByClub(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByClubAsync(clubId);
        return Ok(result);
    }

    [HttpGet("api/clubs/{clubId}/website-data/social_media_links/{id}")]
    public async Task<ActionResult<ClubSocialLinkDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Social link not found." });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/website-data/social_media_links")]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateClubSocialLinkDto dto)
    {
        var id = await _service.CreateAsync(clubId, dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/clubs/{clubId}/website-data/social_media_links/{id}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdateClubSocialLinkDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Social link updated successfully." });
    }

    [HttpDelete("api/clubs/{clubId}/website-data/social_media_links/{id}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Social link deleted successfully." });
    }

    // Drag-and-drop reorder: takes the full ordered list of social-link ids and rewrites sort_order.
    // Inline SQL to sidestep the SYSTEM_USER SP-replace privilege issue (mirrors banners/ads).
    [HttpPut("api/clubs/{clubId}/website-data/social_media_links/reorder-all")]
    public async Task<ActionResult> ReorderAll(int clubId, [FromBody] ReorderDto dto)
    {
        if (dto.OrderedIds == null || dto.OrderedIds.Count == 0)
            return BadRequest(new { message = "OrderedIds is required." });

        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        for (int i = 0; i < dto.OrderedIds.Count; i++)
            await conn.ExecuteAsync(
                @"UPDATE club_website_social_link SET sort_order=@S
                  WHERE pk_club_website_social_link_id=@Id AND fk_club_id=@C",
                new { S = i, Id = dto.OrderedIds[i], C = clubId });
        return Ok(new { message = "Order saved." });
    }
}
