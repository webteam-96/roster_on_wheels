using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

/// <summary>
/// Non-sync cascade login guard (Phase 2).
///
/// When a club goes non-sync, its members are soft-deleted from club_members (and other
/// club-scoped tables) but their member_master_profile / credentials are kept. A member
/// whose ONLY club went non-sync therefore has no active club membership and must not be
/// able to log in — until the club re-syncs or they're added elsewhere.
///
/// Allowed to log in if ANY of:
///   • has at least one ACTIVE club_members row (isdeleted=0, IsActive=1), OR
///   • has any membership in an EXEMPT district (5656 / 1280 / IFRM India — never cascaded), OR
///   • holds an active non-club-scoped role (SuperAdmin / ZonalCoordinator / RIDirector) —
///     those roles survive the cascade and must never be locked out.
/// Otherwise → denied.
///
/// Deliberately does NOT exempt club-scoped roles (Admin / ClubModerator / AG / Member) —
/// those are soft-deleted with the club, so a club admin whose club went non-sync is blocked.
/// </summary>
public static class NonSyncLoginGuardHelper
{
    // Must match ClubNonSyncCascadeWorker.ExemptDistrictNumbers.
    private static string[] ExemptDistrictNumbers => RotaryApi.Services.Brand.ExemptDistricts;   // ROW: Brand:Scope:ExemptDistricts

    public const string DeniedMessage =
        "Your club is no longer active. Please contact your district administrator.";

    /// <summary>Returns true if the member is allowed to log in per the non-sync rules.</summary>
    public static async Task<bool> IsLoginAllowedAsync(MySqlConnection conn, int memberId)
    {
        var r = await conn.QueryFirstAsync<(int activeClubs, int exemptClubs, int globalRoles)>(@"
            SELECT
              (SELECT COUNT(*) FROM club_members cm
                 WHERE cm.fk_member_master_profile_id = @Id
                   AND cm.isdeleted = 0 AND IFNULL(cm.IsActive, 1) = 1) AS activeClubs,
              (SELECT COUNT(*) FROM club_members cm
                 JOIN club_master c   ON c.pk_club_id = cm.fk_club_id
                 JOIN district_master d ON d.pk_district_id = c.fk_district_id
                 WHERE cm.fk_member_master_profile_id = @Id
                   AND d.DistrictNumber IN @Exempt) AS exemptClubs,
              (SELECT COUNT(*) FROM member_roles mr
                 JOIN roles r ON r.pk_role_id = mr.fk_role_id
                 WHERE mr.fk_member_master_profile_id = @Id
                   AND mr.IsActive = 1 AND mr.isdeleted = 0
                   AND r.RoleName IN ('SuperAdmin','ZonalCoordinator','RIDirector')) AS globalRoles",
            new { Id = memberId, Exempt = ExemptDistrictNumbers });

        return r.activeClubs > 0 || r.exemptClubs > 0 || r.globalRoles > 0;
    }

    /// <summary>Throws UnauthorizedAccessException(DeniedMessage) if the member may not log in.</summary>
    public static async Task EnsureCanLoginAsync(MySqlConnection conn, int memberId)
    {
        if (!await IsLoginAllowedAsync(conn, memberId))
            throw new UnauthorizedAccessException(DeniedMessage);
    }
}
