using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Account security (gap agent 2026-11-19, Services/AccountSecurityService.cs): TOTP multi-factor login,
    /// recovery codes, login challenges, email magic links, per-club MFA policy. Additive only.
    /// Secrets are encrypted with ASP.NET Data Protection; codes and tokens are stored as SHA-256 hashes only.
    /// </summary>
    private static async Task EnsureAccountSecurityTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS member_mfa (
                fk_member_id INT NOT NULL PRIMARY KEY,
                secret_protected VARCHAR(1024) NULL,
                pending_secret_protected VARCHAR(1024) NULL,
                enabled TINYINT(1) NOT NULL DEFAULT 0,
                enabled_at DATETIME NULL,
                last_used_step BIGINT NULL,
                updated_at DATETIME NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS member_mfa_recovery_codes (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                fk_member_id INT NOT NULL,
                code_hash CHAR(64) NOT NULL,
                used_at DATETIME NULL,
                created_at DATETIME NOT NULL,
                INDEX idx_mfa_recovery_member (fk_member_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        // A password (or magic link) that was right but still needs the second factor. Short-lived, single use.
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS auth_login_challenges (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                token_hash CHAR(64) NOT NULL,
                fk_member_id INT NOT NULL,
                channel VARCHAR(10) NOT NULL,
                is_temporary TINYINT(1) NOT NULL DEFAULT 0,
                setup_required TINYINT(1) NOT NULL DEFAULT 0,
                attempts INT NOT NULL DEFAULT 0,
                expires_at DATETIME NOT NULL,
                used_at DATETIME NULL,
                created_at DATETIME NOT NULL,
                UNIQUE KEY uk_login_challenge_token (token_hash),
                INDEX idx_login_challenge_member (fk_member_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS auth_magic_links (
                pk_id INT AUTO_INCREMENT PRIMARY KEY,
                token_hash CHAR(64) NOT NULL,
                fk_member_id INT NOT NULL,
                channel VARCHAR(10) NOT NULL,
                attempts INT NOT NULL DEFAULT 0,
                expires_at DATETIME NOT NULL,
                used_at DATETIME NULL,
                created_at DATETIME NOT NULL,
                request_ip VARCHAR(64) NULL,
                UNIQUE KEY uk_magic_link_token (token_hash),
                INDEX idx_magic_link_member (fk_member_id, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS club_security_policy (
                fk_club_id INT NOT NULL PRIMARY KEY,
                require_mfa TINYINT(1) NOT NULL DEFAULT 0,
                updated_by INT NULL,
                updated_at DATETIME NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
