using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Mass email compose upgrades (2026-11-19): saved templates, per-sender signatures, campaign attachments. Additive only.
public partial class DatabaseInitializer
{
    private static async Task EnsureMassEmailComposeSchemaAsync(MySqlConnection connection)
    {
        // Owner is a club (fk_district_id = 0) or a district (fk_club_id = 0).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS mass_email_templates (
                pk_template_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL DEFAULT 0,
                fk_district_id INT NOT NULL DEFAULT 0,
                Name VARCHAR(120) NOT NULL,
                Subject VARCHAR(300) NOT NULL DEFAULT '',
                BodyHtml MEDIUMTEXT NULL,
                created_by INT NULL,
                created_date DATETIME NULL,
                modified_by INT NULL,
                modified_date DATETIME NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                INDEX idx_met_owner (fk_club_id, fk_district_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS mass_email_signatures (
                fk_member_id INT NOT NULL PRIMARY KEY,
                SignatureHtml TEXT NULL,
                modified_date DATETIME NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Files live in App_Data/mass-email-files/<StoredName>, outside wwwroot.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS mass_email_attachments (
                pk_attachment_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_mass_email_id INT NOT NULL,
                FileName VARCHAR(200) NOT NULL,
                StoredName VARCHAR(80) NOT NULL,
                ContentType VARCHAR(120) NOT NULL,
                SizeBytes INT NOT NULL,
                created_by INT NULL,
                created_date DATETIME NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                INDEX idx_mea_email (fk_mass_email_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
