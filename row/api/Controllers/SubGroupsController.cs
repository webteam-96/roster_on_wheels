using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Route("api/clubs/{clubId}/sub-groups")]
[Authorize]
public class SubGroupsController : ControllerBase
{
    private readonly ISubGroupService _service;
    private readonly string _connectionString;

    public SubGroupsController(ISubGroupService service, IConfiguration configuration)
    {
        _service = service;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    [HttpGet]
    public async Task<ActionResult> GetSubGroups(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var groups = await _service.GetSubGroupsAsync(clubId, yearId);
        return Ok(groups);
    }

    [HttpGet("{subGroupId}")]
    public async Task<ActionResult> GetSubGroupDetail(int clubId, int subGroupId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        try
        {
            var group = await _service.GetSubGroupDetailAsync(subGroupId);
            return Ok(group);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
    }

    [HttpPost]
    public async Task<ActionResult> CreateSubGroup(int clubId, [FromBody] CreateSubGroupDto dto)
    {
        var result = await _service.CreateSubGroupAsync(clubId, dto, GetUserId());
        return Ok(result);
    }

    [HttpPut("{subGroupId}")]
    public async Task<ActionResult> UpdateSubGroup(int clubId, int subGroupId, [FromBody] UpdateSubGroupDto dto)
    {
        var result = await _service.UpdateSubGroupAsync(subGroupId, dto, GetUserId());
        return Ok(result);
    }

    [HttpDelete("{subGroupId}")]
    public async Task<ActionResult> DeleteSubGroup(int clubId, int subGroupId)
    {
        await _service.DeleteSubGroupAsync(subGroupId, GetUserId());
        return Ok(new { message = "Sub group deleted successfully." });
    }

    [HttpGet("club-members")]
    public async Task<ActionResult> GetClubMembers(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var members = await _service.GetClubMembersAsync(clubId);
        return Ok(members);
    }

    [HttpGet("available-years")]
    public async Task<ActionResult> GetAvailableYears(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var years = await _service.GetAvailableYearsAsync(clubId, null);
        return Ok(years);
    }
}
