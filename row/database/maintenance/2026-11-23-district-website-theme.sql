-- Each district picks which of the seven district website themes its public site uses
-- (ether, prism, orbit, tide, transit, cascade, kinetic). NULL = the default, ether.
-- Additive and re-runnable: the column is added only when missing. Undo: 2026-11-23-district-website-theme-down.sql
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'district_websites' AND COLUMN_NAME = 'theme_key');
SET @ddl := IF(@exists = 0, 'ALTER TABLE district_websites ADD COLUMN theme_key VARCHAR(32) NULL AFTER Notes', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
