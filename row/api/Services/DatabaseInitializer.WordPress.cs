using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// WordPress connector (gap agent): read-only website API keys for a club or district, and the per-document
    /// "public on website" switch. Additive only. Undo: DROP TABLE website_api_keys;
    /// ALTER TABLE club_documents DROP COLUMN IsPublicOnWebsite.
    /// </summary>
    private static async Task EnsureWordPressConnectorSchemaAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS website_api_keys (
                pk_website_api_key_id INT AUTO_INCREMENT PRIMARY KEY,
                scope_type   VARCHAR(10)  NOT NULL,
                scope_id     INT          NOT NULL,
                label        VARCHAR(100) NOT NULL,
                key_prefix   VARCHAR(16)  NOT NULL,
                key_hash     CHAR(64)     NOT NULL,
                created_by   INT          NULL,
                created_utc  DATETIME     NOT NULL,
                last_used_utc DATETIME    NULL,
                revoked_utc  DATETIME     NULL,
                UNIQUE KEY ux_website_api_keys_hash (key_hash),
                INDEX idx_website_api_keys_scope (scope_type, scope_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        var hasColumn = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'club_documents' AND COLUMN_NAME = 'IsPublicOnWebsite'");
        if (hasColumn == 0)
            await connection.ExecuteAsync(
                "ALTER TABLE club_documents ADD COLUMN IsPublicOnWebsite TINYINT(1) NOT NULL DEFAULT 0");
    }
}
