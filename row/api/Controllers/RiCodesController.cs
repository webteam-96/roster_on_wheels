using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using RotaryApi.Services;

namespace RotaryApi.Controllers;

/// <summary>
/// RI fields (build spec 3.12): the ri_codes lists (read by any signed-in user for the member forms, kept by Super
/// Admin) and each membership's RI member type and join / termination reason codes. Club writes also pass the
/// scope write guard (a manager of that club).
/// </summary>
[ApiController]
[Authorize]
public class RiCodesController : ControllerBase
{
    private readonly string _cs;

    public RiCodesController(IConfiguration config) => _cs = config.GetConnectionString("DefaultConnection")!;

    public record RiCodeDto(int Id, string Kind, string Code, string Label, int SortOrder);
    public record SaveRiCodeDto(string Kind, string Code, string Label, int SortOrder);
    public record MembershipRiFieldsDto(string? RiMemberType, string? JoinReasonCode, string? TerminationReasonCode);

    private bool IsSuperAdmin => (User.FindFirst("roles")?.Value ?? "").Split(',').Select(r => r.Trim()).Contains("SuperAdmin");
    private int Me => int.TryParse(User.FindFirst("memberId")?.Value, out var id) ? id : 0;

    [HttpGet("api/ri-codes")]
    public async Task<IActionResult> List()
    {
        await using var c = new MySqlConnection(_cs);
        return Ok(await c.QueryAsync<RiCodeDto>(@"
            SELECT pk_ri_code_id AS Id, kind AS Kind, code AS Code, label AS Label, sort_order AS SortOrder
            FROM ri_codes WHERE isdeleted = 0 ORDER BY kind, sort_order, label"));
    }

    [HttpPost("api/ri-codes")]
    public Task<IActionResult> Create([FromBody] SaveRiCodeDto dto) => Save(null, dto);

    [HttpPut("api/ri-codes/{id:int}")]
    public Task<IActionResult> Update(int id, [FromBody] SaveRiCodeDto dto) => Save(id, dto);

    private async Task<IActionResult> Save(int? id, SaveRiCodeDto dto)
    {
        if (!IsSuperAdmin) return StatusCode(403, new { message = "Only Super Admin can change the RI lists." });
        var code = dto.Code?.Trim() ?? "";
        var label = dto.Label?.Trim() ?? "";
        if (!RiCodes.Kinds.Contains(dto.Kind)) return BadRequest(new { message = "Unknown list." });
        if (code.Length is 0 or > 40 || label.Length is 0 or > 150)
            return BadRequest(new { message = "Give a code (40 characters at most) and a label (150 at most)." });
        await using var c = new MySqlConnection(_cs);
        if (await c.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM ri_codes WHERE kind = @Kind AND code = @code
                AND isdeleted = 0 AND pk_ri_code_id <> IFNULL(@id, 0)", new { dto.Kind, code, id }) > 0)
            return Conflict(new { message = "That code is already in the list." });
        if (id == null)
        {
            // a deleted entry with the same code comes back instead of a duplicate row
            var newId = await c.ExecuteScalarAsync<int>(@"
                INSERT INTO ri_codes (kind, code, label, sort_order, modified_by) VALUES (@Kind, @code, @label, @SortOrder, @Me)
                ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order), isdeleted = 0,
                    modified_by = VALUES(modified_by), pk_ri_code_id = LAST_INSERT_ID(pk_ri_code_id);
                SELECT LAST_INSERT_ID();", new { dto.Kind, code, label, dto.SortOrder, Me });
            return Ok(new { id = newId });
        }
        var n = await c.ExecuteAsync(@"UPDATE ri_codes SET code = @code, label = @label, sort_order = @SortOrder, modified_by = @Me
            WHERE pk_ri_code_id = @id AND kind = @Kind AND isdeleted = 0", new { id, dto.Kind, code, label, dto.SortOrder, Me });
        return n == 0 ? NotFound(new { message = "Entry not found." }) : Ok(new { id });
    }

    [HttpDelete("api/ri-codes/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        if (!IsSuperAdmin) return StatusCode(403, new { message = "Only Super Admin can change the RI lists." });
        await using var c = new MySqlConnection(_cs);
        var n = await c.ExecuteAsync("UPDATE ri_codes SET isdeleted = 1, modified_by = @Me WHERE pk_ri_code_id = @id AND isdeleted = 0", new { id, Me });
        return n == 0 ? NotFound(new { message = "Entry not found." }) : NoContent();
    }

    [HttpGet("api/clubs/{clubId:int}/members/{memberId:int}/ri-fields")]
    public async Task<IActionResult> GetMembership(int clubId, int memberId)
    {
        await using var c = new MySqlConnection(_cs);
        if (!await ScopeWriteGuardMiddleware.ReadAllowedAsync(_cs, Me, true, clubId))
            return StatusCode(403, new { message = "You do not have access to this club." });
        var row = await c.QueryFirstOrDefaultAsync<MembershipRiFieldsDto>(@"
            SELECT ri_member_type AS RiMemberType, join_reason_code AS JoinReasonCode, termination_reason_code AS TerminationReasonCode
            FROM club_members WHERE fk_club_id = @clubId AND fk_member_master_profile_id = @memberId
            ORDER BY isdeleted, pk_club_member_id DESC LIMIT 1", new { clubId, memberId });
        return row == null ? NotFound(new { message = "Not a member of this club." }) : Ok(row);
    }

    /// <summary>The member type and join reason of the current membership (the termination code comes with the removal).</summary>
    [HttpPut("api/clubs/{clubId:int}/members/{memberId:int}/ri-fields")]
    public async Task<IActionResult> SetMembership(int clubId, int memberId, [FromBody] MembershipRiFieldsDto dto)
    {
        await using var c = new MySqlConnection(_cs);
        await c.OpenAsync();
        if (!await RiCodes.IsValidAsync(c, "member_type", dto.RiMemberType) || !await RiCodes.IsValidAsync(c, "join_reason", dto.JoinReasonCode))
            return BadRequest(new { message = "Pick a member type and join reason from the RI lists." });
        var n = await c.ExecuteAsync(@"
            UPDATE club_members SET ri_member_type = NULLIF(@RiMemberType, ''), join_reason_code = NULLIF(@JoinReasonCode, ''),
                modified_by = @Me, modified_date = NOW()
            WHERE fk_club_id = @clubId AND fk_member_master_profile_id = @memberId AND isdeleted = 0",
            new { dto.RiMemberType, dto.JoinReasonCode, Me, clubId, memberId });
        return n == 0 ? NotFound(new { message = "Not a current member of this club." }) : Ok(dto with { TerminationReasonCode = null });
    }
}
