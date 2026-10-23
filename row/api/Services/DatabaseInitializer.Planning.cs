using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Planning mode, elect access and cut-over (ROW build spec 3.1, Services/PlanningService.cs). Additive only;
    /// same SQL in database/schema.sql (tables) and database/schema-drift.sql (tenant_subscriptions columns).
    /// </summary>
    private static async Task EnsurePlanningTablesAsync(MySqlConnection connection)
    {
        // The year being planned, the scheduled and actual cut-over (UTC), the year archived by the cut-over,
        // and the end of a 60-day trial (NULL = paid or never a trial).
        await AddColumnIfNotExists(connection, "tenant_subscriptions", "planning_year_id", "INT NULL");
        await AddColumnIfNotExists(connection, "tenant_subscriptions", "cutover_at", "DATETIME NULL");
        await AddColumnIfNotExists(connection, "tenant_subscriptions", "cutover_done_at", "DATETIME NULL");
        await AddColumnIfNotExists(connection, "tenant_subscriptions", "archived_year_id", "INT NULL");
        await AddColumnIfNotExists(connection, "tenant_subscriptions", "trial_ends", "DATE NULL");

        // Elect roles for the year being planned: DGE, DS (secretary), DT (treasurer) on the district
        // (fk_club_id = 0); PE, SE on their club. live = 1 until revoked (then NULL), so the unique key keeps one
        // live row per role while revoked rows stay as history.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS planning_roles (
                pk_planning_role_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL,
                fk_club_id INT NOT NULL DEFAULT 0,
                fk_year_id INT NOT NULL,
                role_code VARCHAR(3) NOT NULL,
                fk_member_id INT NOT NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'invited',
                source VARCHAR(10) NOT NULL,
                live TINYINT(1) NULL DEFAULT 1,
                token_hash CHAR(64) NULL,
                token_expires DATETIME NULL,
                email_sent_at DATETIME NULL,
                accepted_at DATETIME NULL,
                activated_at DATETIME NULL,
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by INT NULL,
                modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_planning_role (fk_district_id, fk_club_id, fk_year_id, role_code, live),
                KEY idx_planning_role_member (fk_member_id, status),
                KEY idx_planning_role_token (token_hash)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // RI steps of a cut-over, queued for the RI outbound path (spec 3.2). Nothing sends them yet.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS ri_outbound_queue (
                pk_outbound_id INT AUTO_INCREMENT PRIMARY KEY,
                kind VARCHAR(20) NOT NULL,
                fk_district_id INT NOT NULL,
                fk_club_id INT NOT NULL DEFAULT 0,
                fk_year_id INT NOT NULL,
                ref_id INT NOT NULL DEFAULT 0,
                fk_member_id INT NULL,
                ri_title VARCHAR(30) NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'queued',
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_ri_outbound (kind, fk_district_id, fk_club_id, fk_year_id, ref_id),
                KEY idx_ri_outbound_status (status, created_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
