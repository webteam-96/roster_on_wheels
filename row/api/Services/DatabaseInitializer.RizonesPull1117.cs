using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// RIZones pull 9-17 Nov 2026 (MD_files/dues_channel_currency_flags + rotary_org_sync_club_scope), ROW form.
    /// Additive only. Dues: NotifyEmail (1 = email members) and Currency (ISO code, NULL = instance default; RIZones'
    /// NotifyWhatsApp is not added, ROW has no WhatsApp). Rotary.org sync: fk_club_id (0 = district row, as every
    /// existing row) so a club can sync itself. Down: database/maintenance/2026-11-19-rizones-pull-1117-down.sql.
    /// </summary>
    private static async Task EnsureRizonesPull1117SchemaAsync(MySqlConnection connection)
    {
        foreach (var table in new[] { "membership_dues", "club_dues" })
        {
            if (!await TableExistsAsync(connection, table)) continue;
            await AddColumnIfNotExists(connection, table, "NotifyEmail", "TINYINT(1) NOT NULL DEFAULT 1");
            await AddColumnIfNotExists(connection, table, "Currency", "VARCHAR(3) NULL");
        }

        if (await TableExistsAsync(connection, "rotary_org_sync_logins"))
        {
            await AddColumnIfNotExists(connection, "rotary_org_sync_logins", "fk_club_id", "INT NOT NULL DEFAULT 0 AFTER fk_district_id");
            await CreateIndexIfNotExists(connection, "rotary_org_sync_logins", "ix_rosl_club",
                "CREATE INDEX ix_rosl_club ON rotary_org_sync_logins (fk_club_id, isdeleted)");
        }
        if (await TableExistsAsync(connection, "rotary_org_sync_requests"))
        {
            await AddColumnIfNotExists(connection, "rotary_org_sync_requests", "fk_club_id", "INT NOT NULL DEFAULT 0 AFTER fk_district_id");
            await CreateIndexIfNotExists(connection, "rotary_org_sync_requests", "ix_rosr_club",
                "CREATE INDEX ix_rosr_club ON rotary_org_sync_requests (fk_club_id, pk_id)");
        }
    }

    /// <summary>
    /// RIZones goal module restored 2026-11-20 (owner): per-category goal locks and the one-to-one / group goal
    /// messages read these tables. They were on the 2026-10-23 drop list but never dropped, so on existing databases
    /// this is a no-op; a fresh database gets them empty (no Goal Setting Roles screen in ROW, so no role rows).
    /// The message tables themselves (goal_direct_messages, goal_group_messages, goal_group_message_reads) are
    /// created on first use by the message service, as upstream does.
    /// </summary>
    private static async Task EnsureGoalModuleSchemaAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS goal_locks (
                pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                EntityType VARCHAR(10) NOT NULL,
                fk_club_id INT NOT NULL DEFAULT 0,
                fk_district_id INT NOT NULL DEFAULT 0,
                fk_category_id INT NOT NULL,
                fk_year_id INT NOT NULL,
                IsLocked TINYINT(1) NOT NULL DEFAULT 0,
                LockedBy INT NULL,
                LockedDate DATETIME NULL,
                UnlockedBy INT NULL,
                UnlockedDate DATETIME NULL,
                UNIQUE KEY uk_goal_lock (EntityType, fk_club_id, fk_district_id, fk_category_id, fk_year_id),
                FOREIGN KEY (fk_category_id) REFERENCES goal_categories(pk_category_id),
                FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS goal_role_assignments (
                pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                fk_member_id INT NOT NULL,
                MemberNameText VARCHAR(200) NULL,
                RoleType VARCHAR(50) NOT NULL,
                AssignmentName VARCHAR(200) NOT NULL,
                RoleTitle VARCHAR(150) NULL,
                Avenue VARCHAR(100) NULL,
                fk_category_id INT NULL,
                fk_zone_id INT NULL,
                HomeDistrictId INT NULL,
                DgYear VARCHAR(40) NULL,
                SupportingText VARCHAR(255) NULL,
                IsActive TINYINT(1) NOT NULL DEFAULT 1,
                AssignedBy INT NULL,
                AssignedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
                RoleEmailSentDate DATETIME NULL,
                RevokedBy INT NULL,
                RevokedDate DATETIME NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                INDEX idx_goal_role_member (fk_member_id, IsActive),
                FOREIGN KEY (fk_category_id) REFERENCES goal_categories(pk_category_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS goal_role_assignment_districts (
                pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                fk_assignment_id INT NOT NULL,
                fk_district_id INT NOT NULL,
                UNIQUE KEY uk_goal_role_assignment_district (fk_assignment_id, fk_district_id),
                FOREIGN KEY (fk_assignment_id) REFERENCES goal_role_assignments(pk_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS goal_role_assignment_zones (
                pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                fk_assignment_id INT NOT NULL,
                fk_zone_id INT NOT NULL,
                UNIQUE KEY uk_goal_role_assignment_zone (fk_assignment_id, fk_zone_id),
                FOREIGN KEY (fk_assignment_id) REFERENCES goal_role_assignments(pk_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    private static async Task<bool> TableExistsAsync(MySqlConnection connection, string table) =>
        await connection.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @T",
            new { T = table }) > 0;
}
