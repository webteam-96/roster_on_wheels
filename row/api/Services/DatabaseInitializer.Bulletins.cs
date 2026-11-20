using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Club email bulletins (gap #6, Services/BulletinService.cs), member stories with editor approval
    /// (Services/StoryService.cs) and bulletin subscribers who are not members (Services/BulletinSubscriberService.cs).
    /// Additive only. A bulletin is sent to members as an ordinary club mass email (fk_mass_email_id); subscriber
    /// copies are logged one row each in club_bulletin_deliveries. sent_html is the archive copy. Times are UTC.
    /// </summary>
    private static async Task EnsureBulletinTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_bulletins (
                pk_bulletin_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                title VARCHAR(200) NOT NULL,
                intro TEXT NULL,
                president_message TEXT NULL,
                layout VARCHAR(20) NOT NULL DEFAULT 'classic',
                announcement_ids VARCHAR(500) NULL,
                event_ids VARCHAR(500) NULL,
                story_ids VARCHAR(500) NULL,
                include_birthdays TINYINT(1) NOT NULL DEFAULT 1,
                include_speakers TINYINT(1) NOT NULL DEFAULT 1,
                status VARCHAR(20) NOT NULL DEFAULT 'Draft',
                fk_mass_email_id INT NULL,
                sent_html MEDIUMTEXT NULL,
                sent_date DATETIME NULL,
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                modified_by INT NULL,
                modified_date DATETIME NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                INDEX idx_club_bulletin (fk_club_id, isdeleted, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // story_ids came after the first local build of the table.
        if (await connection.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'club_bulletins' AND COLUMN_NAME = 'story_ids'") == 0)
            await connection.ExecuteAsync("ALTER TABLE club_bulletins ADD COLUMN story_ids VARCHAR(500) NULL AFTER event_ids");

        // Stories: Pending -> Approved | Rejected | ChangesRequested (the author edits and it is Pending again).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_stories (
                pk_story_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                title VARCHAR(200) NOT NULL,
                body TEXT NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'Pending',
                fk_author_id INT NOT NULL,
                submitted_date DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                fk_reviewer_id INT NULL,
                review_note VARCHAR(1000) NULL,
                reviewed_date DATETIME NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                INDEX idx_club_story (fk_club_id, status, isdeleted),
                INDEX idx_story_author (fk_author_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Non-member subscribers. Pending until the emailed link is confirmed (double opt-in); only Confirmed get mail.
        // The confirm token is stored hashed; the unsubscribe link is an HMAC of the id, so it needs no storage.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_bulletin_subscribers (
                pk_subscriber_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                email VARCHAR(254) NOT NULL,
                name VARCHAR(120) NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'Pending',
                confirm_token_hash CHAR(64) NULL,
                confirm_expires DATETIME NULL,
                confirm_sent_date DATETIME NULL,
                consent_text VARCHAR(300) NULL,
                signup_date DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                confirmed_date DATETIME NULL,
                unsubscribed_date DATETIME NULL,
                UNIQUE KEY uq_club_subscriber (fk_club_id, email),
                INDEX idx_subscriber_token (confirm_token_hash)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_bulletin_deliveries (
                pk_delivery_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_bulletin_id INT NOT NULL,
                fk_subscriber_id INT NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'Pending',
                message_id VARCHAR(200) NULL,
                error_message VARCHAR(500) NULL,
                sent_date DATETIME NULL,
                UNIQUE KEY uq_bulletin_subscriber (fk_bulletin_id, fk_subscriber_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
