using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Member map and business directory (competitor gap, 2026-11-19; MemberMapService, BusinessDirectoryService).
    /// Additive only. A map pin is opt-in and holds a point rounded to about 1 km, never an address.
    /// </summary>
    private static async Task EnsureMemberMapTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS member_map_pins (
                fk_member_id INT NOT NULL PRIMARY KEY,
                city VARCHAR(100) NULL,
                area VARCHAR(100) NULL,
                latitude DECIMAL(5,2) NOT NULL,
                longitude DECIMAL(6,2) NOT NULL,
                modified_utc DATETIME NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // One listing per member; any edit sends it back to 'pending' until a club or district admin approves it.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS business_listings (
                pk_listing_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_member_id INT NOT NULL,
                fk_club_id INT NOT NULL,
                fk_district_id INT NOT NULL,
                business_name VARCHAR(200) NOT NULL,
                classification VARCHAR(150) NULL,
                description VARCHAR(2000) NULL,
                website VARCHAR(300) NULL,
                phone VARCHAR(40) NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'pending',
                review_note VARCHAR(500) NULL,
                reviewed_by INT NULL,
                reviewed_utc DATETIME NULL,
                created_utc DATETIME NOT NULL,
                modified_utc DATETIME NOT NULL,
                UNIQUE KEY uk_business_listing_member (fk_member_id),
                INDEX idx_business_listing_district (fk_district_id, status),
                INDEX idx_business_listing_club (fk_club_id, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
