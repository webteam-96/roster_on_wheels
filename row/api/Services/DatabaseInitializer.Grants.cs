using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Grants module (ROW build spec 3.8, Services/GrantService.cs). Additive only; same SQL in database/schema.sql.
    /// Child rows cascade with their application; nothing in the app deletes an application or a cycle.
    /// </summary>
    private static async Task EnsureGrantTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS grant_cycles (
                pk_cycle_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL,
                fk_year_id INT NOT NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'draft',
                ddf_budget DECIMAL(12,2) NOT NULL DEFAULT 0,
                max_request DECIMAL(12,2) NULL,
                min_qualified_members INT NOT NULL DEFAULT 0,
                opens_on DATE NULL,
                closes_on DATE NULL,
                report_due_on DATE NULL,
                rules TEXT NULL,
                created_by INT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by INT NULL,
                modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_grant_cycle (fk_district_id, fk_year_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS grant_applications (
                pk_application_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_cycle_id INT NOT NULL,
                fk_district_id INT NOT NULL,
                fk_club_id INT NOT NULL,
                status VARCHAR(30) NOT NULL DEFAULT 'draft',
                title VARCHAR(200) NOT NULL,
                description TEXT NULL,
                location VARCHAR(200) NULL,
                start_date DATE NULL,
                end_date DATE NULL,
                beneficiaries INT NULL,
                amount_requested DECIMAL(12,2) NOT NULL DEFAULT 0,
                amount_approved DECIMAL(12,2) NULL,
                rules_accepted TINYINT(1) NOT NULL DEFAULT 0,
                rejection_reason TEXT NULL,
                report_summary TEXT NULL,
                report_amount_spent DECIMAL(12,2) NULL,
                report_beneficiaries INT NULL,
                submitted_at DATETIME NULL,
                report_submitted_at DATETIME NULL,
                closed_at DATETIME NULL,
                created_by INT NOT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by INT NULL,
                modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_grant_app_cycle (fk_cycle_id, status),
                INDEX idx_grant_app_club (fk_club_id),
                INDEX idx_grant_app_district (fk_district_id, status),
                CONSTRAINT fk_grant_app_cycle FOREIGN KEY (fk_cycle_id) REFERENCES grant_cycles (pk_cycle_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS grant_application_lines (
                pk_line_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_application_id INT NOT NULL,
                kind VARCHAR(10) NOT NULL,
                description VARCHAR(300) NOT NULL,
                detail VARCHAR(300) NULL,
                amount DECIMAL(12,2) NULL,
                sort_order INT NOT NULL DEFAULT 0,
                INDEX idx_grant_line_app (fk_application_id),
                CONSTRAINT fk_grant_line_app FOREIGN KEY (fk_application_id) REFERENCES grant_applications (pk_application_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS grant_application_members (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_application_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                note VARCHAR(200) NULL,
                UNIQUE KEY uk_grant_app_member (fk_application_id, fk_member_id),
                INDEX idx_grant_member (fk_member_id),
                CONSTRAINT fk_grant_member_app FOREIGN KEY (fk_application_id) REFERENCES grant_applications (pk_application_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS grant_attachments (
                pk_attachment_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_application_id INT NOT NULL,
                kind VARCHAR(12) NOT NULL,
                original_name VARCHAR(255) NOT NULL,
                stored_name VARCHAR(100) NOT NULL,
                size_bytes INT NOT NULL,
                uploaded_by INT NOT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_grant_att_app (fk_application_id),
                CONSTRAINT fk_grant_att_app FOREIGN KEY (fk_application_id) REFERENCES grant_applications (pk_application_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS grant_events (
                pk_event_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_application_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                side VARCHAR(10) NOT NULL,
                action VARCHAR(30) NOT NULL,
                from_status VARCHAR(30) NULL,
                to_status VARCHAR(30) NULL,
                comment TEXT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_grant_event_app (fk_application_id),
                INDEX idx_grant_event_member (fk_member_id),
                CONSTRAINT fk_grant_event_app FOREIGN KEY (fk_application_id) REFERENCES grant_applications (pk_application_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS grant_payments (
                pk_payment_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_application_id INT NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                paid_on DATE NOT NULL,
                method VARCHAR(20) NOT NULL,
                reference VARCHAR(100) NULL,
                note VARCHAR(500) NULL,
                recorded_by INT NOT NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_grant_pay_app (fk_application_id),
                CONSTRAINT fk_grant_pay_app FOREIGN KEY (fk_application_id) REFERENCES grant_applications (pk_application_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // In-app feed rows (the app's bell) and the email outbox in one: GrantNotificationEmailBackgroundService
        // sends the pending ones.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS grant_notifications (
                pk_notification_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_member_id INT NOT NULL,
                fk_application_id INT NOT NULL,
                fk_event_id INT NOT NULL,
                side VARCHAR(10) NOT NULL,
                title VARCHAR(250) NOT NULL,
                body VARCHAR(600) NULL,
                email_status VARCHAR(10) NOT NULL DEFAULT 'pending',
                email_sent_at DATETIME NULL,
                created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_grant_notif_member (fk_member_id, created_date),
                INDEX idx_grant_notif_email (email_status),
                CONSTRAINT fk_grant_notif_app FOREIGN KEY (fk_application_id) REFERENCES grant_applications (pk_application_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // Light mode: a club whose district is not on ROW records only these two fields on its own projects.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS grant_project_light (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_year_id INT NOT NULL,
                fk_project_id INT NOT NULL,
                grant_amount DECIMAL(12,2) NULL,
                report_date DATE NULL,
                modified_by INT NULL,
                modified_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_grant_light (fk_year_id, fk_project_id),
                INDEX idx_grant_light_club (fk_club_id, fk_year_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
