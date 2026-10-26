using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class ClubContactDetailController : ControllerBase
{
    private readonly IClubContactDetailService _service;
    private readonly string _connectionString;

    public ClubContactDetailController(IClubContactDetailService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet("api/clubs/{clubId}/website-data/contact_details")]
    public async Task<ActionResult<List<ClubContactDetailDto>>> GetByClub(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByClubAsync(clubId, yearId);
        return Ok(result);
    }

    // Years that actually have contact-detail data for this club — used for the listing's year
    // filter (data-only). The add/edit popup uses the full rotary-year list instead.
    [HttpGet("api/clubs/{clubId}/website-data/contact_details/available-years")]
    public async Task<ActionResult> GetAvailableYears(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        var years = await conn.QueryAsync<dynamic>(@"
            SELECT DISTINCT ry.pk_year_id AS id, ry.YearLabel AS yearLabel, ry.IsCurrent AS isCurrent
            FROM club_website_contact_detail cd
            INNER JOIN rotary_year_master ry ON ry.pk_year_id = cd.fk_year_id
            WHERE cd.fk_club_id = @ClubId AND cd.isdeleted = 0
            ORDER BY ry.YearLabel DESC", new { ClubId = clubId });
        return Ok(years);
    }

    [HttpGet("api/clubs/{clubId}/website-data/contact_details/{id}")]
    public async Task<ActionResult<ClubContactDetailDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _service.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Contact detail not found." });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/website-data/contact_details")]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateClubContactDetailDto dto)
    {
        var id = await _service.CreateAsync(clubId, dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/clubs/{clubId}/website-data/contact_details/{id}")]
    [OwnedBy(Owns.ClubContactDetail, "id", "clubId")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdateClubContactDetailDto dto)
    {
        await _service.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Contact detail updated successfully." });
    }

    [HttpDelete("api/clubs/{clubId}/website-data/contact_details/{id}")]
    [OwnedBy(Owns.ClubContactDetail, "id", "clubId")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        await _service.DeleteAsync(id, GetUserId());
        return Ok(new { message = "Contact detail deleted successfully." });
    }
}
