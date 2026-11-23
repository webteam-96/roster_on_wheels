-- Reverses 2026-11-23-district-website-theme.sql: every district goes back to the default theme (ether).
ALTER TABLE district_websites DROP COLUMN theme_key;
