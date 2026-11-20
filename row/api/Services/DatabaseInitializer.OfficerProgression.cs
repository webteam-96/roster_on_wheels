using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Officer progression (Services/OfficerProgressionService.cs). A named President-Nominee / DG-Nominee and the
    /// four suggested steps of the chain, each waiting for an admin to confirm or dismiss it.
    /// Additive only. Undo: DROP TABLE officer_progression_step; DROP TABLE officer_progression;
    /// </summary>
    private static async Task EnsureOfficerProgressionTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS officer_progression (
                pk_progression_id INT AUTO_INCREMENT PRIMARY KEY,
                scope VARCHAR(10) NOT NULL,
                scope_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                nominee_start_year INT NOT NULL,
                created_by INT NULL,
                created_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                deleted_by INT NULL,
                deleted_date DATETIME NULL,
                INDEX idx_op_scope (scope, scope_id, isdeleted)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS officer_progression_step (
                pk_step_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_progression_id INT NOT NULL,
                role VARCHAR(8) NOT NULL,
                start_year INT NOT NULL,
                status VARCHAR(12) NOT NULL DEFAULT 'pending',
                applied_ref VARCHAR(60) NULL,
                decided_by INT NULL,
                decided_date DATETIME NULL,
                UNIQUE KEY uq_ops_role (fk_progression_id, role),
                INDEX idx_ops_year (start_year, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
