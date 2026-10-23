using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/clubs/{clubId}/mass-emails")]
[Authorize]
public class ClubMassEmailsController : ControllerBase
{
    private readonly IClubMassEmailService _service;
    private readonly string _connectionString;

    public ClubMassEmailsController(IClubMassEmailService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");
    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;
    private bool IsAdmin() => User.FindFirst("roles")?.Value?.Contains("Admin") == true;

    [HttpGet]
    public async Task<ActionResult> GetList(int clubId,
        [FromQuery] string? status, [FromQuery] string? search,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var (items, totalCount) = await _service.GetListAsync(clubId, status, search, page, pageSize);
        return Ok(new { items, totalCount, page, pageSize });
    }

    [HttpGet("{id}")]
    public async Task<ActionResult> GetDetail(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (!await _service.BelongsToAsync(id, clubId, null)) return NotFound(new { message = "Mass email not found." });
        var detail = await _service.GetDetailAsync(id);
        if (detail == null) return NotFound(new { message = "Mass email not found." });
        return Ok(detail);
    }

    [HttpPost]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateMassEmailDto dto)
    {
        try
        {
            var id = await _service.CreateAsync(clubId, dto, GetUserId());
            return Ok(new { id, message = "Mass email created successfully." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] CreateMassEmailDto dto)
    {
        if (!await _service.BelongsToAsync(id, clubId, null)) return NotFound(new { message = "Mass email not found." });
        try
        {
            await _service.UpdateAsync(id, dto, GetUserId());
            return Ok(new { message = "Mass email updated successfully." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        if (!await _service.BelongsToAsync(id, clubId, null)) return NotFound(new { message = "Mass email not found." });
        try
        {
            await _service.DeleteAsync(id, GetUserId());
            return Ok(new { message = "Mass email deleted successfully." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("{id}/send")]
    public async Task<ActionResult> Send(int clubId, int id)
    {
        if (!await _service.BelongsToAsync(id, clubId, null)) return NotFound(new { message = "Mass email not found." });
        try
        {
            await _service.SendAsync(id, GetUserId());
            return Ok(new { message = "Mass email is being sent." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpGet("{id}/recipients")]
    public async Task<ActionResult> GetRecipients(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (!await _service.BelongsToAsync(id, clubId, null)) return NotFound(new { message = "Mass email not found." });
        var recipients = await _service.GetRecipientsAsync(id);
        return Ok(recipients);
    }

    [HttpGet("recipient-count")]
    public async Task<ActionResult> GetRecipientCount(int clubId,
        [FromQuery] int recipientType, [FromQuery] string? subgroupIds,
        [FromQuery] string? memberIds, [FromQuery] string? contactGroupIds)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        List<int>? parsedSubgroupIds = null;
        if (!string.IsNullOrEmpty(subgroupIds))
            parsedSubgroupIds = subgroupIds.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();

        List<int>? parsedMemberIds = null;
        if (!string.IsNullOrEmpty(memberIds))
            parsedMemberIds = memberIds.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToList();

        var parsedContactGroupIds = contactGroupIds?.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => int.TryParse(s, out var n) ? n : 0).Where(n => n > 0).ToList();

        var count = await _service.GetRecipientCountAsync(clubId, recipientType, parsedSubgroupIds, parsedMemberIds, contactGroupIds: parsedContactGroupIds);
        return Ok(count);
    }
}
