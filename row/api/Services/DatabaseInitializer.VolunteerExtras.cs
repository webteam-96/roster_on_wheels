using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Volunteer sheet extras (Services/VolunteerExtrasService.cs): a confirmation email text per sheet, archiving,
    /// scheduled follow-up emails sent once per sign-up, and coordinators who get the volunteer list. Additive only:
    /// two nullable columns on volunteer_sheets and three tables that cascade with their sheet.
    /// </summary>
    private static async Task EnsureVolunteerExtrasTablesAsync(MySqlConnection connection)
    {
        await AddColumnIfNotExists(connection, "volunteer_sheets", "confirmation_text", "TEXT NULL");
        await AddColumnIfNotExists(connection, "volunteer_sheets", "archived_at", "DATETIME NULL");
        // kind: 'before' (days before the slot starts) or 'after' (days after it ends)
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS volunteer_followups (
                pk_followup_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_sheet_id INT NOT NULL,
                kind VARCHAR(6) NOT NULL,
                days INT NOT NULL,
                subject VARCHAR(200) NOT NULL,
                body TEXT NOT NULL,
                INDEX idx_volunteer_followup_sheet (fk_sheet_id),
                CONSTRAINT fk_volunteer_followup_sheet FOREIGN KEY (fk_sheet_id) REFERENCES volunteer_sheets (pk_sheet_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // The primary key is the "sent once" guarantee: the job claims a row with INSERT IGNORE before it sends.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS volunteer_followup_sends (
                fk_followup_id INT NOT NULL,
                fk_signup_id INT NOT NULL,
                sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (fk_followup_id, fk_signup_id),
                INDEX idx_volunteer_followup_send_signup (fk_signup_id),
                CONSTRAINT fk_volunteer_followup_send_followup FOREIGN KEY (fk_followup_id) REFERENCES volunteer_followups (pk_followup_id) ON DELETE CASCADE,
                CONSTRAINT fk_volunteer_followup_send_signup FOREIGN KEY (fk_signup_id) REFERENCES volunteer_signups (pk_signup_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS volunteer_sheet_coordinators (
                fk_sheet_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                PRIMARY KEY (fk_sheet_id, fk_member_id),
                CONSTRAINT fk_volunteer_coordinator_sheet FOREIGN KEY (fk_sheet_id) REFERENCES volunteer_sheets (pk_sheet_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
