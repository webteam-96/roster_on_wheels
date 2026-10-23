using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Volunteers and speakers (ROW build spec 3.13, Services/VolunteerService.cs and SpeakerService.cs). Additive
    /// only; same SQL in database/schema.sql. Slots and sign-ups cascade with their sheet.
    /// </summary>
    private static async Task EnsureVolunteerTablesAsync(MySqlConnection connection)
    {
        // fk_year_id + fk_project_id: the service project (year-wise table) whose man_hours the recorded hours roll
        // into; hours_applied is what this sheet has already added there.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS volunteer_sheets (
                pk_sheet_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT NULL,
                fk_event_id INT NULL,
                fk_year_id INT NULL,
                fk_project_id INT NULL,
                hours_applied INT NOT NULL DEFAULT 0,
                public_token CHAR(32) NOT NULL,
                is_public TINYINT(1) NOT NULL DEFAULT 1,
                status VARCHAR(10) NOT NULL DEFAULT 'open',
                created_by INT NOT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by INT NULL,
                modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_volunteer_sheet_token (public_token),
                INDEX idx_volunteer_sheet_club (fk_club_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // filled is raised only by a conditional UPDATE (filled < capacity), so two people never take the last place.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS volunteer_slots (
                pk_slot_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_sheet_id INT NOT NULL,
                task VARCHAR(200) NOT NULL,
                starts_at DATETIME NOT NULL,
                ends_at DATETIME NULL,
                capacity INT NOT NULL,
                filled INT NOT NULL DEFAULT 0,
                INDEX idx_volunteer_slot_sheet (fk_sheet_id),
                INDEX idx_volunteer_slot_start (starts_at),
                CONSTRAINT fk_volunteer_slot_sheet FOREIGN KEY (fk_sheet_id) REFERENCES volunteer_sheets (pk_sheet_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // A member (fk_member_id) or a non-member with their own name and email; fk_contact_id is the hook for the
        // contacts module (3.13) to link a non-member to their contact record.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS volunteer_signups (
                pk_signup_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_slot_id INT NOT NULL,
                fk_member_id INT NULL,
                name VARCHAR(150) NULL,
                email VARCHAR(254) NULL,
                fk_contact_id INT NULL,
                consent_at DATETIME NULL,
                hours DECIMAL(6,2) NULL,
                reminder_sent_at DATETIME NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_volunteer_signup_member (fk_slot_id, fk_member_id),
                UNIQUE KEY uk_volunteer_signup_email (fk_slot_id, email),
                INDEX idx_volunteer_signup_member (fk_member_id),
                INDEX idx_volunteer_signup_reminder (reminder_sent_at),
                CONSTRAINT fk_volunteer_signup_slot FOREIGN KEY (fk_slot_id) REFERENCES volunteer_slots (pk_slot_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // shortcut: speakers and duties carry a meeting date, not a meeting record; link them to the 3.17 meeting
        // record when it lands.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_speakers (
                pk_speaker_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                meeting_date DATE NOT NULL,
                name VARCHAR(150) NOT NULL,
                topic VARCHAR(250) NULL,
                bio TEXT NULL,
                photo_path VARCHAR(300) NULL,
                email VARCHAR(254) NULL,
                phone VARCHAR(40) NULL,
                show_on_website TINYINT(1) NOT NULL DEFAULT 1,
                fk_contact_id INT NULL,
                created_by INT NOT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by INT NULL,
                modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_club_speaker_date (fk_club_id, meeting_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS meeting_duties (
                pk_duty_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                meeting_date DATE NOT NULL,
                duty VARCHAR(100) NOT NULL,
                fk_member_id INT NOT NULL,
                note VARCHAR(300) NULL,
                reminder_sent_at DATETIME NULL,
                created_by INT NOT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_meeting_duty_club (fk_club_id, meeting_date),
                INDEX idx_meeting_duty_member (fk_member_id, meeting_date),
                INDEX idx_meeting_duty_date (meeting_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
