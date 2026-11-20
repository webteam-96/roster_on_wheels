using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Youth programs (gap #12, Services/YouthService.cs): who may see youth data (youth_officers), RYLA and RLI
    /// participants per program year, and the Youth Protection clearance register. Additive only; times in UTC.
    /// </summary>
    private static async Task EnsureYouthTablesAsync(MySqlConnection connection)
    {
        // fk_club_id 0 = the district youth chair; otherwise a club youth officer of that club.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS youth_officers (
                pk_officer_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL,
                fk_club_id INT NOT NULL DEFAULT 0,
                fk_member_id INT NOT NULL,
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL,
                UNIQUE KEY uk_youth_officer (fk_district_id, fk_club_id, fk_member_id),
                INDEX idx_youth_officer_member (fk_member_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // program: ryla | rli. Minimal fields on purpose: participants may be minors.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS youth_participants (
                pk_participant_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL,
                program VARCHAR(4) NOT NULL,
                fk_year_id INT NOT NULL,
                fk_sponsor_club_id INT NOT NULL,
                full_name VARCHAR(150) NOT NULL,
                contact_email VARCHAR(254) NULL,
                status VARCHAR(12) NOT NULL DEFAULT 'applied',
                created_by INT NOT NULL,
                created_date DATETIME NOT NULL,
                modified_by INT NULL,
                modified_date DATETIME NULL,
                INDEX idx_youth_part_district (fk_district_id, fk_year_id, program),
                INDEX idx_youth_part_club (fk_sponsor_club_id, fk_year_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // One row per volunteer per district. reminder_sent_for = the expiry date the reminder went out for, so a renewal re-arms it.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS ypp_clearances (
                pk_clearance_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_district_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                training_date DATE NULL,
                check_date DATE NULL,
                expiry_date DATE NULL,
                reminder_sent_for DATE NULL,
                modified_by INT NOT NULL,
                modified_date DATETIME NOT NULL,
                UNIQUE KEY uk_ypp_member (fk_district_id, fk_member_id),
                INDEX idx_ypp_member (fk_member_id),
                INDEX idx_ypp_expiry (expiry_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
