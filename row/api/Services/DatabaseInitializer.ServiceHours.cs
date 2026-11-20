using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Service hours and contributions (Services/ServiceHoursService.cs). Additive only. fk_year_id + fk_project_id
    /// name a project in that Rotary year's project table (rotary_projects_YYYY_YY); no project: other_service says
    /// what the service was. Times are UTC.
    /// </summary>
    private static async Task EnsureServiceHoursTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS service_hours (
                pk_service_hours_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_member_id INT NOT NULL,
                fk_club_id INT NOT NULL,
                fk_year_id INT NOT NULL,
                fk_project_id INT NULL,
                other_service VARCHAR(200) NULL,
                service_date DATE NOT NULL,
                hours DECIMAL(6,2) NOT NULL,
                note VARCHAR(1000) NULL,
                photo_path VARCHAR(300) NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'pending',
                reviewed_by INT NULL,
                reviewed_at DATETIME NULL,
                review_note VARCHAR(300) NULL,
                created_at DATETIME NOT NULL,
                INDEX idx_service_hours_club (fk_club_id, fk_year_id, status),
                INDEX idx_service_hours_member (fk_member_id, service_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // kind: cash or in_kind (amount is then the estimated value); currency is the project's.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS service_contributions (
                pk_contribution_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_year_id INT NOT NULL,
                fk_project_id INT NOT NULL,
                kind VARCHAR(10) NOT NULL,
                amount DECIMAL(15,2) NOT NULL,
                currency VARCHAR(5) NULL,
                contributor VARCHAR(150) NULL,
                description VARCHAR(300) NULL,
                contribution_date DATE NOT NULL,
                created_by INT NOT NULL,
                created_at DATETIME NOT NULL,
                INDEX idx_service_contrib_club (fk_club_id, fk_year_id, fk_project_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
