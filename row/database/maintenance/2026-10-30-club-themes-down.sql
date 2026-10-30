-- Undoes 2026-10-30-club-themes.sql: removes the 11 club theme rows, but only those no club website uses
-- (a theme still chosen by a club website, in club_websites or club_website_theme, stays so no club loses it).

-- MySQL Workbench blocks this DELETE in "Safe Updates" mode; allow it for this script only.
SET SQL_SAFE_UPDATES = 0;
DELETE m FROM theme_master m
LEFT JOIN club_website_theme c ON c.fk_theme_id = m.pk_theme_id
LEFT JOIN club_websites w ON w.fk_theme_id = m.pk_theme_id
WHERE c.fk_theme_id IS NULL AND w.fk_theme_id IS NULL
  AND m.theme_name IN ('Classic Blue', 'Warm Modern', 'Civic Bold', 'Verdigris Ledger', 'Gold', 'Cinematic',
                       'Split Story', 'Liquid Motion', 'Horizontal Journey', 'Photo Collage', 'Sunrise');
SET SQL_SAFE_UPDATES = 1;
