using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Job postings and business-to-business offers (Services/JobBoardService.cs). Additive only. A post belongs to the
    /// district of the poster's club; reports cascade with their post.
    /// </summary>
    private static async Task EnsureJobBoardTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS job_board_posts (
                pk_post_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL,
                fk_club_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                kind VARCHAR(10) NOT NULL,
                title VARCHAR(150) NOT NULL,
                description TEXT NOT NULL,
                company VARCHAR(150) NULL,
                location VARCHAR(150) NULL,
                contact VARCHAR(254) NOT NULL,
                expires_on DATE NOT NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'pending',
                review_note VARCHAR(500) NULL,
                reviewed_by INT NULL,
                reviewed_at DATETIME NULL,
                created_at DATETIME NOT NULL,
                INDEX idx_job_post_district (fk_district_id, status, expires_on),
                INDEX idx_job_post_member (fk_member_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // resolved_at set when an admin approves (keeps) or removes the post; one open report per member and post.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS job_board_reports (
                pk_report_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_post_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                reason VARCHAR(500) NULL,
                created_at DATETIME NOT NULL,
                resolved_at DATETIME NULL,
                UNIQUE KEY uk_job_report_member (fk_post_id, fk_member_id),
                CONSTRAINT fk_job_report_post FOREIGN KEY (fk_post_id) REFERENCES job_board_posts (pk_post_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
