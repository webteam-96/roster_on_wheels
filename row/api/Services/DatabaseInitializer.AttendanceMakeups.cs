using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Attendance makeups, leave of absence, exemptions and the club's makeup window (gap #5, 2026-11-19;
    /// Services/AttendanceStandingService.cs). Additive only. Dates are calendar dates; created_date is UTC.
    /// </summary>
    private static async Task EnsureAttendanceMakeupTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_attendance_makeups (
                pk_makeup_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                makeup_date DATE NOT NULL,
                makeup_type VARCHAR(30) NOT NULL,
                note VARCHAR(500) NULL,
                fk_missed_attendance_id INT NULL,
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                INDEX idx_makeup_club_member (fk_club_id, fk_member_id, makeup_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // A member logs their own makeup as pending; an officer approves or rejects it. Only approved makeups count.
        // Rows written before this column (officer-entered) stay approved through the default.
        await AddColumnIfNotExists(connection, "club_attendance_makeups", "status", "VARCHAR(12) NOT NULL DEFAULT 'approved'");
        await AddColumnIfNotExists(connection, "club_attendance_makeups", "reviewed_by", "INT NULL");
        await AddColumnIfNotExists(connection, "club_attendance_makeups", "reviewed_date", "DATETIME NULL");
        await AddColumnIfNotExists(connection, "club_attendance_makeups", "review_note", "VARCHAR(500) NULL");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_member_leaves (
                pk_leave_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                from_date DATE NOT NULL,
                to_date DATE NOT NULL,
                reason VARCHAR(500) NULL,
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                INDEX idx_leave_club_member (fk_club_id, fk_member_id, from_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // One exemption per member of a club; saving again replaces it.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_member_attendance_exemptions (
                pk_exemption_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                reason VARCHAR(200) NOT NULL,
                end_date DATE NULL,
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                UNIQUE KEY uk_exemption_club_member (fk_club_id, fk_member_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_attendance_settings (
                fk_club_id INT PRIMARY KEY,
                makeup_window_days INT NOT NULL DEFAULT 14,
                modified_by INT NULL,
                modified_date DATETIME NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // A closed meeting: its attendance and the makeups that can cover it are locked until an officer reopens it.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_attendance_closures (
                fk_attendance_id INT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                closed_by INT NOT NULL,
                closed_date DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
                INDEX idx_closure_club (fk_club_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // How each member type counts, per club: counted, own_only (own % shown, left out of the club %), excluded.
        // No row means the default (AttendanceStandingService.DefaultRule).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_attendance_member_type_rules (
                fk_club_id INT NOT NULL,
                member_type VARCHAR(40) NOT NULL,
                count_rule VARCHAR(12) NOT NULL,
                modified_by INT NULL,
                modified_date DATETIME NULL,
                PRIMARY KEY (fk_club_id, member_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
