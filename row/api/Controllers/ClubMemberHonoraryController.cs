using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace RotaryApi.Controllers;

// Per-club honorary toggle (moved off member_master_profile 2026-06-26 — see
// DatabaseInitializer for the schema migration). A member can be honorary in
// one club and regular in another, so the flag lives on club_members and is
// set per (clubId, memberId) pair.
//
// Access model per user spec:
//   • Web SuperAdmin  → can toggle (this PATCH endpoint)
//   • Web Club Admin  → read-only (the existing GET on club members listing
//                       already returns isHonorary from cm.IsHonoraryMember)
//   • Mobile           → read-only (same listing endpoint)
[ApiController]
[Route("api/clubs/{clubId:int}/members/{memberId:int}")]
[Authorize]
public class ClubMemberHonoraryController : ControllerBase
{
    private readonly string _connectionString;

    public ClubMemberHonoraryController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    // The JWT stores roles as a comma-separated string under the "roles" claim
    // (set by AuthService when the token is issued). User.IsInRole("SuperAdmin")
    // doesn't match because the role claim isn't on the ASP.NET default schema.
    // Mirror the pattern from DistrictGovernorController etc.
    private bool IsSuperAdmin() =>
        User.FindFirst("roles")?.Value?.Contains("SuperAdmin", StringComparison.OrdinalIgnoreCase) == true;

    public class UpdateHonoraryDto
    {
        public bool IsHonorary { get; set; }
    }

    // Read the current per-club honorary state. Used by the member-edit page to
    // show a read-only checkbox alongside the rest of the profile fields. Open
    // to any authenticated user — the value is not sensitive; write access is
    // still SuperAdmin-only (the PATCH below).
    [HttpGet("honorary-status")]
    public async Task<ActionResult> GetHonorary(int clubId, int memberId)
    {
        using var conn = CreateConnection();
        await conn.OpenAsync();

        var row = await conn.QueryFirstOrDefaultAsync<int?>(@"
            SELECT CAST(IsHonoraryMember AS UNSIGNED)
            FROM club_members
            WHERE fk_club_id = @ClubId
              AND fk_member_master_profile_id = @MemberId
              AND COALESCE(isdeleted, 0) = 0
            LIMIT 1",
            new { ClubId = clubId, MemberId = memberId });

        if (row == null)
            return NotFound(new { message = "Active club membership not found for that (club, member)." });

        return Ok(new { clubId, memberId, isHonorary = row.Value == 1 });
    }

    [HttpPatch("honorary-status")]
    public async Task<ActionResult> SetHonorary(int clubId, int memberId, [FromBody] UpdateHonoraryDto dto)
    {
        if (!IsSuperAdmin())
            return Forbid();
        if (dto == null) return BadRequest(new { message = "Body required." });

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var rows = await conn.ExecuteAsync(@"
            UPDATE club_members
            SET IsHonoraryMember = @IsHon,
                modified_date = NOW()
            WHERE fk_club_id = @ClubId
              AND fk_member_master_profile_id = @MemberId
              AND COALESCE(isdeleted, 0) = 0",
            new { ClubId = clubId, MemberId = memberId, IsHon = dto.IsHonorary ? 1 : 0 });

        if (rows == 0)
            return NotFound(new { message = "Active club membership not found for that (club, member)." });

        return Ok(new
        {
            clubId,
            memberId,
            isHonorary = dto.IsHonorary,
            message = dto.IsHonorary ? "Marked as Honorary." : "Unmarked Honorary."
        });
    }
}
