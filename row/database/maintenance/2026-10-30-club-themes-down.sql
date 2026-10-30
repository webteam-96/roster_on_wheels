-- Undoes 2026-10-30-club-themes.sql: removes the 11 club theme rows, but only those no club website uses
-- (club_website_theme keeps a club's choice; a used row stays so no club loses its theme).

DELETE m FROM theme_master m
LEFT JOIN club_website_theme c ON c.fk_theme_id = m.pk_theme_id
WHERE c.fk_theme_id IS NULL
  AND m.theme_name IN ('Classic Blue', 'Warm Modern', 'Civic Bold', 'Verdigris Ledger', 'Gold', 'Cinematic',
                       'Split Story', 'Liquid Motion', 'Horizontal Journey', 'Photo Collage', 'Sunrise');
