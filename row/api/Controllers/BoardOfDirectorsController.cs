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

    private readonly AdminYearGuard _guard;

    public BoardOfDirectorsController(IDesignationService designationService, IBoardDirectorService boardDirectorService, IConfiguration configuration, IClubSiteCachePurger purger, AdminYearGuard guard)
    {
        _guard = guard;
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
    [SuperAdminOnly]
    public async Task<ActionResult> CreateDesignation([FromBody] CreateDesignationDto dto)
    {
        var id = await _designationService.CreateAsync(dto, GetUserId());
        return Ok(new { id });
    }

    [HttpPut("api/designations/{id}")]
    [SuperAdminOnly]
    public async Task<ActionResult> UpdateDesignation(int id, [FromBody] UpdateDesignationDto dto)
    {
        if (!string.IsNullOrEmpty(dto.RiTitle) && !RiCodes.OfficerTitles.Contains(dto.RiTitle))
            return BadRequest(new { message = "RI title must be one of: " + string.Join(", ", RiCodes.OfficerTitles) + "." });
        await _designationService.UpdateAsync(id, dto, GetUserId());
        return Ok(new { message = "Designation updated successfully." });
    }

    [HttpDelete("api/designations/{id}")]
    [SuperAdminOnly]
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
    [SuperAdminOnly]
    public async Task<ActionResult> ReorderDesignations([FromBody] ReorderDesignationsDto dto)
    {
        await _designationService.SwapOrderAsync(dto.Id1, dto.Id2);
        return Ok(new { message = "Order updated successfully." });
    }

    // Drag-and-drop full-list reorder. Body: { orderedIds: [3, 1, 2, ...] }
    [HttpPut("api/designations/reorder-all")]
    [SuperAdminOnly]
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

    /// <summary>OMS ROW-51: may this club add a non-member for the current Rotary year? (test district only)</summary>
    [HttpGet("api/clubs/{clubId}/board-of-directors/rules")]
    public async Task<ActionResult<object>> GetRules(int clubId)
    {
        await using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        return Ok(new { nonMemberCurrentYear = await BoardDirectorService.IsTestDistrictClubAsync(conn, clubId) });
    }

    [HttpGet("api/clubs/{clubId}/board-of-directors/years")]
    public async Task<ActionResult<List<BoardYearDto>>> GetYearsByClub(int clubId)
    {
        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        var result = await _boardDirectorService.GetYearsByClubAsync(clubId);
        return Ok(result);
    }

    [HttpGet("api/clubs/{clubId}/board-of-directors/{id}")]
    [OwnedBy(Owns.BoardDirector, "id", "clubId")]
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
        // ⚠️ The board is what GRANTS rights — President/Secretary of a year earn
        // that year, Executive Secretary earns all of them. So writing the board
        // for a year you don't hold is a straight privilege escalation: make
        // yourself President of 2024-25 and you have just awarded yourself 2024-25.
        var denied = await _guard.ClubYearAsync(User, clubId, dto.YearId);
        if (denied != null) return denied;

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
    [OwnedBy(Owns.BoardDirector, "id", "clubId")]
    public async Task<ActionResult> Update(int clubId, int id, [FromBody] UpdateBoardDirectorDto dto)
    {
        // Read the year from the RECORD, never from the request — otherwise a
        // caller could claim a year they hold and edit a record in one they don't.
        var scope = await _guard.LoadClubRecordScopeAsync("board_of_directors", "pk_board_director_id", id);
        if (scope is not var (recordClubId, recordYearId) || recordClubId == 0)
            return NotFound(new { message = "Board director not found." });
        if (recordClubId != clubId)
            return NotFound(new { message = "Board director not found in this club." });

        // BOTH years: the one it sits in, and the one it is being moved to.
        var denied = await _guard.ClubYearMoveAsync(User, clubId, recordYearId, dto.YearId);
        if (denied != null) return denied;

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
    [OwnedBy(Owns.BoardDirector, "id", "clubId")]
    public async Task<ActionResult> Delete(int clubId, int id)
    {
        var scope = await _guard.LoadClubRecordScopeAsync("board_of_directors", "pk_board_director_id", id);
        if (scope is not var (recordClubId, recordYearId) || recordClubId == 0)
            return NotFound(new { message = "Board director not found." });
        if (recordClubId != clubId)
            return NotFound(new { message = "Board director not found in this club." });

        var denied = await _guard.ClubYearAsync(User, clubId, recordYearId);
        if (denied != null) return denied;

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
        // Reordering rewrites the sort order of ONE year's board — dto.YearId is
        // passed straight to the service — so it is that year's rule, not the
        // current year's.
        var denied = await _guard.ClubYearAsync(User, clubId, dto.YearId);
        if (denied != null) return denied;

        if (!await RotaryApi.Services.KillSwitchHelper.IsClubDrillReachableAsync(_connectionString, clubId)) return StatusCode(403, new { message = "This club, its district, or its zone is inactive. Reactivate it first to access this data." });
        if (dto.OrderedIds == null || dto.OrderedIds.Count == 0) return BadRequest(new { message = "OrderedIds is required." });
        await _boardDirectorService.ReorderAsync(clubId, dto.YearId, dto.OrderedIds, GetUserId());
        _purger.PurgeByClub(clubId);
        return Ok(new { message = "Order updated successfully." });
    }

    /// <summary>
    /// A President, Secretary or Executive Secretary IS a Club Admin. This puts
    /// the role on them, the same as the Club Leadership screen does
    /// (ClubLeadershipController -> EnsureActiveClubAdminRoleAsync).
    ///
    /// ⚠️ Why it has to be here too: there are TWO ways to make someone
    /// President — that screen and this one — and only that one granted the
    /// role. The board row alone gives them the YEAR (AdminYearService reads
    /// board_of_directors live) but not the way IN, so they ended up holding
    /// rights to a dashboard they could not open. Found on a real account:
    /// Remove Admin had switched the role off, re-making them President through
    /// this screen changed nothing, and they were left a president with no
    /// access.
    ///
    /// Only the three rights-bearing designations qualify — the same ids
    /// AdminYearService grants years for. A Treasurer or a Director does not
    /// become an admin.
    ///
    /// ⚠️ Deliberately one-way: it never DEMOTES. Handing the presidency on does
    /// not strip the outgoing president, exactly as on the Club Leadership
    /// screen. Removing an admin stays a separate, deliberate action.
    /// </summary>
    private async Task EnsureOfficeHolderIsClubAdminAsync(int? memberId, int clubId, int designationId)
    {
        if (memberId is not int mid || mid <= 0 || clubId <= 0) return;
        if (designationId != AdminYearService.DesignationClubPresident
            && designationId != AdminYearService.DesignationClubSecretary
            && designationId != AdminYearService.DesignationClubExecutiveSecretary) return;

        await using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        await conn.OpenAsync();
        await ClubAdminAccessHelper.EnsureActiveClubAdminRoleAsync(conn, mid, clubId, GetUserId());
    }
}
