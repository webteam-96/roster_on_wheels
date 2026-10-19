-- Columns and indexes the ported API uses that ROW never creates in code
-- (DatabaseInitializer / SQL patches): they were added by hand to the ROW
-- production database. Apply after schema.sql. Every statement is idempotent.

DELIMITER //
DROP PROCEDURE IF EXISTS row_add_column_if_missing//
CREATE PROCEDURE row_add_column_if_missing(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

-- NewsletterService: the Rotary year a newsletter's publish date falls in.
CALL row_add_column_if_missing('newsletters', 'fk_year_id', 'INT NULL AFTER fk_club_id');

-- Found by tools/find-schema-drift.py (columns read or written by the code, absent from the schema).
-- ClubService.SetLogosAsync / club website public data: the Rotary (masterbrand) logo beside the club logo.
CALL row_add_column_if_missing('club_master', 'RotaryLogoPath', 'VARCHAR(500) NULL AFTER ClubLogoPath');
-- MemberDuplicateController: duplicate detection across primary and secondary email.
CALL row_add_column_if_missing('member_master_profile', 'SecondaryEmailId', 'VARCHAR(200) NULL AFTER EmailId');
-- DistrictPerformanceReportService: zone ordering.
CALL row_add_column_if_missing('zone_master', 'sort_order', 'INT NULL');
-- sp_document_get_all_paginated / sp_document_get_years / sp_document_create.
CALL row_add_column_if_missing('club_documents', 'fk_year_id', 'INT NULL AFTER fk_club_id');
-- ClubBannerService / ClubAdvertisementService: optional document and click-through link.
CALL row_add_column_if_missing('club_website_banner', 'document_path', 'VARCHAR(500) NULL');
CALL row_add_column_if_missing('club_website_banner', 'link_url', 'VARCHAR(500) NULL');
CALL row_add_column_if_missing('club_website_advertisement', 'link_url', 'VARCHAR(500) NULL');
-- BeneficiaryApprovalService / MobileDistrictAwardsController: the club's short code.
CALL row_add_column_if_missing('club_master', 'ClubCode', 'VARCHAR(50) NULL AFTER ClubName');
-- RotaryOrgSyncWorker member sweep / sync-exceptions screen: did the member still land (1) or not (0).
CALL row_add_column_if_missing('sync_exception_log', 'inserted', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER fk_member_master_profile_id');

-- Global member search: committee memberships looked up by member (upstream 2026-10-08).
SET @has_idx := (SELECT COUNT(*) FROM information_schema.statistics
                 WHERE table_schema = DATABASE() AND table_name = 'district_committee_group_member'
                   AND index_name = 'idx_dcgm_member');
SET @sql := IF(@has_idx = 0, 'ALTER TABLE district_committee_group_member ADD INDEX idx_dcgm_member (fk_member_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Meeting mode on meeting records (ROW Wave 1, build spec 3.17).
CALL row_add_column_if_missing('club_attendance', 'MeetingMode', "VARCHAR(20) NOT NULL DEFAULT 'in_person' AFTER EventDateTime");
CALL row_add_column_if_missing('club_attendance', 'MeetingLink', 'VARCHAR(1000) NULL AFTER MeetingMode');

DROP PROCEDURE row_add_column_if_missing;

-- audit_log is append-only (ROW Wave 1, build spec 3.14). No deletes; the only allowed update is
-- privacy erasure blanking member_name / ip_address. Same SQL as DatabaseInitializer.
DROP TRIGGER IF EXISTS trg_audit_log_no_delete;
DROP TRIGGER IF EXISTS trg_audit_log_no_update;
DELIMITER ;;
CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON audit_log
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only.';
END;;
CREATE TRIGGER trg_audit_log_no_update BEFORE UPDATE ON audit_log
FOR EACH ROW
BEGIN
    IF NOT (NEW.pk_audit_id <=> OLD.pk_audit_id
        AND NEW.fk_member_master_profile_id <=> OLD.fk_member_master_profile_id
        AND NEW.role_name <=> OLD.role_name AND NEW.action <=> OLD.action
        AND NEW.entity_type <=> OLD.entity_type AND NEW.entity_id <=> OLD.entity_id
        AND NEW.entity_name <=> OLD.entity_name AND NEW.details <=> OLD.details
        AND NEW.user_agent <=> OLD.user_agent AND NEW.created_date <=> OLD.created_date
        AND (NEW.member_name IS NULL OR NEW.member_name <=> OLD.member_name)
        AND (NEW.ip_address IS NULL OR NEW.ip_address <=> OLD.ip_address)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only.';
    END IF;
END;;
DELIMITER ;
