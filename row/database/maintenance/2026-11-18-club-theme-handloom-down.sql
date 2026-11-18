-- Undoes 2026-11-18-club-theme-handloom.sql: removes the Handloom row, but only when no club website uses it
-- (a theme still chosen by a club website, in club_websites or club_website_theme, stays so no club loses it).

-- MySQL Workbench blocks this DELETE in "Safe Updates" mode; allow it for this script only.
SET SQL_SAFE_UPDATES = 0;
DELETE m FROM theme_master m
LEFT JOIN club_website_theme c ON c.fk_theme_id = m.pk_theme_id
LEFT JOIN club_websites w ON w.fk_theme_id = m.pk_theme_id
WHERE c.fk_theme_id IS NULL AND w.fk_theme_id IS NULL
  AND m.theme_name = 'Handloom';
SET SQL_SAFE_UPDATES = 1;
