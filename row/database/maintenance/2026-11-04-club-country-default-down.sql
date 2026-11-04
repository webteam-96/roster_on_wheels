-- Reverses 2026-11-04-club-country-default.sql.
ALTER TABLE club_master MODIFY COLUMN `Country` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'India';
