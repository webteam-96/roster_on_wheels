using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Mobile extras (gap agent): password-reset emails a club leader sent to a member of their club. Rate limit and
// club history. Only CREATE TABLE IF NOT EXISTS, so safe on every startup.
public partial class DatabaseInitializer
{
    private static async Task EnsureMobileExtrasTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_password_reset_requests (
                pk_request_id      INT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
                fk_club_id         INT       NOT NULL,
                fk_member_id       INT       NOT NULL,           -- the member the reset email went to
                fk_sent_by_id      INT       NOT NULL,           -- the leader who asked for it
                created_utc        DATETIME  NOT NULL,
                KEY ix_cprr_member (fk_member_id, created_utc),
                KEY ix_cprr_sender (fk_sent_by_id, created_utc),
                KEY ix_cprr_club (fk_club_id, created_utc)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
