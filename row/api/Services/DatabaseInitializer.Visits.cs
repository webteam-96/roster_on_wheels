using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Club website visitor counter (Controllers/ClubWebsiteVisitsController.cs). One row per club, day and visitor;
    /// the visitor is a hash salted per day, so no IP is stored and visitors cannot be followed across days.
    /// Additive only; same SQL in database/schema.sql. Undo: database/maintenance/2026-10-30-website-visits-down.sql.
    /// </summary>
    private static async Task EnsureVisitTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_website_visits (
                fk_club_id INT NOT NULL,
                visit_date DATE NOT NULL,
                visitor_hash CHAR(64) NOT NULL,
                PRIMARY KEY (fk_club_id, visit_date, visitor_hash)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
