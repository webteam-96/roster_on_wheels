using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

public partial class DatabaseInitializer
{
    /// <summary>
    /// Translation memory, provider usage and the corrections version (Services/Localization/LocalizationService.cs).
    /// Additive only; same SQL in database/schema.sql and database/maintenance/2026-11-04-translation-memory.sql.
    /// Undo: database/maintenance/2026-11-04-translation-memory-down.sql.
    /// </summary>
    private static async Task EnsureTranslationMemoryTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS translation_memory (
                source_hash CHAR(64) NOT NULL,
                target_lang VARCHAR(20) NOT NULL,
                source_text TEXT NOT NULL,
                translated_text TEXT NOT NULL,
                provider VARCHAR(30) NULL,
                is_override TINYINT(1) NOT NULL DEFAULT 0,
                updated_by INT NULL,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (source_hash, target_lang),
                KEY ix_translation_memory_lang (target_lang, is_override, updated_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS translation_usage (
                usage_month CHAR(7) NOT NULL,
                provider VARCHAR(30) NOT NULL,
                chars_sent BIGINT NOT NULL DEFAULT 0,
                requests BIGINT NOT NULL DEFAULT 0,
                PRIMARY KEY (usage_month, provider)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS translation_memory_version (
                id TINYINT NOT NULL,
                version BIGINT NOT NULL,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
