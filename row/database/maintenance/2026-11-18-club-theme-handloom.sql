-- Adds the Handloom club website theme to theme_master, so the admin theme picker lists it (released 2026-11-18;
-- the site maps the name "Handloom" to the theme key `handloom`).
-- Idempotent: skipped when a not-deleted "Handloom" row exists. Undo: 2026-11-18-club-theme-handloom-down.sql.

INSERT INTO theme_master (theme_name, description, isdeleted)
SELECT 'Handloom', 'Woven textile look in green and gold, with a moving banner slider.', 0
WHERE NOT EXISTS (
  SELECT 1 FROM theme_master m WHERE m.theme_name = 'Handloom' AND (m.isdeleted = 0 OR m.isdeleted IS NULL)
);
