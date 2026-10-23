-- =====================================================================================================
-- 2026-10-23  Drop the database objects of the removed modules
-- =====================================================================================================
--
-- RUN ONLY WITH THE USER'S GO-AHEAD.
--   * Run it only AFTER the new API, workers, admin and app builds are deployed. Never run it on a
--     database that is still served by old code: old builds read and write these tables and columns.
--   * Take a backup first (mysqldump --single-transaction --routines --triggers ...). There is no down
--     script: to undo, restore that backup. The dropped definitions stay in git history
--     (row/database/schema.sql before 2026-10-23).
--   * Run it as the database admin user: it drops and re-creates stored procedures and a trigger.
--   * It is re-runnable: every step checks that the object still exists. If a run stops half-way, fix
--     the cause and run the whole file again.
--
-- How to run: the mysql command-line client in batch mode (input redirected from the file). Do not run it
-- with `source` in an interactive session: the client does not stop at an error there.
--   1. Dry run. Changes nothing: prints the target database and the PRE-CHECK counts, then stops with
--      "Table '<db>.row_cleanup_confirm__not_set__nothing_was_changed' doesn't exist".
--        mysql -h <host> -u <admin> -p --default-character-set=utf8mb4 <database> < 2026-10-23-drop-removed-modules.sql
--   2. Real run, after the counts are reviewed:
--        mysql -h <host> -u <admin> -p --default-character-set=utf8mb4 --init-command="SET @row_cleanup_confirm = 'yes'" <database> < 2026-10-23-drop-removed-modules.sql
--
-- What it removes:
--   S1  club moderation: district_club_moderator, the project approval_* columns, roles row 5, 2 routes
--   S2  RI Director: 3 ri_director_* tables, the Recipient* columns, roles row 7, the /ri-director routes
--   S3  zonal dashboard: roles row 4, its route, the sp_zonal_* procedures
--   S4  zonal awards: 5 zonal_awards_* tables, zone_master.IsZonalAwardsEnabled, club_master.Is_healthy_club
--   S5  goal lock, S6 goal setting roles: 7 goal_* tables, goal_comments.fk_assignment_id
--   S7  directory data collection: 3 directory tables
--   S8  direct beneficiary approvals: beneficiary_approval_requests, the system-settings procedures
--   S9  PPH camps: 3 pph_camp* tables, the 'PPH Camp' District Awards activity, 3 routes
--   S10 project categories: category_master, sub_category_master, the project category columns,
--       district_citation_auto_question_sub.filter_cat_id, 1 route
--   S11 market place, and the club_moderator / zonal_awards / pph_camp tiles: their club, district and
--       edition assignments (the module_master rows stay soft-deleted, as the API initializer leaves them)
--   S13 WhatsApp and SMS: whatsapp_log and every WhatsApp / SMS send column
-- Role ids 4, 5 and 7 stay reserved: never reuse them.
-- =====================================================================================================

SET NAMES utf8mb4;
SET SESSION group_concat_max_len = 1000000;

SELECT DATABASE() AS target_database, @@hostname AS server_host, @@port AS server_port, VERSION() AS server_version;

-- -----------------------------------------------------------------------------------------------------
-- PRE-CHECK: what would be lost
-- -----------------------------------------------------------------------------------------------------

-- Rows in every table this script drops (tables that are already gone are not listed).
SET @row_sql = (
    SELECT GROUP_CONCAT(CONCAT('SELECT ''', TABLE_NAME, ''' AS dropped_table, COUNT(*) AS row_count FROM `', TABLE_NAME, '`')
                        ORDER BY TABLE_NAME SEPARATOR ' UNION ALL ')
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME IN ('district_club_moderator', 'ri_director_credit_usage_history', 'ri_director_credits', 'ri_director_credential_email', 'zonal_awards_district_entry', 'zonal_awards_import_log', 'zonal_awards_question_option', 'zonal_awards_question', 'zonal_awards_goal', 'goal_role_assignment_districts', 'goal_role_assignment_zones', 'goal_role_assignments', 'goal_locks', 'goal_leadership_designations', 'goal_message_seen', 'goal_oversight_access', 'directory_data_member_status', 'district_directory_submission_log', 'district_directory_config', 'beneficiary_approval_requests', 'pph_camp_attendance', 'pph_camp_attendies', 'pph_camps', 'whatsapp_log', 'sub_category_master', 'category_master'));
SET @row_sql = COALESCE(@row_sql, 'SELECT ''(none left)'' AS dropped_table, 0 AS row_count');
PREPARE row_stmt FROM @row_sql; EXECUTE row_stmt; DEALLOCATE PREPARE row_stmt;

-- Rows that hold a value (not NULL, 0, '' or the 'not_sent' default) in a column this script drops.
SET @row_sql = (
    SELECT GROUP_CONCAT(CONCAT('SELECT ''', c.TABLE_NAME, '.', c.COLUMN_NAME, ''' AS dropped_column, COUNT(*) AS rows_with_a_value FROM `',
                               c.TABLE_NAME, '` WHERE `', c.COLUMN_NAME, '` IS NOT NULL AND CAST(`', c.COLUMN_NAME,
                               '` AS CHAR) NOT IN (''0'', '''', ''not_sent'')')
                        ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION SEPARATOR ' UNION ALL ')
    FROM information_schema.COLUMNS c
    WHERE c.TABLE_SCHEMA = DATABASE()
      AND ((c.TABLE_NAME REGEXP '^rotary_projects(_[0-9]{4}_[0-9]{2})?$' AND c.COLUMN_NAME IN ('approval_status', 'approval_remark', 'approved_by', 'approval_date', 'approval_token', 'fk_category_id', 'other_category', 'fk_sub_category_id', 'other_sub_category', 'send_whatsapp', 'IsSendWhatsapp', 'WhatsAppSentDate', 'WhatsAppSentCount', 'WhatsAppFailedCount'))
           OR CONCAT(c.TABLE_NAME, '.', c.COLUMN_NAME) IN ('announcements.IsSendWhatsapp', 'announcements.WhatsAppSentDate', 'announcements.WhatsAppSentCount', 'announcements.WhatsAppFailedCount', 'announcements.RecipientTarget', 'announcements.RecipientZoneIds', 'announcements.RecipientDistrictIds', 'announcements.RecipientSubgroupIds', 'upcoming_events.IsSendWhatsapp', 'upcoming_events.WhatsAppSentDate', 'upcoming_events.WhatsAppSentCount', 'upcoming_events.WhatsAppFailedCount', 'upcoming_events.RecipientTarget', 'upcoming_events.RecipientZoneIds', 'upcoming_events.RecipientDistrictIds', 'upcoming_events.RecipientSubgroupIds', 'newsletters.IsSendWhatsapp', 'newsletters.WhatsAppSentDate', 'newsletters.WhatsAppSentCount', 'newsletters.WhatsAppFailedCount', 'newsletters.RecipientTarget', 'newsletters.RecipientZoneIds', 'newsletters.RecipientDistrictIds', 'newsletters.RecipientSubgroupIds', 'club_mass_emails.RecipientTarget', 'club_mass_emails.RecipientZoneIds', 'club_mass_emails.RecipientDistrictIds', 'club_mass_emails.RecipientSubgroupIds', 'club_documents.RecipientTarget', 'club_documents.RecipientZoneIds', 'club_documents.RecipientDistrictIds', 'weblinks.RecipientTarget', 'weblinks.RecipientZoneIds', 'weblinks.RecipientDistrictIds', 'announcement_reminders.WhatsAppSentDate', 'announcement_reminders.WhatsAppSentCount', 'announcement_reminders.WhatsAppFailedCount', 'upcoming_event_reminders.WhatsAppSentDate', 'upcoming_event_reminders.WhatsAppSentCount', 'upcoming_event_reminders.WhatsAppFailedCount', 'club_master.IsGreetingSendWhatsapp', 'club_master.Is_healthy_club', 'district_master.IsGreetingSendWhatsapp', 'zone_master.IsZonalAwardsEnabled', 'district_report_reminder_log.whatsapp_status', 'mobile_login_otp.sent_whatsapp', 'mobile_login_otp.sent_sms', 'goal_comments.fk_assignment_id', 'district_citation_auto_question_sub.filter_cat_id')));
SET @row_sql = COALESCE(@row_sql, 'SELECT ''(none left)'' AS dropped_column, 0 AS rows_with_a_value');
PREPARE row_stmt FROM @row_sql; EXECUTE row_stmt; DEALLOCATE PREPARE row_stmt;

-- Rows this script deletes from tables that stay.
SELECT 'roles 4, 5, 7 (ZonalCoordinator, ClubModerator, RIDirector)' AS deleted_rows, COUNT(*) AS row_count
    FROM roles WHERE pk_role_id IN (4, 5, 7)
UNION ALL SELECT 'member_roles rows with role 4, 5 or 7 (each keeps its roles row; expected 0)', COUNT(*)
    FROM member_roles WHERE fk_role_id IN (4, 5, 7)
UNION ALL SELECT 'route_maintenance rows of removed pages', COUNT(*)
    FROM route_maintenance WHERE RouteKey IN ('/settings/categories', '/districts/:id/club-moderator', '/club-moderator', '/zonal-dashboard', '/districts/:id/zonal-awards', '/districts/:id/rni-camp', '/districts/:id/rni-camp/:campId/attendance', '/clubs/:id/pph-camps')
         OR RouteKey = '/ri-director' OR RouteKey LIKE '/ri-director/%'
UNION ALL SELECT 'club_modules rows of removed modules', COUNT(*)
    FROM club_modules WHERE fk_module_id IN (SELECT pk_module_id FROM module_master WHERE ModuleKey IN ('market_place', 'zonal_awards', 'pph_camp', 'club_moderator'))
UNION ALL SELECT 'district_modules rows of removed modules', COUNT(*)
    FROM district_modules WHERE fk_module_id IN (SELECT pk_module_id FROM module_master WHERE ModuleKey IN ('market_place', 'zonal_awards', 'pph_camp', 'club_moderator'))
UNION ALL SELECT 'edition_modules rows of removed modules', COUNT(*)
    FROM edition_modules WHERE module_key IN ('market_place', 'zonal_awards', 'pph_camp', 'club_moderator')
UNION ALL SELECT 'district_citation_activity_master ''PPH Camp'' not used by an auto question', COUNT(*)
    FROM district_citation_activity_master WHERE activity_name = 'PPH Camp'
        AND NOT EXISTS (SELECT 1 FROM district_citation_auto_question q WHERE q.fk_activity_id = district_citation_activity_master.pk_id)
UNION ALL SELECT 'system_settings ''direct_beneficiaries_limit''', COUNT(*)
    FROM system_settings WHERE SettingKey = 'direct_beneficiaries_limit';

-- -----------------------------------------------------------------------------------------------------
-- CONFIRMATION GUARD: the run stops here unless @row_cleanup_confirm = 'yes' (see "How to run").
-- The error is the intended stop; nothing has been changed yet.
-- -----------------------------------------------------------------------------------------------------
SET @row_sql = IF(@row_cleanup_confirm = 'yes' AND DATABASE() IS NOT NULL,
    'SELECT ''confirmed: dropping the removed modules'' AS row_cleanup',
    'SELECT * FROM `row_cleanup_confirm__not_set__nothing_was_changed`');
PREPARE row_stmt FROM @row_sql; EXECUTE row_stmt; DEALLOCATE PREPARE row_stmt;

-- -----------------------------------------------------------------------------------------------------
-- Helpers, dropped again at the end. MySQL has no DROP COLUMN / DROP INDEX IF EXISTS.
-- -----------------------------------------------------------------------------------------------------
DELIMITER $$

-- Drops the foreign keys that match: on p_table.p_column, or pointing at p_referenced (NULL = any).
DROP PROCEDURE IF EXISTS _row_cleanup_drop_fks $$
CREATE PROCEDURE _row_cleanup_drop_fks(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_referenced VARCHAR(64))
BEGIN
    DECLARE v_table VARCHAR(64);
    DECLARE v_fk VARCHAR(64);
    DROP TEMPORARY TABLE IF EXISTS _row_cleanup_fks;
    CREATE TEMPORARY TABLE _row_cleanup_fks (t VARCHAR(64), fk VARCHAR(64), PRIMARY KEY (t, fk));
    INSERT IGNORE INTO _row_cleanup_fks
        SELECT TABLE_NAME, CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
          AND (p_table IS NULL OR TABLE_NAME = p_table)
          AND (p_column IS NULL OR COLUMN_NAME = p_column)
          AND (p_referenced IS NULL OR REFERENCED_TABLE_NAME = p_referenced);
    WHILE (SELECT COUNT(*) FROM _row_cleanup_fks) > 0 DO
        SELECT t, fk INTO v_table, v_fk FROM _row_cleanup_fks ORDER BY t, fk LIMIT 1;
        SET @row_ddl = CONCAT('ALTER TABLE `', v_table, '` DROP FOREIGN KEY `', v_fk, '`');
        PREPARE row_ddl_stmt FROM @row_ddl; EXECUTE row_ddl_stmt; DEALLOCATE PREPARE row_ddl_stmt;
        DELETE FROM _row_cleanup_fks WHERE t = v_table AND fk = v_fk;
    END WHILE;
    DROP TEMPORARY TABLE _row_cleanup_fks;
END $$

DROP PROCEDURE IF EXISTS _row_cleanup_drop_column $$
CREATE PROCEDURE _row_cleanup_drop_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64))
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column) THEN
        CALL _row_cleanup_drop_fks(p_table, p_column, NULL);  -- a foreign key blocks DROP COLUMN
        SET @row_ddl = CONCAT('ALTER TABLE `', p_table, '` DROP COLUMN `', p_column, '`');
        PREPARE row_ddl_stmt FROM @row_ddl; EXECUTE row_ddl_stmt; DEALLOCATE PREPARE row_ddl_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS _row_cleanup_drop_index $$
CREATE PROCEDURE _row_cleanup_drop_index(IN p_table VARCHAR(64), IN p_index VARCHAR(64))
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index) THEN
        SET @row_ddl = CONCAT('ALTER TABLE `', p_table, '` DROP INDEX `', p_index, '`');
        PREPARE row_ddl_stmt FROM @row_ddl; EXECUTE row_ddl_stmt; DEALLOCATE PREPARE row_ddl_stmt;
    END IF;
END $$

-- Drops p_column from rotary_projects and from every year table rotary_projects_YYYY_YY that exists now.
DROP PROCEDURE IF EXISTS _row_cleanup_drop_project_column $$
CREATE PROCEDURE _row_cleanup_drop_project_column(IN p_column VARCHAR(64))
BEGIN
    DECLARE v_table VARCHAR(64);
    DROP TEMPORARY TABLE IF EXISTS _row_cleanup_project_tables;
    CREATE TEMPORARY TABLE _row_cleanup_project_tables (t VARCHAR(64) PRIMARY KEY);
    INSERT INTO _row_cleanup_project_tables
        SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
          AND TABLE_NAME REGEXP '^rotary_projects(_[0-9]{4}_[0-9]{2})?$';
    WHILE (SELECT COUNT(*) FROM _row_cleanup_project_tables) > 0 DO
        SELECT MIN(t) INTO v_table FROM _row_cleanup_project_tables;
        CALL _row_cleanup_drop_column(v_table, p_column);
        DELETE FROM _row_cleanup_project_tables WHERE t = v_table;
    END WHILE;
    DROP TEMPORARY TABLE _row_cleanup_project_tables;
END $$

DELIMITER ;

-- -----------------------------------------------------------------------------------------------------
-- 1. Trigger: the project audit trigger stops reading the dropped category columns. It is re-created
--    first, so no UPDATE on rotary_projects meets a trigger that names a dropped column.
-- -----------------------------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_project_after_update;
DELIMITER $$

CREATE TRIGGER trg_project_after_update
AFTER UPDATE ON rotary_projects
FOR EACH ROW
BEGIN
    -- Check if this is a soft delete
    IF OLD.isdeleted = 0 AND NEW.isdeleted = 1 THEN
        INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
        VALUES (NEW.pk_project_id, NEW.fk_club_id, 'DELETE', 'title', OLD.title, NULL, NEW.deleted_by, NOW());
    ELSE
        -- Log each changed field
        IF OLD.title != NEW.title OR (OLD.title IS NULL AND NEW.title IS NOT NULL) OR (OLD.title IS NOT NULL AND NEW.title IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'title', OLD.title, NEW.title, NEW.modified_by, NOW());
        END IF;
        IF OLD.description != NEW.description OR (OLD.description IS NULL AND NEW.description IS NOT NULL) OR (OLD.description IS NOT NULL AND NEW.description IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'description', OLD.description, NEW.description, NEW.modified_by, NOW());
        END IF;
        IF OLD.location != NEW.location OR (OLD.location IS NULL AND NEW.location IS NOT NULL) OR (OLD.location IS NOT NULL AND NEW.location IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'location', OLD.location, NEW.location, NEW.modified_by, NOW());
        END IF;
        IF OLD.project_type != NEW.project_type THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'project_type', OLD.project_type, NEW.project_type, NEW.modified_by, NOW());
        END IF;
        IF OLD.project_date != NEW.project_date OR (OLD.project_date IS NULL AND NEW.project_date IS NOT NULL) OR (OLD.project_date IS NOT NULL AND NEW.project_date IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'project_date', CAST(OLD.project_date AS CHAR), CAST(NEW.project_date AS CHAR), NEW.modified_by, NOW());
        END IF;
        IF OLD.project_cost != NEW.project_cost OR (OLD.project_cost IS NULL AND NEW.project_cost IS NOT NULL) OR (OLD.project_cost IS NOT NULL AND NEW.project_cost IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'project_cost', CAST(OLD.project_cost AS CHAR), CAST(NEW.project_cost AS CHAR), NEW.modified_by, NOW());
        END IF;
        IF OLD.fk_area_of_focus_id != NEW.fk_area_of_focus_id OR (OLD.fk_area_of_focus_id IS NULL AND NEW.fk_area_of_focus_id IS NOT NULL) OR (OLD.fk_area_of_focus_id IS NOT NULL AND NEW.fk_area_of_focus_id IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'area_of_focus', CAST(OLD.fk_area_of_focus_id AS CHAR), CAST(NEW.fk_area_of_focus_id AS CHAR), NEW.modified_by, NOW());
        END IF;
        IF OLD.fk_funding_id != NEW.fk_funding_id OR (OLD.fk_funding_id IS NULL AND NEW.fk_funding_id IS NOT NULL) OR (OLD.fk_funding_id IS NOT NULL AND NEW.fk_funding_id IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'funding', CAST(OLD.fk_funding_id AS CHAR), CAST(NEW.fk_funding_id AS CHAR), NEW.modified_by, NOW());
        END IF;
        IF OLD.direct_beneficiaries != NEW.direct_beneficiaries OR (OLD.direct_beneficiaries IS NULL AND NEW.direct_beneficiaries IS NOT NULL) OR (OLD.direct_beneficiaries IS NOT NULL AND NEW.direct_beneficiaries IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'direct_beneficiaries', CAST(OLD.direct_beneficiaries AS CHAR), CAST(NEW.direct_beneficiaries AS CHAR), NEW.modified_by, NOW());
        END IF;
        IF OLD.man_hours != NEW.man_hours OR (OLD.man_hours IS NULL AND NEW.man_hours IS NOT NULL) OR (OLD.man_hours IS NOT NULL AND NEW.man_hours IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'man_hours', CAST(OLD.man_hours AS CHAR), CAST(NEW.man_hours AS CHAR), NEW.modified_by, NOW());
        END IF;
        IF OLD.rotarians_involved != NEW.rotarians_involved OR (OLD.rotarians_involved IS NULL AND NEW.rotarians_involved IS NOT NULL) OR (OLD.rotarians_involved IS NOT NULL AND NEW.rotarians_involved IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'rotarians_involved', CAST(OLD.rotarians_involved AS CHAR), CAST(NEW.rotarians_involved AS CHAR), NEW.modified_by, NOW());
        END IF;
        IF OLD.rotaractors_involved != NEW.rotaractors_involved OR (OLD.rotaractors_involved IS NULL AND NEW.rotaractors_involved IS NOT NULL) OR (OLD.rotaractors_involved IS NOT NULL AND NEW.rotaractors_involved IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'rotaractors_involved', CAST(OLD.rotaractors_involved AS CHAR), CAST(NEW.rotaractors_involved AS CHAR), NEW.modified_by, NOW());
        END IF;
        IF OLD.rcc_involved != NEW.rcc_involved OR (OLD.rcc_involved IS NULL AND NEW.rcc_involved IS NOT NULL) OR (OLD.rcc_involved IS NOT NULL AND NEW.rcc_involved IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'rcc_involved', CAST(OLD.rcc_involved AS CHAR), CAST(NEW.rcc_involved AS CHAR), NEW.modified_by, NOW());
        END IF;
        IF OLD.is_joint_project != NEW.is_joint_project THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'is_joint_project', CAST(OLD.is_joint_project AS CHAR), CAST(NEW.is_joint_project AS CHAR), NEW.modified_by, NOW());
        END IF;
        IF OLD.co_host_name != NEW.co_host_name OR (OLD.co_host_name IS NULL AND NEW.co_host_name IS NOT NULL) OR (OLD.co_host_name IS NOT NULL AND NEW.co_host_name IS NULL) THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'co_host_name', OLD.co_host_name, NEW.co_host_name, NEW.modified_by, NOW());
        END IF;
        IF OLD.is_active != NEW.is_active THEN
            INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
            VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'is_active', CAST(OLD.is_active AS CHAR), CAST(NEW.is_active AS CHAR), NEW.modified_by, NOW());
        END IF;
    END IF;
END $$

DELIMITER ;

-- -----------------------------------------------------------------------------------------------------
-- 2. Procedures the code still defines, re-created from DatabaseInitializer.StoredProcedures.cs without
--    the removed parameters, columns, joins and roles. No C# code calls them.
-- -----------------------------------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_announcement_create;
DELIMITER $$
CREATE PROCEDURE sp_announcement_create(
    IN p_ClubId INT,
    IN p_Title VARCHAR(50),
    IN p_Description VARCHAR(1000),
    IN p_ImagePath VARCHAR(500),
    IN p_PublishDateTime DATETIME,
    IN p_ExpiryDateTime DATETIME,
    IN p_IsDisplayOnBanner TINYINT,
    IN p_IsRepeatNotification TINYINT,
    IN p_CreatedBy INT
)
BEGIN
    INSERT INTO announcements (fk_club_id, Title, Description, ImagePath, PublishDateTime, ExpiryDateTime, IsDisplayOnBanner, IsRepeatNotification, created_by)
    VALUES (p_ClubId, p_Title, p_Description, p_ImagePath, p_PublishDateTime, p_ExpiryDateTime, p_IsDisplayOnBanner, p_IsRepeatNotification, p_CreatedBy);

    SELECT LAST_INSERT_ID();
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_announcement_get_all_paginated;
DELIMITER $$
CREATE PROCEDURE sp_announcement_get_all_paginated(
    IN p_ClubId INT,
    IN p_YearId INT,
    IN p_Status VARCHAR(20),
    IN p_Search VARCHAR(200),
    IN p_Page INT,
    IN p_PageSize INT
)
BEGIN
    DECLARE v_Offset INT;
    SET v_Offset = (p_Page - 1) * p_PageSize;

    SELECT a.pk_announcement_id AS Id,
           a.fk_club_id AS ClubId,
           a.Title,
           a.Description,
           a.ImagePath,
           a.PublishDateTime,
           a.ExpiryDateTime,
           a.IsDisplayOnBanner,
           a.IsRepeatNotification,
           CASE
               WHEN a.ExpiryDateTime < NOW() THEN 'Expired'
               WHEN a.PublishDateTime <= NOW() AND a.ExpiryDateTime >= NOW() THEN 'Published'
               ELSE 'Unpublished'
           END AS Status,
           (SELECT COUNT(*) FROM announcement_reminders r WHERE r.fk_announcement_id = a.pk_announcement_id AND r.IsActive = 1) AS ReminderCount
    FROM announcements a
    JOIN rotary_year_master y ON y.pk_year_id = p_YearId
    WHERE a.fk_club_id = p_ClubId
      AND a.PublishDateTime >= y.StartDate
      AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
      AND a.isdeleted = 0
      AND (p_Status = '' OR
           (p_Status = 'Published' AND a.PublishDateTime <= NOW() AND a.ExpiryDateTime >= NOW()) OR
           (p_Status = 'Expired' AND a.ExpiryDateTime < NOW()) OR
           (p_Status = 'Unpublished' AND a.PublishDateTime > NOW()))
      AND (p_Search = '' OR a.Title LIKE CONCAT('%', p_Search, '%'))
    ORDER BY a.PublishDateTime DESC
    LIMIT p_PageSize OFFSET v_Offset;

    SELECT COUNT(*)
    FROM announcements a
    JOIN rotary_year_master y ON y.pk_year_id = p_YearId
    WHERE a.fk_club_id = p_ClubId
      AND a.PublishDateTime >= y.StartDate
      AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
      AND a.isdeleted = 0
      AND (p_Status = '' OR
           (p_Status = 'Published' AND a.PublishDateTime <= NOW() AND a.ExpiryDateTime >= NOW()) OR
           (p_Status = 'Expired' AND a.ExpiryDateTime < NOW()) OR
           (p_Status = 'Unpublished' AND a.PublishDateTime > NOW()))
      AND (p_Search = '' OR a.Title LIKE CONCAT('%', p_Search, '%'));
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_announcement_get_by_id;
DELIMITER $$
CREATE PROCEDURE sp_announcement_get_by_id(
    IN p_Id INT
)
BEGIN
    SELECT a.pk_announcement_id AS Id,
           a.fk_club_id AS ClubId,
           a.Title,
           a.Description,
           a.ImagePath,
           a.PublishDateTime,
           a.ExpiryDateTime,
           a.IsDisplayOnBanner,
           a.IsRepeatNotification,
           CASE
               WHEN a.ExpiryDateTime < NOW() THEN 'Expired'
               WHEN a.PublishDateTime <= NOW() AND a.ExpiryDateTime >= NOW() THEN 'Published'
               ELSE 'Unpublished'
           END AS Status
    FROM announcements a
    WHERE a.pk_announcement_id = p_Id
      AND a.isdeleted = 0;

    SELECT r.pk_reminder_id AS Id,
           r.ReminderDateTime
    FROM announcement_reminders r
    WHERE r.fk_announcement_id = p_Id
      AND r.IsActive = 1
    ORDER BY r.ReminderDateTime;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_announcement_update;
DELIMITER $$
CREATE PROCEDURE sp_announcement_update(
    IN p_Id INT,
    IN p_Title VARCHAR(50),
    IN p_Description VARCHAR(1000),
    IN p_ImagePath VARCHAR(500),
    IN p_PublishDateTime DATETIME,
    IN p_ExpiryDateTime DATETIME,
    IN p_IsDisplayOnBanner TINYINT,
    IN p_IsRepeatNotification TINYINT,
    IN p_ModifiedBy INT
)
BEGIN
    UPDATE announcements
    SET Title = p_Title,
        Description = p_Description,
        ImagePath = p_ImagePath,
        PublishDateTime = p_PublishDateTime,
        ExpiryDateTime = p_ExpiryDateTime,
        IsDisplayOnBanner = p_IsDisplayOnBanner,
        IsRepeatNotification = p_IsRepeatNotification,
        modified_by = p_ModifiedBy
    WHERE pk_announcement_id = p_Id
      AND isdeleted = 0;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_auth_check_admin_access;
DELIMITER $$
CREATE PROCEDURE sp_auth_check_admin_access(
    IN p_MemberId INT
)
BEGIN
    SELECT COUNT(*)
    FROM member_roles mr
    JOIN roles r ON r.pk_role_id = mr.fk_role_id
    WHERE mr.fk_member_master_profile_id = p_MemberId
      AND mr.IsActive = 1
      AND mr.isdeleted = 0
      AND r.RoleName IN ('Admin', 'SuperAdmin');
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_auth_get_admin_roles;
DELIMITER $$
CREATE PROCEDURE sp_auth_get_admin_roles(
    IN p_MemberId INT
)
BEGIN
    SELECT r.RoleName
    FROM member_roles mr
    JOIN roles r ON r.pk_role_id = mr.fk_role_id
    WHERE mr.fk_member_master_profile_id = p_MemberId
      AND mr.IsActive = 1
      AND mr.isdeleted = 0
      AND r.RoleName IN ('Admin', 'SuperAdmin');
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_document_get_all_paginated;
DELIMITER $$
CREATE PROCEDURE sp_document_get_all_paginated(
    IN p_ClubId INT,
    IN p_YearId INT,
    IN p_Status VARCHAR(20),
    IN p_Search VARCHAR(200),
    IN p_Page INT,
    IN p_PageSize INT
)
BEGIN
    DECLARE v_Offset INT;
    SET v_Offset = (p_Page - 1) * p_PageSize;

    SELECT d.pk_document_id AS Id,
           d.fk_club_id AS ClubId,
           d.fk_year_id AS YearId,
           d.Title,
           d.AccessType,
           CASE
               WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
               WHEN d.FilePath LIKE '/%' THEN d.FilePath
               WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
               ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath)
           END AS FilePath,
           d.OriginalFileName,
           d.PublishDateTime,
           d.ExpiryDateTime,
           CASE
               WHEN d.ExpiryDateTime < NOW() THEN 'Expired'
               WHEN d.PublishDateTime <= NOW() AND d.ExpiryDateTime >= NOW() THEN 'Published'
               ELSE 'Unpublished'
           END AS Status
    FROM club_documents d
    WHERE d.fk_club_id = p_ClubId
      AND d.fk_year_id = p_YearId
      AND d.isdeleted = 0
      AND (p_Status = '' OR
           (p_Status = 'Published' AND d.PublishDateTime <= NOW() AND d.ExpiryDateTime >= NOW()) OR
           (p_Status = 'Expired' AND d.ExpiryDateTime < NOW()) OR
           (p_Status = 'Unpublished' AND d.PublishDateTime > NOW()))
      AND (p_Search = '' OR d.Title LIKE CONCAT('%', p_Search, '%'))
    ORDER BY d.PublishDateTime DESC
    LIMIT p_PageSize OFFSET v_Offset;

    SELECT COUNT(*)
    FROM club_documents d
    WHERE d.fk_club_id = p_ClubId
      AND d.fk_year_id = p_YearId
      AND d.isdeleted = 0
      AND (p_Status = '' OR
           (p_Status = 'Published' AND d.PublishDateTime <= NOW() AND d.ExpiryDateTime >= NOW()) OR
           (p_Status = 'Expired' AND d.ExpiryDateTime < NOW()) OR
           (p_Status = 'Unpublished' AND d.PublishDateTime > NOW()))
      AND (p_Search = '' OR d.Title LIKE CONCAT('%', p_Search, '%'));
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_document_get_by_id;
DELIMITER $$
CREATE PROCEDURE sp_document_get_by_id(
    IN p_Id INT
)
BEGIN
    SELECT d.pk_document_id AS Id,
           d.fk_club_id AS ClubId,
           d.fk_year_id AS YearId,
           d.Title,
           d.AccessType,
           CASE
               WHEN d.FilePath IS NULL OR d.FilePath = '' THEN NULL
               WHEN d.FilePath LIKE '/%' THEN d.FilePath
               WHEN d.fk_district_id IS NOT NULL THEN CONCAT('/Documents/documentsafe/Group', d.fk_district_id, '/', d.FilePath)
               ELSE CONCAT('/Documents/documentsafe/Group', d.fk_club_id, '/', d.FilePath)
           END AS FilePath,
           d.OriginalFileName,
           d.PublishDateTime,
           d.ExpiryDateTime,
           CASE
               WHEN d.ExpiryDateTime < NOW() THEN 'Expired'
               WHEN d.PublishDateTime <= NOW() AND d.ExpiryDateTime >= NOW() THEN 'Published'
               ELSE 'Unpublished'
           END AS Status
    FROM club_documents d
    WHERE d.pk_document_id = p_Id
      AND d.isdeleted = 0;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_greeting_get_settings;
DELIMITER $$
CREATE PROCEDURE sp_greeting_get_settings(IN p_ClubId INT)
BEGIN
    SELECT
        BirthdayGreeting, IsEnableBirthdayNotification,
        AnniversaryGreeting, IsEnableAnniversaryNotification,
        IsGreetingSendEmail,
        IsEnableBirthdayEmail, BirthdayEmailFrom, BirthdayEmailSubject, BirthdayEmailMessage,
        IsEnableAnniversaryEmail, AnniversaryEmailFrom, AnniversaryEmailSubject, AnniversaryEmailMessage
    FROM club_master
    WHERE pk_club_id = p_ClubId AND isdeleted = 0;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_greeting_update_settings;
DELIMITER $$
CREATE PROCEDURE sp_greeting_update_settings(
    IN p_ClubId INT,
    IN p_BirthdayGreeting VARCHAR(700),
    IN p_IsEnableBirthdayNotification TINYINT,
    IN p_AnniversaryGreeting VARCHAR(700),
    IN p_IsEnableAnniversaryNotification TINYINT,
    IN p_IsGreetingSendEmail TINYINT,
    IN p_IsEnableBirthdayEmail TINYINT,
    IN p_BirthdayEmailFrom VARCHAR(200),
    IN p_BirthdayEmailSubject VARCHAR(200),
    IN p_BirthdayEmailMessage TEXT,
    IN p_IsEnableAnniversaryEmail TINYINT,
    IN p_AnniversaryEmailFrom VARCHAR(200),
    IN p_AnniversaryEmailSubject VARCHAR(200),
    IN p_AnniversaryEmailMessage TEXT,
    IN p_ModifiedBy INT
)
BEGIN
    UPDATE club_master SET
        BirthdayGreeting = p_BirthdayGreeting,
        IsEnableBirthdayNotification = p_IsEnableBirthdayNotification,
        AnniversaryGreeting = p_AnniversaryGreeting,
        IsEnableAnniversaryNotification = p_IsEnableAnniversaryNotification,
        IsGreetingSendEmail = p_IsGreetingSendEmail,
        IsEnableBirthdayEmail = p_IsEnableBirthdayEmail,
        BirthdayEmailFrom = p_BirthdayEmailFrom,
        BirthdayEmailSubject = p_BirthdayEmailSubject,
        BirthdayEmailMessage = p_BirthdayEmailMessage,
        IsEnableAnniversaryEmail = p_IsEnableAnniversaryEmail,
        AnniversaryEmailFrom = p_AnniversaryEmailFrom,
        AnniversaryEmailSubject = p_AnniversaryEmailSubject,
        AnniversaryEmailMessage = p_AnniversaryEmailMessage,
        modified_by = p_ModifiedBy,
        modified_date = NOW()
    WHERE pk_club_id = p_ClubId AND isdeleted = 0;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_newsletter_create;
DELIMITER $$
CREATE PROCEDURE sp_newsletter_create(
    IN p_ClubId INT,
    IN p_Title VARCHAR(50),
    IN p_PublishDateTime DATETIME,
    IN p_ExpiryDateTime DATETIME,
    IN p_AttachmentType VARCHAR(10),
    IN p_LinkUrl VARCHAR(500),
    IN p_FilePath VARCHAR(500),
    IN p_CreatedBy INT
)
BEGIN
    INSERT INTO newsletters (fk_club_id, Title, PublishDateTime, ExpiryDateTime, AttachmentType, LinkUrl, FilePath, created_by)
    VALUES (p_ClubId, p_Title, p_PublishDateTime, p_ExpiryDateTime, p_AttachmentType, p_LinkUrl, p_FilePath, p_CreatedBy);

    SELECT LAST_INSERT_ID();
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_newsletter_get_all_paginated;
DELIMITER $$
CREATE PROCEDURE sp_newsletter_get_all_paginated(
    IN p_ClubId INT,
    IN p_YearId INT,
    IN p_Status VARCHAR(20),
    IN p_Search VARCHAR(200),
    IN p_Page INT,
    IN p_PageSize INT
)
BEGIN
    DECLARE v_Offset INT;
    SET v_Offset = (p_Page - 1) * p_PageSize;

    SELECT n.pk_newsletter_id AS Id,
           n.fk_club_id AS ClubId,
           n.Title,
           n.PublishDateTime,
           n.ExpiryDateTime,
           n.AttachmentType,
           n.LinkUrl,
           n.FilePath,
           CASE
               WHEN n.ExpiryDateTime < NOW() THEN 'Expired'
               WHEN n.PublishDateTime <= NOW() AND n.ExpiryDateTime >= NOW() THEN 'Published'
               ELSE 'Unpublished'
           END AS Status
    FROM newsletters n
    JOIN rotary_year_master y ON y.pk_year_id = p_YearId
    WHERE n.fk_club_id = p_ClubId
      AND n.PublishDateTime >= y.StartDate
      AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
      AND n.isdeleted = 0
      AND (p_Status = '' OR
           (p_Status = 'Published' AND n.PublishDateTime <= NOW() AND n.ExpiryDateTime >= NOW()) OR
           (p_Status = 'Expired' AND n.ExpiryDateTime < NOW()) OR
           (p_Status = 'Unpublished' AND n.PublishDateTime > NOW()))
      AND (p_Search = '' OR n.Title LIKE CONCAT('%', p_Search, '%'))
    ORDER BY n.PublishDateTime DESC
    LIMIT p_PageSize OFFSET v_Offset;

    SELECT COUNT(*)
    FROM newsletters n
    JOIN rotary_year_master y ON y.pk_year_id = p_YearId
    WHERE n.fk_club_id = p_ClubId
      AND n.PublishDateTime >= y.StartDate
      AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
      AND n.isdeleted = 0
      AND (p_Status = '' OR
           (p_Status = 'Published' AND n.PublishDateTime <= NOW() AND n.ExpiryDateTime >= NOW()) OR
           (p_Status = 'Expired' AND n.ExpiryDateTime < NOW()) OR
           (p_Status = 'Unpublished' AND n.PublishDateTime > NOW()))
      AND (p_Search = '' OR n.Title LIKE CONCAT('%', p_Search, '%'));
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_newsletter_get_by_id;
DELIMITER $$
CREATE PROCEDURE sp_newsletter_get_by_id(
    IN p_Id INT
)
BEGIN
    SELECT n.pk_newsletter_id AS Id,
           n.fk_club_id AS ClubId,
           n.Title,
           n.PublishDateTime,
           n.ExpiryDateTime,
           n.AttachmentType,
           n.LinkUrl,
           n.FilePath,
           CASE
               WHEN n.ExpiryDateTime < NOW() THEN 'Expired'
               WHEN n.PublishDateTime <= NOW() AND n.ExpiryDateTime >= NOW() THEN 'Published'
               ELSE 'Unpublished'
           END AS Status
    FROM newsletters n
    WHERE n.pk_newsletter_id = p_Id
      AND n.isdeleted = 0;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_newsletter_update;
DELIMITER $$
CREATE PROCEDURE sp_newsletter_update(
    IN p_Id INT,
    IN p_Title VARCHAR(50),
    IN p_PublishDateTime DATETIME,
    IN p_ExpiryDateTime DATETIME,
    IN p_AttachmentType VARCHAR(10),
    IN p_LinkUrl VARCHAR(500),
    IN p_FilePath VARCHAR(500),
    IN p_ModifiedBy INT
)
BEGIN
    UPDATE newsletters
    SET Title = p_Title,
        PublishDateTime = p_PublishDateTime,
        ExpiryDateTime = p_ExpiryDateTime,
        AttachmentType = p_AttachmentType,
        LinkUrl = p_LinkUrl,
        FilePath = p_FilePath,
        modified_by = p_ModifiedBy
    WHERE pk_newsletter_id = p_Id;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_project_create;
DELIMITER $$
CREATE PROCEDURE sp_project_create(
    IN p_ClubId INT,
    IN p_ModuleId INT,
    IN p_YearId INT,
    IN p_ProjectType VARCHAR(20),
    IN p_ParentProjectId INT,
    IN p_OngoingGroupTitle VARCHAR(200),
    IN p_IsJointProject TINYINT,
    IN p_CoHostName VARCHAR(200),
    IN p_ClubRole VARCHAR(10),
    IN p_Title VARCHAR(50),
    IN p_Description VARCHAR(1000),
    IN p_Location VARCHAR(200),
    IN p_AreaOfFocusId INT,
    IN p_OtherAreaOfFocus VARCHAR(100),
    IN p_ProjectDate DATE,
    IN p_ProjectCost DECIMAL(15,2),
    IN p_FundingId INT,
    IN p_DirectBeneficiaries INT,
    IN p_ManHours INT,
    IN p_RotariansInvolved INT,
    IN p_RotaractorsInvolved INT,
    IN p_CreatedBy INT
)
BEGIN
    INSERT INTO rotary_projects (
        fk_club_id, fk_module_id, fk_year_id, project_type, parent_project_id,
        ongoing_group_title, is_joint_project, co_host_name, club_role,
        title, description, location,
        fk_area_of_focus_id, other_area_of_focus,
        project_date, project_cost, fk_funding_id,
        direct_beneficiaries, man_hours, rotarians_involved, rotaractors_involved,
        created_by
    ) VALUES (
        p_ClubId, p_ModuleId, p_YearId, p_ProjectType, p_ParentProjectId,
        p_OngoingGroupTitle, p_IsJointProject, p_CoHostName, p_ClubRole,
        p_Title, p_Description, p_Location,
        p_AreaOfFocusId, p_OtherAreaOfFocus,
        p_ProjectDate, p_ProjectCost, p_FundingId,
        p_DirectBeneficiaries, p_ManHours, p_RotariansInvolved, p_RotaractorsInvolved,
        p_CreatedBy
    );
    SELECT LAST_INSERT_ID();
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_project_get_by_club;
DELIMITER $$
CREATE PROCEDURE sp_project_get_by_club(
    IN p_ClubId INT,
    IN p_ModuleId INT,
    IN p_YearId INT,
    IN p_Page INT,
    IN p_PageSize INT,
    IN p_Search VARCHAR(100)
)
BEGIN
    DECLARE v_Offset INT DEFAULT (p_Page - 1) * p_PageSize;

    SELECT p.pk_project_id AS Id,
           p.fk_club_id AS ClubId,
           p.fk_module_id AS ModuleId,
           p.fk_year_id AS YearId,
           y.YearLabel,
           p.project_type AS ProjectType,
           p.parent_project_id AS ParentProjectId,
           p.ongoing_group_title AS OngoingGroupTitle,
           p.is_joint_project AS IsJointProject,
           p.co_host_name AS CoHostName,
           p.club_role AS ClubRole,
           p.title AS Title,
           p.location AS Location,
           aof.name AS AreaOfFocusName,
           p.other_area_of_focus AS OtherAreaOfFocus,
           p.project_date AS ProjectDate,
           p.project_cost AS ProjectCost,
           f.name AS FundingName,
           p.direct_beneficiaries AS DirectBeneficiaries,
           p.is_active AS IsActive,
           (SELECT image_path FROM rotary_project_photos
            WHERE fk_project_id = p.pk_project_id AND is_primary = 1 LIMIT 1) AS PrimaryPhotoPath
    FROM rotary_projects p
    LEFT JOIN rotary_year_master y ON p.fk_year_id = y.pk_year_id
    LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
    LEFT JOIN funding_master f ON p.fk_funding_id = f.pk_funding_id
    WHERE p.fk_club_id = p_ClubId
      AND p.fk_module_id = p_ModuleId
      AND p.fk_year_id = p_YearId
      AND p.isdeleted = 0
      AND (p_Search IS NULL OR p_Search = '' OR p.title LIKE CONCAT('%', p_Search, '%')
           OR p.location LIKE CONCAT('%', p_Search, '%'))
    ORDER BY p.project_date DESC, p.pk_project_id DESC
    LIMIT v_Offset, p_PageSize;

    SELECT COUNT(*) AS TotalCount
    FROM rotary_projects p
    WHERE p.fk_club_id = p_ClubId
      AND p.fk_module_id = p_ModuleId
      AND p.fk_year_id = p_YearId
      AND p.isdeleted = 0
      AND (p_Search IS NULL OR p_Search = '' OR p.title LIKE CONCAT('%', p_Search, '%')
           OR p.location LIKE CONCAT('%', p_Search, '%'));
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_project_get_by_id;
DELIMITER $$
CREATE PROCEDURE sp_project_get_by_id(IN p_Id INT)
BEGIN
    SELECT p.pk_project_id AS Id,
           p.fk_club_id AS ClubId,
           p.fk_module_id AS ModuleId,
           p.fk_year_id AS YearId,
           y.YearLabel,
           p.project_type AS ProjectType,
           p.parent_project_id AS ParentProjectId,
           p.ongoing_group_title AS OngoingGroupTitle,
           p.is_joint_project AS IsJointProject,
           p.co_host_name AS CoHostName,
           p.club_role AS ClubRole,
           p.title AS Title,
           p.description AS Description,
           p.location AS Location,
           p.fk_area_of_focus_id AS AreaOfFocusId,
           aof.name AS AreaOfFocusName,
           p.other_area_of_focus AS OtherAreaOfFocus,
           p.project_date AS ProjectDate,
           p.project_cost AS ProjectCost,
           p.fk_funding_id AS FundingId,
           f.name AS FundingName,
           p.direct_beneficiaries AS DirectBeneficiaries,
           p.man_hours AS ManHours,
           p.rotarians_involved AS RotariansInvolved,
           p.rotaractors_involved AS RotaractorsInvolved,
           p.is_active AS IsActive
    FROM rotary_projects p
    LEFT JOIN rotary_year_master y ON p.fk_year_id = y.pk_year_id
    LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
    LEFT JOIN funding_master f ON p.fk_funding_id = f.pk_funding_id
    WHERE p.pk_project_id = p_Id AND p.isdeleted = 0;

    SELECT pk_photo_id AS Id,
           fk_project_id AS ProjectId,
           image_path AS ImagePath,
           description AS Description,
           is_primary AS IsPrimary,
           sort_order AS SortOrder
    FROM rotary_project_photos
    WHERE fk_project_id = p_Id
    ORDER BY sort_order;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_project_update;
DELIMITER $$
CREATE PROCEDURE sp_project_update(
    IN p_Id INT,
    IN p_ProjectType VARCHAR(20),
    IN p_ParentProjectId INT,
    IN p_OngoingGroupTitle VARCHAR(200),
    IN p_IsJointProject TINYINT,
    IN p_CoHostName VARCHAR(200),
    IN p_ClubRole VARCHAR(10),
    IN p_Title VARCHAR(50),
    IN p_Description VARCHAR(1000),
    IN p_Location VARCHAR(200),
    IN p_AreaOfFocusId INT,
    IN p_OtherAreaOfFocus VARCHAR(100),
    IN p_ProjectDate DATE,
    IN p_ProjectCost DECIMAL(15,2),
    IN p_FundingId INT,
    IN p_DirectBeneficiaries INT,
    IN p_ManHours INT,
    IN p_RotariansInvolved INT,
    IN p_RotaractorsInvolved INT,
    IN p_ModifiedBy INT
)
BEGIN
    UPDATE rotary_projects
    SET project_type = p_ProjectType,
        parent_project_id = p_ParentProjectId,
        ongoing_group_title = p_OngoingGroupTitle,
        is_joint_project = p_IsJointProject,
        co_host_name = p_CoHostName,
        club_role = p_ClubRole,
        title = p_Title,
        description = p_Description,
        location = p_Location,
        fk_area_of_focus_id = p_AreaOfFocusId,
        other_area_of_focus = p_OtherAreaOfFocus,
        project_date = p_ProjectDate,
        project_cost = p_ProjectCost,
        fk_funding_id = p_FundingId,
        direct_beneficiaries = p_DirectBeneficiaries,
        man_hours = p_ManHours,
        rotarians_involved = p_RotariansInvolved,
        rotaractors_involved = p_RotaractorsInvolved,
        modified_by = p_ModifiedBy
    WHERE pk_project_id = p_Id AND isdeleted = 0;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_role_assign_admin;
DELIMITER $$
CREATE PROCEDURE sp_role_assign_admin(
    IN p_MemberId INT,
    IN p_ClubId INT,
    IN p_AssignedBy INT
)
BEGIN
    DECLARE v_HasConflict INT DEFAULT 0;

    -- Check if member has SuperAdmin role
    SELECT COUNT(*) INTO v_HasConflict
    FROM member_roles mr
    JOIN roles r ON r.pk_role_id = mr.fk_role_id
    WHERE mr.fk_member_master_profile_id = p_MemberId
      AND mr.IsActive = 1 AND mr.isdeleted = 0
      AND r.RoleName = 'SuperAdmin';

    IF v_HasConflict > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Member already has SuperAdmin role. Cannot assign as Admin.';
    END IF;

    INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, AssignedBy)
    SELECT p_MemberId, 2, p_ClubId, p_AssignedBy FROM DUAL
    WHERE NOT EXISTS (
        SELECT 1 FROM member_roles
        WHERE fk_member_master_profile_id = p_MemberId
          AND fk_role_id = 2
          AND fk_club_id = p_ClubId
          AND IsActive = 1
          AND isdeleted = 0
    );
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_upcoming_event_create;
DELIMITER $$
CREATE PROCEDURE sp_upcoming_event_create(
    IN p_ClubId INT,
    IN p_Title VARCHAR(50),
    IN p_Description VARCHAR(1000),
    IN p_ImagePath VARCHAR(500),
    IN p_EventDate DATE,
    IN p_PublishDate DATE,
    IN p_ExpiryDate DATE,
    IN p_EventVenue VARCHAR(255),
    IN p_RegistrationLink VARCHAR(500),
    IN p_IsRepeatNotification TINYINT,
    IN p_CreatedBy INT
)
BEGIN
    INSERT INTO upcoming_events (fk_club_id, Title, Description, ImagePath, EventDate, PublishDate, ExpiryDate, EventVenue, RegistrationLink, IsRepeatNotification, created_by)
    VALUES (p_ClubId, p_Title, p_Description, p_ImagePath, p_EventDate, p_PublishDate, p_ExpiryDate, p_EventVenue, p_RegistrationLink, p_IsRepeatNotification, p_CreatedBy);

    SELECT LAST_INSERT_ID();
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_upcoming_event_get_all_paginated;
DELIMITER $$
CREATE PROCEDURE sp_upcoming_event_get_all_paginated(
    IN p_ClubId INT,
    IN p_YearId INT,
    IN p_Status VARCHAR(20),
    IN p_Search VARCHAR(200),
    IN p_Page INT,
    IN p_PageSize INT
)
BEGIN
    DECLARE v_Offset INT;
    SET v_Offset = (p_Page - 1) * p_PageSize;

    SELECT e.pk_upcoming_event_id AS Id,
           e.fk_club_id AS ClubId,
           e.Title,
           e.Description,
           e.ImagePath,
           e.EventDate,
           e.PublishDate,
           e.ExpiryDate,
           e.EventVenue,
           e.RegistrationLink,
           e.IsRepeatNotification,
           CASE
               WHEN e.ExpiryDate < NOW() THEN 'Expired'
               WHEN e.PublishDate <= NOW() AND e.ExpiryDate >= NOW() THEN 'Published'
               ELSE 'Unpublished'
           END AS Status,
           (SELECT COUNT(*) FROM upcoming_event_reminders r WHERE r.fk_upcoming_event_id = e.pk_upcoming_event_id AND r.IsActive = 1) AS ReminderCount
    FROM upcoming_events e
    JOIN rotary_year_master y ON y.pk_year_id = p_YearId
    WHERE e.fk_club_id = p_ClubId
      AND e.PublishDate >= y.StartDate
      AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
      AND e.isdeleted = 0
      AND (p_Status = '' OR
           (p_Status = 'Published' AND e.PublishDate <= NOW() AND e.ExpiryDate >= NOW()) OR
           (p_Status = 'Expired' AND e.ExpiryDate < NOW()) OR
           (p_Status = 'Unpublished' AND e.PublishDate > NOW()))
      AND (p_Search = '' OR e.Title LIKE CONCAT('%', p_Search, '%') OR e.EventVenue LIKE CONCAT('%', p_Search, '%'))
    ORDER BY e.EventDate DESC
    LIMIT p_PageSize OFFSET v_Offset;

    SELECT COUNT(*)
    FROM upcoming_events e
    JOIN rotary_year_master y ON y.pk_year_id = p_YearId
    WHERE e.fk_club_id = p_ClubId
      AND e.PublishDate >= y.StartDate
      AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
      AND e.isdeleted = 0
      AND (p_Status = '' OR
           (p_Status = 'Published' AND e.PublishDate <= NOW() AND e.ExpiryDate >= NOW()) OR
           (p_Status = 'Expired' AND e.ExpiryDate < NOW()) OR
           (p_Status = 'Unpublished' AND e.PublishDate > NOW()))
      AND (p_Search = '' OR e.Title LIKE CONCAT('%', p_Search, '%') OR e.EventVenue LIKE CONCAT('%', p_Search, '%'));
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_upcoming_event_get_by_id;
DELIMITER $$
CREATE PROCEDURE sp_upcoming_event_get_by_id(
    IN p_Id INT
)
BEGIN
    SELECT e.pk_upcoming_event_id AS Id,
           e.fk_club_id AS ClubId,
           e.Title,
           e.Description,
           e.ImagePath,
           e.EventDate,
           e.PublishDate,
           e.ExpiryDate,
           e.EventVenue,
           e.RegistrationLink,
           e.IsRepeatNotification,
           CASE
               WHEN e.ExpiryDate < NOW() THEN 'Expired'
               WHEN e.PublishDate <= NOW() AND e.ExpiryDate >= NOW() THEN 'Published'
               ELSE 'Unpublished'
           END AS Status
    FROM upcoming_events e
    WHERE e.pk_upcoming_event_id = p_Id
      AND e.isdeleted = 0;

    SELECT r.pk_reminder_id AS Id,
           r.ReminderDateTime
    FROM upcoming_event_reminders r
    WHERE r.fk_upcoming_event_id = p_Id
      AND r.IsActive = 1
    ORDER BY r.ReminderDateTime;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_upcoming_event_update;
DELIMITER $$
CREATE PROCEDURE sp_upcoming_event_update(
    IN p_Id INT,
    IN p_Title VARCHAR(50),
    IN p_Description VARCHAR(1000),
    IN p_ImagePath VARCHAR(500),
    IN p_EventDate DATE,
    IN p_PublishDate DATE,
    IN p_ExpiryDate DATE,
    IN p_EventVenue VARCHAR(255),
    IN p_RegistrationLink VARCHAR(500),
    IN p_IsRepeatNotification TINYINT,
    IN p_ModifiedBy INT
)
BEGIN
    UPDATE upcoming_events
    SET Title = p_Title,
        Description = p_Description,
        ImagePath = p_ImagePath,
        EventDate = p_EventDate,
        PublishDate = p_PublishDate,
        ExpiryDate = p_ExpiryDate,
        EventVenue = p_EventVenue,
        RegistrationLink = p_RegistrationLink,
        IsRepeatNotification = p_IsRepeatNotification,
        modified_by = p_ModifiedBy
    WHERE pk_upcoming_event_id = p_Id
      AND isdeleted = 0;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_zone_get_all_paginated;
DELIMITER $$
CREATE PROCEDURE sp_zone_get_all_paginated(
    IN p_Search VARCHAR(200),
    IN p_IsActive INT,
    IN p_PageSize INT,
    IN p_Offset INT
)
BEGIN
    SELECT
        z.pk_zone_id AS Id,
        z.ZoneName,
        z.IsActive,
        z.created_date AS CreatedDate,
        (SELECT COUNT(*) FROM district_master d WHERE d.fk_zone_id = z.pk_zone_id AND d.isdeleted = 0) AS TotalDistricts,
        (SELECT COUNT(*) FROM club_master c
         JOIN district_master d2 ON d2.pk_district_id = c.fk_district_id AND d2.isdeleted = 0
         WHERE d2.fk_zone_id = z.pk_zone_id AND c.isdeleted = 0) AS TotalClubs,
        (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
         FROM club_members cm
         JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
         JOIN district_master d3 ON d3.pk_district_id = c2.fk_district_id AND d3.isdeleted = 0
         WHERE d3.fk_zone_id = z.pk_zone_id AND cm.isdeleted = 0) AS TotalMembers
    FROM zone_master z
    WHERE z.isdeleted = 0
      AND (p_Search IS NULL OR z.ZoneName LIKE CONCAT('%', p_Search, '%'))
      AND (p_IsActive IS NULL OR z.IsActive = p_IsActive)
    ORDER BY z.pk_zone_id DESC
    LIMIT p_PageSize OFFSET p_Offset;
END $$
DELIMITER ;

-- -----------------------------------------------------------------------------------------------------
-- 3. Procedures the code no longer has
-- -----------------------------------------------------------------------------------------------------
-- S10 project categories
DROP PROCEDURE IF EXISTS sp_category_get_by_area_of_focus;
DROP PROCEDURE IF EXISTS sp_category_get_by_id;
DROP PROCEDURE IF EXISTS sp_category_create;
DROP PROCEDURE IF EXISTS sp_category_update;
DROP PROCEDURE IF EXISTS sp_category_delete;
DROP PROCEDURE IF EXISTS sp_sub_category_get_by_category;
DROP PROCEDURE IF EXISTS sp_sub_category_get_by_id;
DROP PROCEDURE IF EXISTS sp_sub_category_create;
DROP PROCEDURE IF EXISTS sp_sub_category_update;
DROP PROCEDURE IF EXISTS sp_sub_category_delete;
-- S8 direct beneficiary approvals
DROP PROCEDURE IF EXISTS sp_beneficiary_approval_create;
DROP PROCEDURE IF EXISTS sp_beneficiary_approval_get_by_token;
DROP PROCEDURE IF EXISTS sp_beneficiary_approval_approve;
DROP PROCEDURE IF EXISTS sp_beneficiary_approval_reject;
-- S3 zonal dashboard and the ZonalCoordinator role
DROP PROCEDURE IF EXISTS sp_zonal_get_approval_requests;
DROP PROCEDURE IF EXISTS sp_zonal_approve_request;
DROP PROCEDURE IF EXISTS sp_zonal_reject_request;
DROP PROCEDURE IF EXISTS sp_zonal_get_zone_for_member;
DROP PROCEDURE IF EXISTS sp_zonal_get_zone_districts;
DROP PROCEDURE IF EXISTS sp_zonal_get_district_clubs;
DROP PROCEDURE IF EXISTS sp_zonal_coordinator_get_by_zone;
DROP PROCEDURE IF EXISTS sp_zonal_coordinator_assign;
DROP PROCEDURE IF EXISTS sp_zonal_coordinator_remove;
DROP PROCEDURE IF EXISTS sp_zonal_coordinator_search_members;
DROP PROCEDURE IF EXISTS sp_role_check_member_exists;
DROP PROCEDURE IF EXISTS sp_role_create_credentials;
-- S8 system settings API (the system_settings table stays)
DROP PROCEDURE IF EXISTS sp_setting_get_by_key;
DROP PROCEDURE IF EXISTS sp_setting_upsert;
DROP PROCEDURE IF EXISTS sp_setting_get_all;

-- -----------------------------------------------------------------------------------------------------
-- 4. Project tables: rotary_projects and every rotary_projects_YYYY_YY (foreign keys on a dropped column
--    are dropped with it)
-- -----------------------------------------------------------------------------------------------------
CALL _row_cleanup_drop_index('rotary_projects', 'idx_projects_approval_token');
CALL _row_cleanup_drop_index('rotary_projects', 'idx_projects_approval_status');
CALL _row_cleanup_drop_index('rotary_projects', 'idx_proj_wa_pending');
-- S1 approval
CALL _row_cleanup_drop_project_column('approval_status');
CALL _row_cleanup_drop_project_column('approval_remark');
CALL _row_cleanup_drop_project_column('approved_by');
CALL _row_cleanup_drop_project_column('approval_date');
CALL _row_cleanup_drop_project_column('approval_token');
-- S10 category
CALL _row_cleanup_drop_project_column('fk_category_id');
CALL _row_cleanup_drop_project_column('other_category');
CALL _row_cleanup_drop_project_column('fk_sub_category_id');
CALL _row_cleanup_drop_project_column('other_sub_category');
-- S13 WhatsApp
CALL _row_cleanup_drop_project_column('send_whatsapp');
CALL _row_cleanup_drop_project_column('IsSendWhatsapp');
CALL _row_cleanup_drop_project_column('WhatsAppSentDate');
CALL _row_cleanup_drop_project_column('WhatsAppSentCount');
CALL _row_cleanup_drop_project_column('WhatsAppFailedCount');

-- -----------------------------------------------------------------------------------------------------
-- 5. Other indexes and columns
-- -----------------------------------------------------------------------------------------------------
CALL _row_cleanup_drop_index('announcements', 'idx_ann_wa_pending');
CALL _row_cleanup_drop_index('upcoming_events', 'idx_evt_wa_pending');
CALL _row_cleanup_drop_index('newsletters', 'idx_nl_wa_pending');
CALL _row_cleanup_drop_index('goal_comments', 'idx_goal_comment_seat');
CALL _row_cleanup_drop_column('announcements', 'IsSendWhatsapp');
CALL _row_cleanup_drop_column('announcements', 'WhatsAppSentDate');
CALL _row_cleanup_drop_column('announcements', 'WhatsAppSentCount');
CALL _row_cleanup_drop_column('announcements', 'WhatsAppFailedCount');
CALL _row_cleanup_drop_column('announcements', 'RecipientTarget');
CALL _row_cleanup_drop_column('announcements', 'RecipientZoneIds');
CALL _row_cleanup_drop_column('announcements', 'RecipientDistrictIds');
CALL _row_cleanup_drop_column('announcements', 'RecipientSubgroupIds');
CALL _row_cleanup_drop_column('upcoming_events', 'IsSendWhatsapp');
CALL _row_cleanup_drop_column('upcoming_events', 'WhatsAppSentDate');
CALL _row_cleanup_drop_column('upcoming_events', 'WhatsAppSentCount');
CALL _row_cleanup_drop_column('upcoming_events', 'WhatsAppFailedCount');
CALL _row_cleanup_drop_column('upcoming_events', 'RecipientTarget');
CALL _row_cleanup_drop_column('upcoming_events', 'RecipientZoneIds');
CALL _row_cleanup_drop_column('upcoming_events', 'RecipientDistrictIds');
CALL _row_cleanup_drop_column('upcoming_events', 'RecipientSubgroupIds');
CALL _row_cleanup_drop_column('newsletters', 'IsSendWhatsapp');
CALL _row_cleanup_drop_column('newsletters', 'WhatsAppSentDate');
CALL _row_cleanup_drop_column('newsletters', 'WhatsAppSentCount');
CALL _row_cleanup_drop_column('newsletters', 'WhatsAppFailedCount');
CALL _row_cleanup_drop_column('newsletters', 'RecipientTarget');
CALL _row_cleanup_drop_column('newsletters', 'RecipientZoneIds');
CALL _row_cleanup_drop_column('newsletters', 'RecipientDistrictIds');
CALL _row_cleanup_drop_column('newsletters', 'RecipientSubgroupIds');
CALL _row_cleanup_drop_column('club_mass_emails', 'RecipientTarget');
CALL _row_cleanup_drop_column('club_mass_emails', 'RecipientZoneIds');
CALL _row_cleanup_drop_column('club_mass_emails', 'RecipientDistrictIds');
CALL _row_cleanup_drop_column('club_mass_emails', 'RecipientSubgroupIds');
CALL _row_cleanup_drop_column('club_documents', 'RecipientTarget');
CALL _row_cleanup_drop_column('club_documents', 'RecipientZoneIds');
CALL _row_cleanup_drop_column('club_documents', 'RecipientDistrictIds');
CALL _row_cleanup_drop_column('weblinks', 'RecipientTarget');
CALL _row_cleanup_drop_column('weblinks', 'RecipientZoneIds');
CALL _row_cleanup_drop_column('weblinks', 'RecipientDistrictIds');
CALL _row_cleanup_drop_column('announcement_reminders', 'WhatsAppSentDate');
CALL _row_cleanup_drop_column('announcement_reminders', 'WhatsAppSentCount');
CALL _row_cleanup_drop_column('announcement_reminders', 'WhatsAppFailedCount');
CALL _row_cleanup_drop_column('upcoming_event_reminders', 'WhatsAppSentDate');
CALL _row_cleanup_drop_column('upcoming_event_reminders', 'WhatsAppSentCount');
CALL _row_cleanup_drop_column('upcoming_event_reminders', 'WhatsAppFailedCount');
CALL _row_cleanup_drop_column('club_master', 'IsGreetingSendWhatsapp');
CALL _row_cleanup_drop_column('club_master', 'Is_healthy_club');
CALL _row_cleanup_drop_column('district_master', 'IsGreetingSendWhatsapp');
CALL _row_cleanup_drop_column('zone_master', 'IsZonalAwardsEnabled');
CALL _row_cleanup_drop_column('district_report_reminder_log', 'whatsapp_status');
CALL _row_cleanup_drop_column('mobile_login_otp', 'sent_whatsapp');
CALL _row_cleanup_drop_column('mobile_login_otp', 'sent_sms');
CALL _row_cleanup_drop_column('goal_comments', 'fk_assignment_id');
CALL _row_cleanup_drop_column('district_citation_auto_question_sub', 'filter_cat_id');

-- -----------------------------------------------------------------------------------------------------
-- 6. Tables, children before parents. Any foreign key that still points at a table goes first.
-- -----------------------------------------------------------------------------------------------------
-- S1 club moderation
CALL _row_cleanup_drop_fks(NULL, NULL, 'district_club_moderator');
DROP TABLE IF EXISTS `district_club_moderator`;
-- S2 RI Director
CALL _row_cleanup_drop_fks(NULL, NULL, 'ri_director_credit_usage_history');
DROP TABLE IF EXISTS `ri_director_credit_usage_history`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'ri_director_credits');
DROP TABLE IF EXISTS `ri_director_credits`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'ri_director_credential_email');
DROP TABLE IF EXISTS `ri_director_credential_email`;
-- S4 zonal awards
CALL _row_cleanup_drop_fks(NULL, NULL, 'zonal_awards_district_entry');
DROP TABLE IF EXISTS `zonal_awards_district_entry`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'zonal_awards_import_log');
DROP TABLE IF EXISTS `zonal_awards_import_log`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'zonal_awards_question_option');
DROP TABLE IF EXISTS `zonal_awards_question_option`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'zonal_awards_question');
DROP TABLE IF EXISTS `zonal_awards_question`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'zonal_awards_goal');
DROP TABLE IF EXISTS `zonal_awards_goal`;
-- S5 goal lock and S6 goal setting roles
CALL _row_cleanup_drop_fks(NULL, NULL, 'goal_role_assignment_districts');
DROP TABLE IF EXISTS `goal_role_assignment_districts`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'goal_role_assignment_zones');
DROP TABLE IF EXISTS `goal_role_assignment_zones`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'goal_role_assignments');
DROP TABLE IF EXISTS `goal_role_assignments`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'goal_locks');
DROP TABLE IF EXISTS `goal_locks`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'goal_leadership_designations');
DROP TABLE IF EXISTS `goal_leadership_designations`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'goal_message_seen');
DROP TABLE IF EXISTS `goal_message_seen`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'goal_oversight_access');
DROP TABLE IF EXISTS `goal_oversight_access`;
-- S7 directory data collection
CALL _row_cleanup_drop_fks(NULL, NULL, 'directory_data_member_status');
DROP TABLE IF EXISTS `directory_data_member_status`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'district_directory_submission_log');
DROP TABLE IF EXISTS `district_directory_submission_log`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'district_directory_config');
DROP TABLE IF EXISTS `district_directory_config`;
-- S8 direct beneficiary approvals
CALL _row_cleanup_drop_fks(NULL, NULL, 'beneficiary_approval_requests');
DROP TABLE IF EXISTS `beneficiary_approval_requests`;
-- S9 PPH camps
CALL _row_cleanup_drop_fks(NULL, NULL, 'pph_camp_attendance');
DROP TABLE IF EXISTS `pph_camp_attendance`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'pph_camp_attendies');
DROP TABLE IF EXISTS `pph_camp_attendies`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'pph_camps');
DROP TABLE IF EXISTS `pph_camps`;
-- S13 WhatsApp
CALL _row_cleanup_drop_fks(NULL, NULL, 'whatsapp_log');
DROP TABLE IF EXISTS `whatsapp_log`;
-- S10 project categories
CALL _row_cleanup_drop_fks(NULL, NULL, 'sub_category_master');
DROP TABLE IF EXISTS `sub_category_master`;
CALL _row_cleanup_drop_fks(NULL, NULL, 'category_master');
DROP TABLE IF EXISTS `category_master`;

-- -----------------------------------------------------------------------------------------------------
-- 7. Rows of the removed modules in tables that stay
-- -----------------------------------------------------------------------------------------------------
-- Roles 4 ZonalCoordinator, 5 ClubModerator, 7 RIDirector, unless a member_roles row still uses one.
DELETE FROM roles
WHERE pk_role_id IN (4, 5, 7)
  AND NOT EXISTS (SELECT 1 FROM member_roles mr WHERE mr.fk_role_id = roles.pk_role_id);

DELETE FROM route_maintenance
WHERE RouteKey IN ('/settings/categories', '/districts/:id/club-moderator', '/club-moderator', '/zonal-dashboard', '/districts/:id/zonal-awards', '/districts/:id/rni-camp', '/districts/:id/rni-camp/:campId/attendance', '/clubs/:id/pph-camps')
   OR RouteKey = '/ri-director' OR RouteKey LIKE '/ri-director/%';

-- The tiles stay as soft-deleted module_master rows; their club, district and edition assignments go.
UPDATE module_master SET isdeleted = 1 WHERE ModuleKey IN ('market_place', 'zonal_awards', 'pph_camp', 'club_moderator') AND isdeleted = 0;
DELETE FROM club_modules WHERE fk_module_id IN (SELECT pk_module_id FROM module_master WHERE ModuleKey IN ('market_place', 'zonal_awards', 'pph_camp', 'club_moderator'));
DELETE FROM district_modules WHERE fk_module_id IN (SELECT pk_module_id FROM module_master WHERE ModuleKey IN ('market_place', 'zonal_awards', 'pph_camp', 'club_moderator'));
DELETE FROM edition_modules WHERE module_key IN ('market_place', 'zonal_awards', 'pph_camp', 'club_moderator');

-- The 'PPH Camp' District Awards activity, unless an auto question uses it.
DELETE FROM district_citation_activity_master
WHERE activity_name = 'PPH Camp'
  AND NOT EXISTS (SELECT 1 FROM district_citation_auto_question q WHERE q.fk_activity_id = district_citation_activity_master.pk_id);

DELETE FROM system_settings WHERE SettingKey = 'direct_beneficiaries_limit';

-- -----------------------------------------------------------------------------------------------------
-- 8. Remove the helpers
-- -----------------------------------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _row_cleanup_drop_fks;
DROP PROCEDURE IF EXISTS _row_cleanup_drop_column;
DROP PROCEDURE IF EXISTS _row_cleanup_drop_index;
DROP PROCEDURE IF EXISTS _row_cleanup_drop_project_column;

SELECT 'done: the removed modules are dropped' AS row_cleanup;
