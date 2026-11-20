using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>Custom report builder (Services/CustomReportService.cs): saved reports and their monthly email.
    /// Additive only. Deleting a report sets isdeleted; nothing removes rows.</summary>
    private static async Task EnsureCustomReportTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS custom_reports (
                pk_report_id INT AUTO_INCREMENT PRIMARY KEY,
                scope_type VARCHAR(10) NOT NULL,
                scope_id INT NOT NULL,
                name VARCHAR(150) NOT NULL,
                definition TEXT NOT NULL,
                schedule_monthly TINYINT(1) NOT NULL DEFAULT 0,
                schedule_day TINYINT NOT NULL DEFAULT 1,
                schedule_format VARCHAR(5) NOT NULL DEFAULT 'xlsx',
                last_sent_month CHAR(7) NULL,
                last_sent_at DATETIME NULL,
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL,
                modified_by INT NULL,
                modified_date DATETIME NULL,
                isdeleted TINYINT(1) NOT NULL DEFAULT 0,
                INDEX idx_custom_reports_scope (scope_type, scope_id, isdeleted),
                INDEX idx_custom_reports_schedule (schedule_monthly, isdeleted)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
