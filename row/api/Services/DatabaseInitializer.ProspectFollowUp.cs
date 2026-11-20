using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Prospect follow-up tasks and new-prospect notifications (gap agent, 2026-11-19; feature contacts_growth).
// Additive only. Times are UTC; a due date is the club's calendar day.
public partial class DatabaseInitializer
{
    private static async Task EnsureProspectFollowUpSchemaAsync(MySqlConnection connection)
    {
        // A follow-up task on a prospect, assigned to one member. remind_days_before NULL = no reminder.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS prospect_tasks (
                pk_task_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_potential_member_id INT NOT NULL,
                title VARCHAR(200) NOT NULL,
                notes VARCHAR(1000) NULL,
                fk_assignee_member_id INT NOT NULL,
                due_date DATE NOT NULL,
                remind_days_before INT NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'open',
                reminder_sent_at DATETIME NULL,
                completed_at DATETIME NULL,
                completed_by INT NULL,
                completion_note VARCHAR(500) NULL,
                created_by INT NULL,
                created_date DATETIME NOT NULL,
                modified_by INT NULL,
                modified_date DATETIME NULL,
                INDEX idx_prospect_tasks_club (fk_club_id, status, due_date),
                INDEX idx_prospect_tasks_assignee (fk_assignee_member_id, status),
                CONSTRAINT fk_prospect_tasks_prospect FOREIGN KEY (fk_potential_member_id)
                    REFERENCES potential_members (pk_potential_member_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // Who hears about a new prospect, and how. No row = the defaults in ProspectFollowUpService.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS prospect_notify_settings (
                fk_club_id INT NOT NULL PRIMARY KEY,
                to_president TINYINT(1) NOT NULL DEFAULT 1,
                to_membership_chair TINYINT(1) NOT NULL DEFAULT 1,
                by_in_app TINYINT(1) NOT NULL DEFAULT 1,
                by_email TINYINT(1) NOT NULL DEFAULT 1,
                modified_by INT NULL,
                modified_date DATETIME NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS prospect_notify_members (
                fk_club_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                PRIMARY KEY (fk_club_id, fk_member_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        // One row per recipient: the app's bell reads in_app rows, ProspectFollowUpBackgroundService emails 'pending' ones.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS prospect_notifications (
                pk_notification_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_member_id INT NOT NULL,
                fk_club_id INT NOT NULL,
                fk_potential_member_id INT NOT NULL,
                fk_task_id INT NULL,
                kind VARCHAR(20) NOT NULL,
                title VARCHAR(250) NOT NULL,
                body VARCHAR(600) NULL,
                in_app TINYINT(1) NOT NULL DEFAULT 1,
                email_status VARCHAR(10) NOT NULL DEFAULT 'none',
                email_sent_at DATETIME NULL,
                created_date DATETIME NOT NULL,
                INDEX idx_prospect_notif_member (fk_member_id, created_date),
                INDEX idx_prospect_notif_email (email_status),
                CONSTRAINT fk_prospect_notif_prospect FOREIGN KEY (fk_potential_member_id)
                    REFERENCES potential_members (pk_potential_member_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
