using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Escalation ladder (B.1 #32), target celebration (B.1 #35) and the Foundation giving link (Appendix B note).
    /// Additive only; same SQL in database/schema.sql. Runs after comm_settings and engagement_events exist.
    /// </summary>
    private static async Task EnsureEscalationCelebrationSchemaAsync(MySqlConnection connection)
    {
        // Per district: target_status 'red' or 'amber' (amber or red), NULL = target rule off; meeting_shortfall = how
        // many meetings below the rule a finished month must be, NULL = meeting rule off.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS escalation_rules (
                fk_district_id INT PRIMARY KEY,
                target_status VARCHAR(10) NULL,
                meeting_shortfall INT NULL,
                ag_delay_days INT NOT NULL DEFAULT 7,
                dg_delay_days INT NOT NULL DEFAULT 7,
                modified_by INT NULL,
                modified_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // One row per level sent (1 club president, 2 Assistant Governor, 3 District Governor). The UNIQUE key is the
        // claim written before sending, so a rerun or a second instance never alerts twice for a rule, club and period.
        // Recipient as at sending: fk_member_id NULL when nobody held the role or the DG is not a member (email only).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS escalation_alerts (
                pk_alert_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL,
                fk_club_id INT NOT NULL,
                rule_key VARCHAR(10) NOT NULL,
                period CHAR(7) NOT NULL,
                level TINYINT NOT NULL,
                fk_member_id INT NULL,
                recipient_name VARCHAR(200) NULL,
                reason VARCHAR(500) NOT NULL,
                email_status VARCHAR(20) NOT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_escalation_alert (fk_club_id, rule_key, period, level),
                KEY idx_escalation_district (fk_district_id, created_date),
                KEY idx_escalation_member (fk_member_id, created_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Target celebration: TARGET rows in engagement_events belong to a club, so the member is optional, and
        // target_key names the metric (growth, newMembers, dues, foundation). Backward compatible: older code never
        // writes NULL and joins members, so it skips TARGET rows.
        await AddColumnIfNotExists(connection, "engagement_events", "target_key", "VARCHAR(20) NULL");
        var memberNullable = await connection.ExecuteScalarAsync<string?>(@"
            SELECT IS_NULLABLE FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'engagement_events' AND COLUMN_NAME = 'fk_member_master_profile_id'");
        if (memberNullable == "NO")
            await connection.ExecuteAsync("ALTER TABLE engagement_events MODIFY COLUMN fk_member_master_profile_id INT NULL");

        // The district's Foundation giving link for {{foundation_link}} in greetings and milestone texts.
        await AddColumnIfNotExists(connection, "comm_settings", "foundation_giving_url", "VARCHAR(500) NULL");
    }
}
