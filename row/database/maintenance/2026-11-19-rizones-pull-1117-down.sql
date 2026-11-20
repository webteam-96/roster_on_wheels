-- Undo 2026-11-19-rizones-pull-1117.sql (drops only the columns and keys it added).
ALTER TABLE membership_dues DROP COLUMN NotifyEmail, DROP COLUMN Currency;
ALTER TABLE club_dues DROP COLUMN NotifyEmail, DROP COLUMN Currency;
ALTER TABLE rotary_org_sync_logins DROP KEY ix_rosl_club, DROP COLUMN fk_club_id;
ALTER TABLE rotary_org_sync_requests DROP KEY ix_rosr_club, DROP COLUMN fk_club_id;
-- Goal module (2026-11-20): only the three message tables are new. goal_locks and goal_role_* existed before
-- this pull and are left in place.
DROP TABLE IF EXISTS goal_group_message_reads;
DROP TABLE IF EXISTS goal_group_messages;
DROP TABLE IF EXISTS goal_direct_messages;
