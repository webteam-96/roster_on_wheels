using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// District target setting (build spec B.29, Services/TargetProposals.cs). The district's managers propose; the
/// club's managers accept or counter; both read. Writes also pass the scope write guard for the URL's club or
/// district. Under .../targets, so the target_dashboard switch gates it.
/// </summary>
[ApiController]
[Authorize]
public class TargetProposalsController : ControllerBase
{
    private readonly string _cs;

    public TargetProposalsController(IConfiguration config) => _cs = config.GetConnectionString("DefaultConnection")!;

    public record ProposalDto(int Id, int ClubId, string ClubName, int YearId, string Metric, decimal ProposedValue,
        string Status, decimal? CounterValue, string? ClubNote, DateTime ProposedAt, DateTime? RespondedAt);
    public record ProposeDto(int ClubId, int? YearId, string Metric, decimal Value);
    public record CounterDto(decimal Value, string? Note);

    private int Me => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    private const string Select = @"
        SELECT p.pk_proposal_id AS Id, p.fk_club_id AS ClubId, c.ClubName, p.fk_year_id AS YearId, p.metric AS Metric,
               p.proposed_value AS ProposedValue, p.status AS Status, p.counter_value AS CounterValue,
               p.club_note AS ClubNote, p.proposed_at AS ProposedAt, p.responded_at AS RespondedAt
        FROM district_target_proposals p JOIN club_master c ON c.pk_club_id = p.fk_club_id";

    private static async Task<int?> YearAsync(MySqlConnection c, int? yearId) =>
        yearId is > 0 ? yearId : await PlanningAccess.CurrentYearAsync(c);

    [HttpGet("api/districts/{districtId:int}/targets/proposals")]
    public async Task<IActionResult> ForDistrict(int districtId, [FromQuery] int? yearId)
    {
        if (!await ScopeWriteGuardMiddleware.AllowedAsync(_cs, Me, false, districtId))
            return StatusCode(403, new { message = "Only the district's managers see its target proposals." });
        await using var c = new MySqlConnection(_cs);
        var y = await YearAsync(c, yearId);
        return Ok(await c.QueryAsync<ProposalDto>(Select + @"
            WHERE p.fk_district_id = @districtId AND p.fk_year_id = @y ORDER BY c.ClubName, p.metric", new { districtId, y }));
    }

    [HttpPut("api/districts/{districtId:int}/targets/proposals")]
    public async Task<IActionResult> Propose(int districtId, [FromBody] ProposeDto dto)
    {
        if (!await ScopeWriteGuardMiddleware.AllowedAsync(_cs, Me, false, districtId))
            return StatusCode(403, new { message = "Only the district's managers propose targets." });
        if (!TargetProposals.Metrics.Contains(dto.Metric)) return BadRequest(new { message = "Unknown target." });
        if (dto.Value is < 0 or > 99_999_999) return BadRequest(new { message = "The target is out of range." });
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        if (await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM club_master WHERE pk_club_id = @ClubId AND fk_district_id = @districtId AND isdeleted = 0",
                new { dto.ClubId, districtId }) == 0)
            return BadRequest(new { message = "Pick a club of this district." });
        var y = await YearAsync(c, dto.YearId);
        if (y == null) return BadRequest(new { message = "No current Rotary year." });
        // a new value restarts the conversation: the club answers it again
        await c.ExecuteAsync(@"
            INSERT INTO district_target_proposals (fk_district_id, fk_club_id, fk_year_id, metric, proposed_value, proposed_by)
            VALUES (@districtId, @ClubId, @y, @Metric, @Value, @Me)
            ON DUPLICATE KEY UPDATE proposed_value = VALUES(proposed_value), proposed_by = VALUES(proposed_by),
                proposed_at = NOW(), status = 'proposed', counter_value = NULL, club_note = NULL, responded_by = NULL, responded_at = NULL",
            new { districtId, dto.ClubId, y, dto.Metric, dto.Value, Me });
        return Ok(await c.QuerySingleAsync<ProposalDto>(Select + " WHERE p.fk_club_id = @ClubId AND p.fk_year_id = @y AND p.metric = @Metric",
            new { dto.ClubId, y, dto.Metric }));
    }

    [HttpGet("api/clubs/{clubId:int}/targets/proposals")]
    public async Task<IActionResult> ForClub(int clubId, [FromQuery] int? yearId)
    {
        if (!await ScopeWriteGuardMiddleware.ReadAllowedAsync(_cs, Me, true, clubId, members: false))
            return StatusCode(403, new { message = "Only the club's and district's managers see its target proposals." });
        await using var c = new MySqlConnection(_cs);
        var y = await YearAsync(c, yearId);
        return Ok(await c.QueryAsync<ProposalDto>(Select + " WHERE p.fk_club_id = @clubId AND p.fk_year_id = @y ORDER BY p.metric", new { clubId, y }));
    }

    [HttpPost("api/clubs/{clubId:int}/targets/proposals/{id:int}/accept")]
    public Task<IActionResult> Accept(int clubId, int id) => Respond(clubId, id, "accepted", null, null);

    [HttpPost("api/clubs/{clubId:int}/targets/proposals/{id:int}/counter")]
    public Task<IActionResult> Counter(int clubId, int id, [FromBody] CounterDto dto) =>
        dto.Value is < 0 or > 99_999_999 || dto.Note?.Length > 500
            ? Task.FromResult<IActionResult>(BadRequest(new { message = "Give a counter target in range and a note of 500 characters at most." }))
            : Respond(clubId, id, "countered", dto.Value, dto.Note?.Trim());

    private async Task<IActionResult> Respond(int clubId, int id, string status, decimal? counter, string? note)
    {
        if (!await ScopeWriteGuardMiddleware.AllowedAsync(_cs, Me, true, clubId))
            return StatusCode(403, new { message = "Only the club's managers answer its target proposals." });
        await using var c = new MySqlConnection(_cs);
        var n = await c.ExecuteAsync(@"
            UPDATE district_target_proposals SET status = @status, counter_value = @counter, club_note = NULLIF(@note, ''),
                responded_by = @Me, responded_at = NOW()
            WHERE pk_proposal_id = @id AND fk_club_id = @clubId", new { status, counter, note, Me, id, clubId });
        if (n == 0) return NotFound(new { message = "Proposal not found for this club." });
        return Ok(await c.QuerySingleAsync<ProposalDto>(Select + " WHERE p.pk_proposal_id = @id", new { id }));
    }
}
