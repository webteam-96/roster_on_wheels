-- Translation memory, provider usage and corrections version (api/Services/Localization/LocalizationService.cs).
-- Additive and safe to run twice. The API also creates these at startup unless Database__SkipInit=true.
-- Undo: 2026-11-04-translation-memory-down.sql

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS translation_usage (
    usage_month CHAR(7) NOT NULL,
    provider VARCHAR(30) NOT NULL,
    chars_sent BIGINT NOT NULL DEFAULT 0,
    requests BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (usage_month, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS translation_memory_version (
    id TINYINT NOT NULL,
    version BIGINT NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
