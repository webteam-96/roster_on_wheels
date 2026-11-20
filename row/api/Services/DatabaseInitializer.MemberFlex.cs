using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Member flexibility (gap agent, 2026-11-19): club tags on members and contacts, custom profile fields, smart lists.
// Additive only: CREATE TABLE IF NOT EXISTS, nothing is dropped.
public partial class DatabaseInitializer
{
    private static async Task EnsureMemberFlexSchemaAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_tags (
                pk_club_tag_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                name VARCHAR(50) NOT NULL,
                color CHAR(7) NOT NULL DEFAULT '#17458F',
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_club_tags_name (fk_club_id, name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // entity_type 'member' -> member_master_profile id, 'contact' -> contacts id.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_tag_assignments (
                fk_club_tag_id INT NOT NULL,
                entity_type VARCHAR(10) NOT NULL,
                entity_id INT NOT NULL,
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (fk_club_tag_id, entity_type, entity_id),
                INDEX idx_cta_entity (entity_type, entity_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_profile_fields (
                pk_profile_field_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                label VARCHAR(100) NOT NULL,
                field_type VARCHAR(10) NOT NULL,
                options_json TEXT NULL,
                visibility VARCHAR(10) NOT NULL DEFAULT 'admins',
                sort_order INT NOT NULL DEFAULT 0,
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_club_profile_fields_label (fk_club_id, label)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_profile_values (
                fk_profile_field_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                value VARCHAR(1000) NOT NULL,
                modified_by INT NULL,
                modified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (fk_profile_field_id, fk_member_id),
                INDEX idx_cpv_member (fk_member_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_smart_lists (
                pk_smart_list_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                name VARCHAR(100) NOT NULL,
                filter_json TEXT NOT NULL,
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_date DATETIME NULL,
                UNIQUE KEY uk_club_smart_lists_name (fk_club_id, name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
