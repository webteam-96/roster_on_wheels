using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Contacts export, duplicate merge and Friends of the club (gap agent, 2026-11-19). Additive only.
public partial class DatabaseInitializer
{
    private static async Task EnsureContactToolsSchemaAsync(MySqlConnection connection)
    {
        // One row per contact folded into another: what the merged contact held, so the merge can be traced.
        // Deleted with the surviving contact (its personal data, nothing to keep after that).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS contact_merge_log (
                pk_merge_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL DEFAULT 0,
                fk_district_id INT NOT NULL DEFAULT 0,
                fk_survivor_contact_id INT NOT NULL,
                merged_contact_id INT NOT NULL,
                merged_snapshot TEXT NOT NULL,
                field_sources VARCHAR(500) NULL,
                merged_by INT NULL,
                merged_date_utc DATETIME NOT NULL,
                INDEX idx_contact_merge_survivor (fk_survivor_contact_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // 'friends': the group the API keeps equal to the owner's Friends of the club, so friends are a mass email
        // and event invite list without any change to Mass Email.
        await AddColumnIfNotExists(connection, "contact_groups", "system_key", "VARCHAR(20) NULL");
    }
}
