using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

[ApiController]
[Authorize]
public class BoardOfDirectorsController : ControllerBase
{
    private readonly IDesignationService _designationService;
    private readonly IBoardDirectorService _boardDirectorService;
    private readonly string _connectionString;
    private readonly IClubSiteCachePurger _purger;

    public BoardOfDirectorsController(IDesignationService designationService, IBoardDirectorService boardDirectorService, IConfiguration configuration, IClubSiteCachePurger purger)
    {
        _designationService = designationService;
        _boardDirectorService = boardDirectorService;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
        _purger = purger;
    }

    private int GetUserId() => int.Parse(User.FindFirst("memberId")?.Value ?? "0");

    // ===== Designation Master (SuperAdmin) =====

    [HttpGet("api/designations")]
    public async Task<ActionResult<List<DesignationDto>>> GetDesignations()
    {
        var result = await _designationService.GetAllAsync();
        return Ok(result);
    }

    [HttpPost("api/designations")]
    public async Task<ActionResult> CreateDesignation([FromBody] CreateDesignationDto dto)
    {
        var id = await _designationService.CreateAsync(dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/designations/{id}")]
    public async Task<ActionResult> UpdateDesignation(int id, [FromBody] UpdateDesignationDto dto)
    {
        await _designationService.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Designation updated successfully." });
    }

    [HttpDelete("api/designations/{id}")]
    public async Task<ActionResult> DeleteDesignation(int id)
    {
        try
        {
            await _designationService.DeleteAsync(id, GetUserId());
            return Ok(new { message = "Designation deleted successfully." });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("api/designations/reorder")]
    public async Task<ActionResult> ReorderDesignations([FromBody] ReorderDesignationsDto dto)
    {
        await _designationService.SwapOrderAsync(dto.Id1, dto.Id2);
        return Ok(new { message = "Order updated successfully." });
    }

    // Drag-and-drop full-list reorder. Body: { orderedIds: [3, 1, 2, ...] }
    [HttpPut("api/designations/reorder-all")]
    public async Task<ActionResult> ReorderDesignationsAll([FromBody] ReorderDesignationsAllDto dto)
    {
        await _designationService.ReorderAllAsync(dto.OrderedIds);
        return Ok(new { message = "Designations reordered successfully." });
    }

    // ===== Board of Directors (SuperAdmin + Admin) =====

    [HttpGet("api/clubs/{clubId}/board-of-directors")]
    public async Task<ActionResult<List<BoardDirectorDto>>> GetByClub(int clubId, [FromQuery] int yearId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _boardDirectorService.GetByClubAsync(clubId, yearId);
        return Ok(result);
    }

    [HttpGet("api/clubs/{clubId}/board-of-directors/years")]
    public async Task<ActionResult<List<BoardYearDto>>> GetYearsByClub(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _boardDirectorService.GetYearsByClubAsync(clubId);
        return Ok(result);
    }

    [HttpGet("api/clubs/{clubId}/board-of-directors/{id}")]
    public async Task<ActionResult<BoardDirectorDto>> GetById(int clubId, int id)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _boardDirectorService.GetByIdAsync(id);
        if (result == null) return NotFound(new { message = "Board director record not found" });
        return Ok(result);
    }

    [HttpPost("api/clubs/{clubId}/board-of-directors")]
    public async Task<ActionResult> Create(int clubId, [FromBody] CreateBoardDirectorDto dto)
    {
        try
        {
            var id = await _boardDirectorService.CreateAsync(clubId, dto, GetUserId());
            _purger.PurgeByClub(clubId);
            return Ok(new { id });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("api/clubs/{clubId}/board-of-directors/{id}")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdateBoardDirectorDto dto)
    {
        try
        {
            await _boardDirectorService.UpdateAsync(id, dto, GetUserId());
            _purger.PurgeByClub(clubId);
            return Ok(new { message = "Board director updated successfully." });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("api/clubs/{clubId}/board-of-directors/{id}")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        await _boardDirectorService.DeleteAsync(id, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Board director deleted successfully." });
    }

    [HttpGet("api/clubs/{clubId}/board-of-directors/search-members")]
    public async Task<ActionResult<List<ClubMemberSearchDto>>> SearchMembers(int clubId, [FromQuery] string? search)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _boardDirectorService.SearchClubMembersAsync(clubId, search);
        return Ok(result);
    }

    public class ReorderBoardOfDirectorsDto { public int YearId { get; set; } public List<int> OrderedIds { get; set; } = new(); }

    [HttpPut("api/clubs/{clubId}/board-of-directors/reorder")]
    public async Task<ActionResult> Reorder(int clubId, [FromBody] ReorderBoardOfDirectorsDto dto)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (dto.OrderedIds == null || dto.OrderedIds.Count == 0) return BadRequest(new { message = "OrderedIds is required." });
        await _boardDirectorService.ReorderAsync(clubId, dto.YearId, dto.OrderedIds, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Order updated successfully." });
    }
}
