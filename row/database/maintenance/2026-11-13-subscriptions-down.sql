-- Undo 2026-11-13-subscriptions.sql. tenant_subscriptions is not touched.
DROP TABLE IF EXISTS exec_signin_codes;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'member_roles' AND COLUMN_NAME = 'via_subscription');
SET @s := IF(@c = 1, 'ALTER TABLE member_roles DROP COLUMN via_subscription', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
DROP TABLE IF EXISTS ri_club_officer_sync;
DROP TABLE IF EXISTS ri_club_officers;
DROP TABLE IF EXISTS subscription_orders;
DROP TABLE IF EXISTS subscription_prices;
