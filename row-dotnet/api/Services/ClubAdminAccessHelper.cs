using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Shared "may this member act as Club Admin for this club?" override, used as a fallback
/// in every club-admin ResolveClubIdAsync. Two cases only:
///
///   1. SuperAdmin — may open ANY club's dashboard (e.g. from /settings/global-search).
///      SuperAdmins hold no club-scoped Admin rows, so without this every club-admin
///      endpoint would 403 for them.
///   2. District Admin with all-clubs access (member_roles: fk_role_id=2, fk_district_id&gt;0,
///      fk_club_id NULL/0, AllClubsAccess=1) — may act as Club Admin for every club in
///      THEIR district only.
///
/// Nothing else is broadened: a plain district admin (AllClubsAccess=0) gets nothing here.
/// </summary>
public static class ClubAdminAccessHelper
{
    /// True when `memberId` holds an active SuperAdmin role.
    public static async Task<bool> IsSuperAdminAsync(MySqlConnection conn, int memberId)
    {
        if (memberId <= 0) return false;
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN roles r ON r.pk_role_id = mr.fk_role_id
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND r.RoleName = 'SuperAdmin'
              AND mr.IsActive = 1 AND mr.isdeleted = 0",
            new { MemberId = memberId });
        return count > 0;
    }

    /// Single entry point for club-admin scope overrides: SuperAdmin (any club) OR a
    /// District Admin with all-clubs access for that club's district.
    public static async Task<bool> CanOverrideClubAdminAsync(MySqlConnection conn, int memberId, int clubId)
        => await IsSuperAdminAsync(conn, memberId)
           || await IsDistrictAdminWithClubAccessAsync(conn, memberId, clubId);

    /// Returns true when `memberId` holds an active District-Admin row (with AllClubsAccess=1)
    /// for the district that owns `clubId`. Never touches other data.
    public static async Task<bool> IsDistrictAdminWithClubAccessAsync(MySqlConnection conn, int memberId, int clubId)
    {
        if (memberId <= 0 || clubId <= 0) return false;
        var count = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles mr
            JOIN club_master c ON c.pk_club_id = @ClubId AND c.isdeleted = 0
            WHERE mr.fk_member_master_profile_id = @MemberId
              AND mr.fk_role_id = 2
              AND mr.fk_district_id = c.fk_district_id
              AND (mr.fk_club_id IS NULL OR mr.fk_club_id = 0)
              AND mr.AllClubsAccess = 1
              AND mr.IsActive = 1 AND mr.isdeleted = 0",
            new { MemberId = memberId, ClubId = clubId });
        return count > 0;
    }

    /// Throws UnauthorizedAccessException unless `memberId` is an active Club Admin of
    /// `clubId` (fk_role_id=2, fk_club_id=this club) or a District Admin with
    /// AllClubsAccess=1 for this club's district. Same rule ClubAdminDashboardService.
    /// ResolveClubIdAsync uses for its `requestedClubId` branch — reused here as-is
    /// rather than duplicated, since credentials warrant the same strict ownership
    /// check as the dashboard.
    public static async Task EnsureClubAdminAsync(MySqlConnection conn, int memberId, int clubId)
    {
        var isDirectAdmin = await conn.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId
              AND fk_role_id = 2
              AND fk_club_id = @ClubId
              AND IsActive = 1 AND isdeleted = 0",
            new { MemberId = memberId, ClubId = clubId });

        if (isDirectAdmin > 0) return;
        if (await IsDistrictAdminWithClubAccessAsync(conn, memberId, clubId)) return;

        throw new UnauthorizedAccessException("You are not an active admin for this club.");
    }

    /// Self-healing grant: guarantees the member ends up with an active, NON-deleted Club-Admin
    /// (role 2) row for this club — no matter what state prior rows are in.
    ///
    /// Every grant path used to look up an existing row filtered by `isdeleted = 0`, then INSERT a
    /// fresh row when none was found. That missed SOFT-DELETED rows, so re-granting piled on
    /// duplicates and could leave the member with only broken rows (inactive, or active-but-deleted)
    /// — none of which satisfy the dashboard's strict `IsActive = 1 AND isdeleted = 0` check, giving
    /// "You are not an active admin for this club." This reactivates + undeletes EVERY existing
    /// (member, role 2, club) row and inserts one only if none exist at all. Idempotent.
    ///
    /// Only ever called from an explicit admin-grant action (SuperAdmin assign, BOD President/
    /// Secretary hook), so undeleting a previously-revoked row is the intended behaviour.
    public static async Task EnsureActiveClubAdminRoleAsync(MySqlConnection conn, int memberId, int clubId, int assignedBy, MySqlTransaction? tx = null)
    {
        // Newest existing role-2 row for this member+club, whatever state it is in.
        var keepPk = await conn.ExecuteScalarAsync<int?>(@"
            SELECT MAX(pk_member_role_id) FROM member_roles
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_club_id = @ClubId",
            new { MemberId = memberId, ClubId = clubId }, tx);

        if (keepPk == null)
        {
            // No row at all → insert exactly one clean active row.
            await conn.ExecuteAsync(@"
                INSERT INTO member_roles
                    (fk_member_master_profile_id, fk_role_id, fk_club_id, IsActive, isdeleted, AssignedBy, created_by, created_date)
                VALUES (@MemberId, 2, @ClubId, 1, 0, @By, @By, NOW())",
                new { MemberId = memberId, ClubId = clubId, By = assignedBy }, tx);
            return;
        }

        // Collapse to EXACTLY ONE active row: keep the newest (active + undeleted) and soft-delete
        // every other duplicate, so a member can never accumulate multiple active admin rows.
        await conn.ExecuteAsync(@"
            UPDATE member_roles
            SET IsActive    = CASE WHEN pk_member_role_id = @Keep THEN 1 ELSE 0 END,
                isdeleted   = CASE WHEN pk_member_role_id = @Keep THEN 0 ELSE 1 END,
                RevokedDate = CASE WHEN pk_member_role_id = @Keep THEN NULL ELSE NOW() END,
                RevokedBy   = CASE WHEN pk_member_role_id = @Keep THEN NULL ELSE @By END,
                modified_by = @By, modified_date = NOW()
            WHERE fk_member_master_profile_id = @MemberId AND fk_role_id = 2 AND fk_club_id = @ClubId",
            new { MemberId = memberId, ClubId = clubId, Keep = keepPk.Value, By = assignedBy }, tx);
    }
}
