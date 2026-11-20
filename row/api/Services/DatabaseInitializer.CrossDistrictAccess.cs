using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Time-limited cross-district access (Services/CrossDistrictAccess.cs). Times are UTC. Rows are never deleted:
    /// a revoke stamps revoked_at_utc. Additive only. Undo: DROP TABLE district_access_grants.
    /// </summary>
    private static async Task EnsureCrossDistrictAccessTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS district_access_grants (
                pk_grant_id     INT AUTO_INCREMENT PRIMARY KEY,
                fk_member_id    INT NOT NULL,
                fk_district_id  INT NOT NULL,
                can_write       TINYINT(1) NOT NULL DEFAULT 0,
                purpose         VARCHAR(20) NOT NULL,
                note            VARCHAR(500) NULL,
                starts_at_utc   DATETIME NOT NULL,
                expires_at_utc  DATETIME NOT NULL,
                granted_by      INT NOT NULL,
                granted_at_utc  DATETIME NOT NULL,
                revoked_at_utc  DATETIME NULL,
                revoked_by      INT NULL,
                revoke_reason   VARCHAR(500) NULL,
                INDEX idx_dag_member_district (fk_member_id, fk_district_id, expires_at_utc),
                INDEX idx_dag_district (fk_district_id),
                INDEX idx_dag_expires (expires_at_utc)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
