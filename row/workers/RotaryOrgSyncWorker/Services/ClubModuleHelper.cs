using Dapper;
using MySqlConnector;

namespace RotaryOrgSyncWorker.Services;

/// <summary>
/// Shared helpers for managing club_modules during sync operations.
///
/// On INSERT new club → call AssignDefaultClubModulesAsync to populate default modules.
/// On club termination/delete → call DeleteClubModulesAsync to clean up.
/// </summary>
public static class ClubModuleHelper
{
    /// <summary>
    /// Inserts default module rows into club_modules for the just-INSERTed club.
    /// Uses LAST_INSERT_ID() from the same connection to find the new club_id.
    /// Idempotent — INSERT IGNORE skips dups. Call immediately after INSERT INTO club_master.
    /// </summary>
    public static async Task AssignDefaultClubModulesAsync(MySqlConnection conn, MySqlTransaction? tx = null)
    {
        await conn.ExecuteAsync(@"
            INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy, AssignedDate)
            SELECT LAST_INSERT_ID(), pk_module_id, 1, 0, NOW()
            FROM module_master
            WHERE IsDefaultForClub = 1 AND ModuleLevel IN ('Club', 'Both') AND IsActive = 1 AND isdeleted = 0",
            transaction: tx);
    }

    /// <summary>
    /// Same as above but for an explicit clubId (use when LAST_INSERT_ID is not available — e.g., re-activation paths).
    /// </summary>
    public static async Task AssignDefaultClubModulesAsync(MySqlConnection conn, int clubId, MySqlTransaction? tx = null)
    {
        await conn.ExecuteAsync(@"
            INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy, AssignedDate)
            SELECT @ClubId, pk_module_id, 1, 0, NOW()
            FROM module_master
            WHERE IsDefaultForClub = 1 AND ModuleLevel IN ('Club', 'Both') AND IsActive = 1 AND isdeleted = 0",
            new { ClubId = clubId }, transaction: tx);
    }

    /// <summary>
    /// HARD-DELETE all club_modules rows for a soft-deleted/terminated club.
    /// club_modules has no isdeleted column — hard delete is the only option.
    /// Module assignments are derivable from module_master.IsDefaultForClub flags, so no audit value lost.
    /// </summary>
    public static async Task DeleteClubModulesAsync(MySqlConnection conn, int clubId, MySqlTransaction? tx = null)
    {
        await conn.ExecuteAsync(@"
            DELETE FROM club_modules WHERE fk_club_id = @ClubId",
            new { ClubId = clubId }, transaction: tx);
    }
}
