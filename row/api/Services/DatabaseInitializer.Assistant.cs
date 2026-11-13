using Dapper;
using MySqlConnector;

namespace RotaryApi.Services;

// Rotary AI Assistant tables (Services/Assistant). Same DDL as SQL/assistant_tables.sql - keep the two
// in step. Only CREATE TABLE IF NOT EXISTS, so this is safe on every startup.
public partial class DatabaseInitializer
{
    private static async Task EnsureAssistantTablesAsync(MySqlConnection connection)
    {
        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS assistant_users (
                member_id      INT          NOT NULL PRIMARY KEY,
                is_active      TINYINT(1)   NOT NULL DEFAULT 1,
                daily_limit    INT          NULL,                 -- NULL = Assistant:Limits:DailyQuestionsPerUser
                blocked_until  DATETIME     NULL,                 -- set after repeated flagged questions
                note           VARCHAR(255) NULL,
                created_date   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS assistant_conversations (
                pk_conversation_id BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
                member_id          INT          NOT NULL,
                title              VARCHAR(200) NOT NULL,
                created_date       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_date       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                isdeleted          TINYINT(1)   NOT NULL DEFAULT 0,
                KEY ix_ac_member (member_id, isdeleted, updated_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS assistant_messages (
                pk_message_id      BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
                conversation_id    BIGINT        NOT NULL,
                member_id          INT           NOT NULL,
                role               VARCHAR(10)   NOT NULL,       -- user | assistant
                content            MEDIUMTEXT    NOT NULL,
                route              VARCHAR(20)   NULL,           -- cache | flash | sonnet | escalated | blocked | error
                model              VARCHAR(60)   NULL,
                language           VARCHAR(20)   NULL,
                input_tokens       INT           NOT NULL DEFAULT 0,
                output_tokens      INT           NOT NULL DEFAULT 0,
                cache_read_tokens  INT           NOT NULL DEFAULT 0,
                cache_write_tokens INT           NOT NULL DEFAULT 0,
                cost_usd           DECIMAL(12,6) NOT NULL DEFAULT 0,
                latency_ms         INT           NOT NULL DEFAULT 0,
                tools_used         VARCHAR(1000) NULL,
                flag               VARCHAR(60)   NULL,
                created_date       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
                KEY ix_am_conversation (conversation_id, pk_message_id),
                KEY ix_am_created (created_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS assistant_answer_cache (
                cache_key    CHAR(64)    NOT NULL PRIMARY KEY,
                answer       MEDIUMTEXT  NOT NULL,
                model        VARCHAR(60) NULL,
                created_date DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at   DATETIME    NOT NULL,
                hits         INT         NOT NULL DEFAULT 0,
                KEY ix_aac_expires (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS assistant_usage_daily (
                member_id       INT           NOT NULL,
                usage_date      DATE          NOT NULL,
                questions       INT           NOT NULL DEFAULT 0,
                contact_lookups INT           NOT NULL DEFAULT 0,
                cost_usd        DECIMAL(12,6) NOT NULL DEFAULT 0,
                PRIMARY KEY (member_id, usage_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS assistant_budget_monthly (
                budget_month CHAR(7)       NOT NULL PRIMARY KEY,   -- 'YYYY-MM' (UTC)
                cap_usd      DECIMAL(10,2) NOT NULL,
                spent_usd    DECIMAL(12,6) NOT NULL DEFAULT 0,
                reserved_usd DECIMAL(12,6) NOT NULL DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS assistant_security_events (
                pk_event_id  BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
                member_id    INT          NOT NULL,
                kind         VARCHAR(40)  NOT NULL,
                detail       VARCHAR(500) NULL,
                created_date DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                KEY ix_ase_member (member_id, created_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        await connection.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS assistant_index_items (
                source       VARCHAR(40) NOT NULL,                 -- project | comms
                item_key     VARCHAR(80) NOT NULL,                 -- e.g. '2025_26:1234', 'announcement:55'
                point_id     CHAR(36)    NOT NULL,                 -- Qdrant point id (deterministic UUID)
                content_hash CHAR(64)    NOT NULL,
                indexed_date DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (source, item_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }
}
