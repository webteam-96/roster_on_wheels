-- Columns and indexes the ported API uses that RIZones never creates in code
-- (DatabaseInitializer / SQL patches): they were added by hand to the RIZones
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

DROP PROCEDURE row_add_column_if_missing;
