using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// N3 contacts, prospects, growth, invite prompts (2026-10-23). Additive only; mirrored in row/database/schema.sql.
public partial class DatabaseInitializer
{
    private static async Task EnsureContactsGrowthSchemaAsync(MySqlConnection connection)
    {
        // Non-member contacts. Owner is a club (fk_district_id = 0) or a district (fk_club_id = 0).
        // Deleting a contact deletes the row: it is a non-member's personal data, nothing to keep.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS contacts (
                pk_contact_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL DEFAULT 0,
                fk_district_id INT NOT NULL DEFAULT 0,
                name VARCHAR(200) NOT NULL,
                email VARCHAR(200) NULL,
                mobile VARCHAR(30) NULL,
                contact_type VARCHAR(20) NOT NULL DEFAULT 'guest',
                organisation VARCHAR(200) NULL,
                notes VARCHAR(1000) NULL,
                source VARCHAR(20) NOT NULL DEFAULT 'manual',
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by INT NULL,
                modified_date DATETIME NULL,
                INDEX idx_contacts_owner (fk_club_id, fk_district_id),
                INDEX idx_contacts_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // One contact per email and owner, also when two saves race (NULL emails do not collide).
        await CreateIndexIfNotExists(connection, "contacts", "uk_contacts_owner_email",
            "CREATE UNIQUE INDEX uk_contacts_owner_email ON contacts (fk_club_id, fk_district_id, email)");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS contact_groups (
                pk_contact_group_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL DEFAULT 0,
                fk_district_id INT NOT NULL DEFAULT 0,
                name VARCHAR(100) NOT NULL,
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_contact_groups_owner (fk_club_id, fk_district_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS contact_group_members (
                fk_contact_group_id INT NOT NULL,
                fk_contact_id INT NOT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (fk_contact_group_id, fk_contact_id),
                INDEX idx_cgm_contact (fk_contact_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Prospect pipeline on the existing potential_members table.
        await AddColumnIfNotExists(connection, "potential_members", "stage", "VARCHAR(20) NOT NULL DEFAULT 'inquiry'");
        await AddColumnIfNotExists(connection, "potential_members", "fk_owner_member_id", "INT NULL");
        await AddColumnIfNotExists(connection, "potential_members", "notes", "VARCHAR(2000) NULL");
        await AddColumnIfNotExists(connection, "potential_members", "source", "VARCHAR(20) NOT NULL DEFAULT 'manual'");
        await AddColumnIfNotExists(connection, "potential_members", "consent_date", "DATETIME NULL");
        await AddColumnIfNotExists(connection, "potential_members", "fk_converted_member_id", "INT NULL");
        await AddColumnIfNotExists(connection, "potential_members", "converted_date", "DATETIME NULL");
        await CreateIndexIfNotExists(connection, "potential_members", "idx_pm_club_stage",
            "CREATE INDEX idx_pm_club_stage ON potential_members (fk_club_id, isdeleted, stage)");

        // Contact groups as mass email recipients (recipient type 4).
        await AddColumnIfNotExists(connection, "club_mass_emails", "ContactGroupIds", "VARCHAR(500) NULL");
        await AddColumnIfNotExists(connection, "club_mass_email_recipients", "fk_contact_id", "INT NULL");

        // Membership growth target per club and Rotary year (net growth: joined minus terminated).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_growth_targets (
                fk_club_id INT NOT NULL,
                fk_year_id INT NOT NULL,
                target_net_growth INT NOT NULL,
                modified_by INT NULL,
                modified_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (fk_club_id, fk_year_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Invite prompts: a club schedules a nudge for a meeting; the log is per member (dedupe + in-app feed).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS invite_prompts (
                pk_invite_prompt_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                meeting_date DATE NOT NULL,
                send_on DATE NOT NULL,
                note VARCHAR(500) NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
                sent_count INT NOT NULL DEFAULT 0,
                sent_date DATETIME NULL,
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_invite_prompts_due (status, send_on),
                INDEX idx_invite_prompts_club (fk_club_id, meeting_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS invite_prompt_log (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_invite_prompt_id INT NOT NULL,
                fk_club_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_invite_prompt_member (fk_invite_prompt_id, fk_member_id),
                INDEX idx_invite_log_member (fk_member_id, created_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS member_invite_links (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                token CHAR(32) NOT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_invite_link_token (token),
                UNIQUE KEY uk_invite_link_member (fk_club_id, fk_member_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
