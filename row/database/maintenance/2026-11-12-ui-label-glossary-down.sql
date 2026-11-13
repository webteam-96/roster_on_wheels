-- Undo 2026-11-12-ui-label-glossary.sql: removes the glossary rows; those labels go back to machine translation.
-- Hand corrections (provider 'correction') are not touched. Recycle the API app pool afterwards.
DELETE FROM translation_memory WHERE provider = 'glossary';
INSERT INTO translation_memory_version (id, version) VALUES (1, 1) ON DUPLICATE KEY UPDATE version = version + 1;
