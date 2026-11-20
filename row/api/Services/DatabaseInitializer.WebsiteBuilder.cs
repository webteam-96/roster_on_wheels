using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Website builder (Controllers/WebsitePagesController.cs): custom pages and home layouts with a draft and a
    /// published copy, the site media library, and the "Pages and Layout" tile on the club Website Data screen.
    /// Additive only. Undo: DROP TABLE website_pages, website_media; DELETE FROM website_data_module_master WHERE module_key = 'pages'.
    /// </summary>
    private static async Task EnsureWebsiteBuilderTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS website_pages (
                pk_website_page_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                owner_type VARCHAR(10) NOT NULL,
                owner_id INT NOT NULL,
                slug VARCHAR(60) NOT NULL,
                title VARCHAR(200) NOT NULL,
                sections_json MEDIUMTEXT NOT NULL,
                published_title VARCHAR(200) NULL,
                published_sections_json MEDIUMTEXT NULL,
                published_at DATETIME NULL,
                created_by INT NULL,
                created_at DATETIME NOT NULL,
                updated_by INT NULL,
                updated_at DATETIME NOT NULL,
                UNIQUE KEY uq_website_pages_slug (owner_type, owner_id, slug)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS website_media (
                pk_website_media_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                owner_type VARCHAR(10) NOT NULL,
                owner_id INT NOT NULL,
                url VARCHAR(500) NOT NULL,
                file_name VARCHAR(255) NOT NULL,
                created_by INT NULL,
                created_at DATETIME NOT NULL,
                KEY idx_website_media_owner (owner_type, owner_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // Members-only pages and files (additive columns). Undo: ALTER TABLE ... DROP COLUMN members_only / content_type.
        await AddWebsiteBuilderColumnAsync(connection, "website_pages", "members_only", "TINYINT(1) NOT NULL DEFAULT 0");
        await AddWebsiteBuilderColumnAsync(connection, "website_media", "members_only", "TINYINT(1) NOT NULL DEFAULT 0");
        await AddWebsiteBuilderColumnAsync(connection, "website_media", "content_type", "VARCHAR(100) NULL");
        await connection.ExecuteAsync(@"
            INSERT INTO website_data_module_master (module_name, module_key, icon_class, sort_order, isdeleted)
            SELECT 'Pages and Layout', 'pages', 'LayoutGrid', 9, 0 FROM DUAL
            WHERE NOT EXISTS (SELECT 1 FROM website_data_module_master WHERE module_key = 'pages')");
    }

    /// <summary>Table and column names are constants above, never input.</summary>
    private static async Task AddWebsiteBuilderColumnAsync(MySqlConnection connection, string table, string column, string definition)
    {
        var exists = await connection.ExecuteScalarAsync<int>(@"
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @T AND COLUMN_NAME = @C", new { T = table, C = column });
        if (exists == 0) await connection.ExecuteAsync($"ALTER TABLE `{table}` ADD COLUMN `{column}` {definition}");
    }
}
