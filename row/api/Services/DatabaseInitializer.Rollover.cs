using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Year-end rollover (Services/YearRolloverService.cs). A run is the snapshot of one apply: every row it
    /// inserted is an item, so undo soft-deletes exactly those rows. Additive only.
    /// </summary>
    private static async Task EnsureRolloverTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS year_rollover_run (
                pk_run_id INT AUTO_INCREMENT PRIMARY KEY,
                scope VARCHAR(10) NOT NULL,
                scope_id INT NOT NULL,
                from_year_id INT NOT NULL,
                to_year_id INT NOT NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'applied',
                summary_json TEXT NULL,
                created_by INT NULL,
                created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                undone_by INT NULL,
                undone_date DATETIME NULL,
                KEY idx_yrr_scope (scope, scope_id, to_year_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS year_rollover_item (
                pk_item_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_run_id INT NOT NULL,
                kind VARCHAR(20) NOT NULL,
                source_id INT NOT NULL DEFAULT 0,
                target_table VARCHAR(60) NOT NULL,
                target_id INT NOT NULL,
                KEY idx_yri_run (fk_run_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
