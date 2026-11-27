-- Shows the everyday club and district modules to plain members in the app. Every row had IsDefaultForMember = 0, so a
-- member's club and district screens said "No modules". Change the choice later per module in Settings > Modules.
-- Skipped when any module is already on for members. Undo: 2026-11-25-member-modules-down.sql

SET SQL_SAFE_UPDATES = 0;
UPDATE module_master
SET IsDefaultForMember = 1
WHERE isdeleted = 0
  AND ModuleKey IN ('directory', 'past_presidents', 'board_of_directors', 'club_service', 'community_service', 'vocational_service',
    'international_service', 'new_generation_service', 'public_image_initiative', 'upcoming_events', 'announcements', 'newsletters',
    'documents', 'attendance', 'membership_dues', 'web_links', 'district_committee', 'clubs', 'district_projects', 'district_events')
  AND NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM module_master WHERE IsDefaultForMember = 1 AND isdeleted = 0) already);
SET SQL_SAFE_UPDATES = 1;
