using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Website extras (Services/WebsiteExtrasService.cs): social feed embeds and the Google Analytics ID of a club or
    /// district website, one row per site. Additive only; undo: DROP TABLE website_extras.
    /// </summary>
    private static async Task EnsureWebsiteExtrasTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS website_extras (
                scope VARCHAR(10) NOT NULL,
                owner_id INT NOT NULL,
                facebook_page_url VARCHAR(300) NULL,
                instagram_username VARCHAR(30) NULL,
                x_username VARCHAR(15) NULL,
                ga_measurement_id VARCHAR(20) NULL,
                updated_by INT NULL,
                updated_at_utc DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                PRIMARY KEY (scope, owner_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
