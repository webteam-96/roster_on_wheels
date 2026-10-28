-- Undoes the schema additions of the build spec completion (2026-10-28,
-- docs/superpowers/plans/2026-10-28-build-spec-completion.md). Run only to roll back; it drops the columns and
-- their data. Each statement is idempotent.

-- S7: district tenant retention rule.
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_subscriptions' AND COLUMN_NAME = 'anonymise_after_months');
SET @sql := IF(@has_col = 1, 'ALTER TABLE tenant_subscriptions DROP COLUMN anonymise_after_months', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- S8: RI fields.
DROP TABLE IF EXISTS ri_codes;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'designation_master' AND COLUMN_NAME = 'ri_title') = 1,
               'ALTER TABLE designation_master DROP COLUMN ri_title', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'club_members' AND COLUMN_NAME = 'ri_member_type') = 1,
               'ALTER TABLE club_members DROP COLUMN ri_member_type, DROP COLUMN join_reason_code, DROP COLUMN termination_reason_code',
               'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- S10: district target setting.
DROP TABLE IF EXISTS district_target_proposals;

-- S11: renewal reminders.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'tenant_subscriptions' AND COLUMN_NAME = 'auto_renew') = 1,
               'ALTER TABLE tenant_subscriptions DROP COLUMN auto_renew, DROP COLUMN renewal_notice_for, DROP COLUMN dunning_for, DROP COLUMN dunning_stage',
               'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- S12: booth sign-ups.
DROP TABLE IF EXISTS booth_signups;

-- S5: server text translations.
DROP TABLE IF EXISTS server_strings;
