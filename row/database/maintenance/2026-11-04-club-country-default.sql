-- ROW is not India-only: a new club no longer gets Country = 'India' when none is given. Existing rows are not changed.
-- Undo: 2026-11-04-club-country-default-down.sql
ALTER TABLE club_master MODIFY COLUMN `Country` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL;
