using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using System.Security.Claims;

namespace RotaryApi.Controllers;

// SuperAdmin-only, manually-triggered cleanup: revokes club-scoped RI-portal admin access
// (member_roles.fk_role_id = 2) from members whose only officer basis for it was a
// past-year Club President/Secretary term, unless they hold one of those posts for the
// same club in the CURRENT Rotary year.
[ApiController]
[Route("api/admin/ri-admin-cleanup")]
[Authorize]
public class RiAdminCleanupController : ControllerBase
{
    private const int ADMIN_ROLE_ID = 2;

    private readonly string _connectionString;

    public RiAdminCleanupController(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("DefaultConnection")!;
    }

    private MySqlConnection CreateConnection() => new(_connectionString);

    private bool IsSuperAdmin() => User.FindFirst("roles")?.Value?.Contains("SuperAdmin") == true;

    private int GetUserId()
    {
        var id = User.FindFirst("memberId")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(id, out var x) ? x : 0;
    }

    public class CleanupCandidate
    {
        public int ClubId { get; set; }
        public string? ClubName { get; set; }
        public string? DistrictNumber { get; set; }
        public int MemberId { get; set; }
        public string? MemberName { get; set; }
        public string? Email { get; set; }
        public string? PastRoles { get; set; }
    }

    // Single source of truth for both preview and execute — read-only.
    //
    // Candidates (b): DISTINCT (club, member) pairs holding Club President/Secretary in a
    // non-current year. Exception set (a): the same pairs for the current year — anyone in
    // (a) keeps their access. board_of_directors has no unique constraint on
    // (club, year, designation) and does contain duplicate active rows, so everything here
    // is set-membership / GROUP BY only.
    //
    // Year filters are deliberately asymmetric: a soft-deleted PAST year drops the member
    // from the candidate set, and the current-year exception ignores isdeleted — both lean
    // towards keeping access rather than revoking it by accident.
    //
    // yearOnly: when set, scopes candidates to that one past Rotary year only (still requires
    // IsCurrent = 0 as a safety guard, so the current year can never be targeted this way).
    // When null (the default), every non-current year is processed at once.
    private static async Task<List<CleanupCandidate>> FindRevocationCandidatesAsync(
        MySqlConnection conn, MySqlTransaction? tx = null, int? yearOnly = null)
    {
        var rows = await conn.QueryAsync<CleanupCandidate>(@"
            SELECT pb.fk_club_id                      AS ClubId,
                   c.ClubName                         AS ClubName,
                   d.DistrictNumber                   AS DistrictNumber,
                   pb.fk_member_master_profile_id     AS MemberId,
                   m.MemberName                       AS MemberName,
                   m.EmailId                          AS Email,
                   GROUP_CONCAT(DISTINCT CONCAT(dm.designation_name, ' (', COALESCE(py.YearLabel, CONCAT('year #', py.pk_year_id)), ')')
                                SEPARATOR ', ')       AS PastRoles
            FROM board_of_directors pb
            JOIN designation_master dm    ON dm.pk_designation_id = pb.fk_designation_id
            JOIN rotary_year_master py    ON py.pk_year_id = pb.fk_year_id
            JOIN club_master c            ON c.pk_club_id = pb.fk_club_id
            LEFT JOIN district_master d   ON d.pk_district_id = c.fk_district_id
            JOIN member_master_profile m  ON m.pk_member_master_profile_id = pb.fk_member_master_profile_id
            WHERE pb.isdeleted = 0
              AND pb.fk_club_id > 0
              AND dm.designation_name IN ('Club President', 'Club Secretary')
              AND py.IsCurrent = 0
              AND py.isdeleted = 0
              AND (@YearOnly IS NULL OR py.pk_year_id = @YearOnly)
              AND NOT EXISTS (
                    SELECT 1
                    FROM board_of_directors cb
                    JOIN designation_master cdm ON cdm.pk_designation_id = cb.fk_designation_id
                    JOIN rotary_year_master cy  ON cy.pk_year_id = cb.fk_year_id
                    WHERE cb.fk_club_id = pb.fk_club_id
                      AND cb.fk_member_master_profile_id = pb.fk_member_master_profile_id
                      AND cb.isdeleted = 0
                      AND cy.IsCurrent = 1
                      AND cdm.designation_name IN ('Club President', 'Club Secretary')
              )
              AND EXISTS (
                    SELECT 1
                    FROM member_roles mr
                    WHERE mr.fk_member_master_profile_id = pb.fk_member_master_profile_id
                      AND mr.fk_role_id = @AdminRoleId
                      AND mr.fk_club_id = pb.fk_club_id
                      AND mr.fk_club_id > 0
                      AND mr.IsActive = 1 AND mr.isdeleted = 0
              )
            GROUP BY pb.fk_club_id, c.ClubName, d.DistrictNumber,
                     pb.fk_member_master_profile_id, m.MemberName, m.EmailId
            ORDER BY d.DistrictNumber, c.ClubName, m.MemberName",
            new { AdminRoleId = ADMIN_ROLE_ID, YearOnly = yearOnly }, tx);

        return rows.ToList();
    }

    [HttpGet("preview")]
    public async Task<ActionResult> Preview([FromQuery] int? yearId = null)
    {
        if (!IsSuperAdmin()) return Forbid();

        using var conn = CreateConnection();
        await conn.OpenAsync();

        var candidates = await FindRevocationCandidatesAsync(conn, yearOnly: yearId);

        return Ok(new
        {
            count = candidates.Count,
            message = candidates.Count == 0
                ? "No past-officer admin access found to revoke."
                : $"{candidates.Count} club-admin grant(s) would be revoked. Nothing has been changed.",
            items = candidates
        });
    }

    [HttpPost("execute")]
    public async Task<ActionResult> Execute([FromQuery] int? yearId = null)
    {
        if (!IsSuperAdmin()) return Forbid();

        var userId = GetUserId();

        using var conn = CreateConnection();
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();
        try
        {
            var candidates = await FindRevocationCandidatesAsync(conn, tx, yearId);

            var revokedRows = 0;
            foreach (var candidate in candidates)
            {
                revokedRows += await conn.ExecuteAsync(@"
                    UPDATE member_roles
                    SET IsActive = 0, isdeleted = 1, RevokedDate = NOW(), RevokedBy = @UserId,
                        modified_by = @UserId, modified_date = NOW()
                    WHERE fk_member_master_profile_id = @MemberId
                      AND fk_role_id = @AdminRoleId
                      AND fk_club_id = @ClubId
                      AND fk_club_id > 0
                      AND IsActive = 1 AND isdeleted = 0",
                    new
                    {
                        candidate.MemberId,
                        candidate.ClubId,
                        AdminRoleId = ADMIN_ROLE_ID,
                        UserId = userId
                    }, tx);
            }

            await tx.CommitAsync();
            return Ok(new
            {
                success = true,
                count = candidates.Count,
                rowsRevoked = revokedRows,
                message = candidates.Count == 0
                    ? "No past-officer admin access found to revoke."
                    : $"Revoked club-admin access for {candidates.Count} member(s).",
                items = candidates
            });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            return BadRequest(new { message = $"Cleanup failed: {ex.Message}" });
        }
    }
}
