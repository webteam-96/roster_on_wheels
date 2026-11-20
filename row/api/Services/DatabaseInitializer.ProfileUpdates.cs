using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Profile update requests (competitor gap #3, ProfileUpdateService). Additive only. One row per member asked;
    /// the member's link carries a token whose SHA-256 is stored here, never the token itself. Times are UTC.
    /// </summary>
    private static async Task EnsureProfileUpdateTablesAsync(MySqlConnection connection)
    {
        // email_status: 'emailed' (handed to the email service), 'no_email' (member has no address).
        // completed_via: 'link' (the emailed form), 'confirm' (member said nothing changed), 'profile' (saved own
        // profile in the app or portal). A newer request for the same member and club closes the older open one
        // (expires_at moved to the moment it was replaced).
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS profile_update_requests (
                pk_request_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_club_id INT NOT NULL,
                fk_member_id INT NOT NULL,
                token_hash CHAR(64) NOT NULL,
                message VARCHAR(1000) NULL,
                requested_by INT NOT NULL,
                requested_at DATETIME NOT NULL,
                expires_at DATETIME NOT NULL,
                email_status VARCHAR(20) NOT NULL,
                completed_at DATETIME NULL,
                completed_via VARCHAR(10) NULL,
                UNIQUE KEY uk_profile_update_token (token_hash),
                INDEX idx_profile_update_club (fk_club_id, requested_at),
                INDEX idx_profile_update_member (fk_member_id, completed_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
