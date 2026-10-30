-- The 11 club website themes (docs/plans/2026-10-29-club-themes-rizones-port.md) as rows of theme_master, so the
-- admin theme picker lists them and a club's choice reaches the site. The site derives the theme key from the
-- name (lower case, spaces to dashes: "Split Story" -> split-story).
-- 2026-10-30: applied to the local copy (row_prod_copy) only; production when going live (user decision).
-- Idempotent: a theme already present (same name, not deleted) is skipped. Undo: 2026-10-30-club-themes-down.sql.

INSERT INTO theme_master (theme_name, description, isdeleted)
SELECT t.name, t.description, 0
FROM (
  SELECT 'Classic Blue' AS name, 'Floating glass navigation, banner and advertisement slider, impact band.' AS description
  UNION ALL SELECT 'Warm Modern', 'Warm tones, ticket-style events, illustrated project tiles.'
  UNION ALL SELECT 'Civic Bold', 'Bold civic layout with light and dark modes.'
  UNION ALL SELECT 'Verdigris Ledger', 'Ledger-style typography in verdigris green.'
  UNION ALL SELECT 'Gold', 'Gold accents; every inner page has its own composition.'
  UNION ALL SELECT 'Cinematic', 'Full-screen imagery and cinematic scroll motion.'
  UNION ALL SELECT 'Split Story', 'Split-screen storytelling layout.'
  UNION ALL SELECT 'Liquid Motion', 'Fluid motion with a WebGL ripple on project photos.'
  UNION ALL SELECT 'Horizontal Journey', 'Sections that travel sideways as the visitor scrolls.'
  UNION ALL SELECT 'Photo Collage', 'Scrapbook-style photo collage.'
  UNION ALL SELECT 'Sunrise', 'Night-to-dawn colour journey with light and dark modes.'
) AS t
WHERE NOT EXISTS (
  SELECT 1 FROM theme_master m WHERE m.theme_name = t.name AND (m.isdeleted = 0 OR m.isdeleted IS NULL)
);
