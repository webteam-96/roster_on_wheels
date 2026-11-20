using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RotaryApi.DTOs;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// Job postings and business-to-business offers (Services/JobBoardService.cs, flag job_board). The app's routes act
/// for the signed-in member on the districts of their own clubs. The district routes need someone who manages the
/// district, reads included (ScopeWriteGuardMiddleware alone lets any member read). Members only: no public route.
/// </summary>
[ApiController]
[Authorize]
public class JobBoardController : ControllerBase
{
    private const string Mobile = "api/mobile/job-board", District = "api/districts/{districtId:int}/job-board";
    private readonly JobBoardService _board;
    private readonly string _connectionString;

    public JobBoardController(JobBoardService board, IConfiguration configuration)
    {
        _board = board;
        _connectionString = configuration.GetConnectionString("DefaultConnection")!;
    }

    private int MemberId => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private async Task<bool> ManagesAsync(int districtId) =>
        MemberId > 0 && await ScopeWriteGuardMiddleware.AllowedAsync(_connectionString, MemberId, false, districtId);

    private ObjectResult NotDistrictAdmin() => StatusCode(403, new { message = "Only the district's admins can review job board posts." });

    // ===== Members =====

    [HttpGet(Mobile)]
    public async Task<IActionResult> Browse([FromQuery] string? kind, [FromQuery] string? q) =>
        Ok(await _board.BrowseAsync(MemberId, string.IsNullOrWhiteSpace(kind) ? null : kind.Trim().ToLowerInvariant(), q));

    [HttpGet(Mobile + "/mine")]
    public async Task<IActionResult> Mine() => Ok(await _board.MineAsync(MemberId));

    [HttpPost(Mobile)]
    public async Task<IActionResult> Create([FromBody] SaveJobPostDto dto) => Ok(new { id = await _board.CreateAsync(MemberId, dto) });

    [HttpDelete(Mobile + "/{id:int}")]
    public async Task<IActionResult> Withdraw(int id) =>
        await _board.WithdrawAsync(MemberId, id) ? NoContent() : NotFound(new { message = "No open post of yours with that id." });

    [HttpPost(Mobile + "/{id:int}/report")]
    public async Task<IActionResult> Report(int id, [FromBody] JobPostReportBodyDto dto)
    {
        await _board.ReportAsync(MemberId, id, dto.Reason);
        return NoContent();
    }

    // ===== District admins =====

    [HttpGet(District)]
    public async Task<IActionResult> List(int districtId, [FromQuery] string? filter) =>
        await ManagesAsync(districtId) ? Ok(await _board.ListForDistrictAsync(districtId, filter ?? "pending")) : NotDistrictAdmin();

    [HttpPut(District + "/{id:int}/review")]
    public async Task<IActionResult> Review(int districtId, int id, [FromBody] JobPostReviewDto dto)
    {
        if (!await ManagesAsync(districtId)) return NotDistrictAdmin();
        await _board.ReviewAsync(districtId, id, dto, MemberId);
        return NoContent();
    }
}
