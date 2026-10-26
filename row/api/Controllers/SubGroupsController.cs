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
    [OwnedBy(Owns.ClubSubGroup, "subGroupId", "clubId")]
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

    // Members from another club cannot be put in this club's sub group (ids come from the request body; former members stay valid on edit).
    private async Task<bool> MembersInClubAsync(int clubId, List<int>? memberIds)
    {
        var ids = memberIds?.Distinct().ToList() ?? new List<int>();
        if (ids.Count == 0) return true;
        await using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        const string sql = "SELECT COUNT(DISTINCT cm.fk_member_master_profile_id) FROM club_members cm WHERE cm.fk_club_id = @S AND cm.fk_member_master_profile_id IN @Ids";
        return await Dapper.SqlMapper.ExecuteScalarAsync<int>(conn, sql, new { S = clubId, Ids = ids }) == ids.Count;
    }

    [HttpPost]
    public async Task<ActionResult> CreateSubGroup(int clubId, [FromBody] CreateSubGroupDto dto)
    {
        if (!await MembersInClubAsync(clubId, dto.MemberIds)) return BadRequest(new { message = "Every member must belong to this club." });
        var result = await _service.CreateSubGroupAsync(clubId, dto, GetUserId());
        return Ok(result);
    }

    [HttpPut("{subGroupId}")]
    [OwnedBy(Owns.ClubSubGroup, "subGroupId", "clubId")]
    public async Task<ActionResult> UpdateSubGroup(int clubId, int subGroupId, [FromBody] UpdateSubGroupDto dto)
    {
        if (!await MembersInClubAsync(clubId, dto.MemberIds)) return BadRequest(new { message = "Every member must belong to this club." });
        var result = await _service.UpdateSubGroupAsync(subGroupId, dto, GetUserId());
        return Ok(result);
    }

    [HttpDelete("{subGroupId}")]
    [OwnedBy(Owns.ClubSubGroup, "subGroupId", "clubId")]
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
