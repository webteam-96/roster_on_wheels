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
-- MobileDistrictAwardsController: the club's short code.
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

-- N5 Communication (CommsService): template key on campaigns, per-recipient tracking columns and their indexes.
-- Same SQL as DatabaseInitializer; the new comm_* tables and member_channel_consents are in schema.sql.
CALL row_add_column_if_missing('club_mass_emails', 'TemplateKey', 'VARCHAR(50) NULL');
CALL row_add_column_if_missing('club_mass_email_recipients', 'MessageId', 'VARCHAR(200) NULL');
CALL row_add_column_if_missing('club_mass_email_recipients', 'Language', 'VARCHAR(20) NULL');
CALL row_add_column_if_missing('club_mass_email_recipients', 'DeliveryStatus', 'VARCHAR(20) NULL');
CALL row_add_column_if_missing('club_mass_email_recipients', 'DeliveredAt', 'DATETIME NULL');
CALL row_add_column_if_missing('club_mass_email_recipients', 'OpenedAt', 'DATETIME NULL');
CALL row_add_column_if_missing('club_mass_email_recipients', 'OpenCount', 'INT NOT NULL DEFAULT 0');
CALL row_add_column_if_missing('club_mass_email_recipients', 'ClickedAt', 'DATETIME NULL');
CALL row_add_column_if_missing('club_mass_email_recipients', 'ClickCount', 'INT NOT NULL DEFAULT 0');
SET @has_idx := (SELECT COUNT(*) FROM information_schema.statistics
                 WHERE table_schema = DATABASE() AND table_name = 'club_mass_email_recipients' AND index_name = 'idx_cmer_mass_email');
SET @sql := IF(@has_idx = 0, 'ALTER TABLE club_mass_email_recipients ADD INDEX idx_cmer_mass_email (fk_mass_email_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @has_idx := (SELECT COUNT(*) FROM information_schema.statistics
                 WHERE table_schema = DATABASE() AND table_name = 'club_mass_email_recipients' AND index_name = 'idx_cmer_message');
SET @sql := IF(@has_idx = 0, 'ALTER TABLE club_mass_email_recipients ADD INDEX idx_cmer_message (MessageId)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @has_idx := (SELECT COUNT(*) FROM information_schema.statistics
                 WHERE table_schema = DATABASE() AND table_name = 'email_log' AND index_name = 'ix_email_log_brevo_message');
SET @sql := IF(@has_idx = 0, 'ALTER TABLE email_log ADD INDEX ix_email_log_brevo_message (brevo_message_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

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

-- Tenant lifecycle and editions (ROW Wave 1, build spec items 1 and 5). Same SQL as DatabaseInitializer.
CREATE TABLE IF NOT EXISTS edition_catalogue (
    code VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    modified_by INT NULL,
    modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
);
INSERT IGNORE INTO edition_catalogue (code, name) VALUES
    ('district', 'District'), ('club', 'Club'), ('club_basic', 'Club basic'),
    ('rotaract', 'Rotaract'), ('zone', 'Zone');
-- N5: emails per member per month included in an edition (build spec 3.10).
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'edition_catalogue' AND COLUMN_NAME = 'email_allowance_per_member');
SET @sql := IF(@has_col = 0, 'ALTER TABLE edition_catalogue ADD COLUMN email_allowance_per_member INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
UPDATE edition_catalogue SET email_allowance_per_member = IF(code = 'district', 6, 25)
WHERE email_allowance_per_member IS NULL AND code IN ('club', 'club_basic', 'rotaract', 'district');
CREATE TABLE IF NOT EXISTS edition_modules (
    edition_code VARCHAR(20) NOT NULL,
    module_key VARCHAR(50) NOT NULL,
    PRIMARY KEY (edition_code, module_key),
    FOREIGN KEY (edition_code) REFERENCES edition_catalogue(code)
);
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    pk_subscription_id INT AUTO_INCREMENT PRIMARY KEY,
    fk_district_id INT NOT NULL,
    fk_club_id INT NOT NULL DEFAULT 0,
    edition_code VARCHAR(20) NOT NULL,
    member_band VARCHAR(20) NULL,
    term_start DATE NULL,
    term_end DATE NULL,
    state ENUM('planning','live') NOT NULL DEFAULT 'live',
    region ENUM('US','EU','APAC','IN') NULL,
    bridge_start DATE NULL,
    bridge_end DATE NULL,
    setup_fee_waived TINYINT(1) NOT NULL DEFAULT 0,
    platform_fee_pct DECIMAL(5,2) NULL,
    platform_fee_fixed DECIMAL(10,2) NULL,
    fee_waiver_until DATE NULL,
    created_by INT NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_by INT NULL,
    modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tenant_scope (fk_district_id, fk_club_id),
    FOREIGN KEY (edition_code) REFERENCES edition_catalogue(code)
);
-- N7 planning mode (build spec 3.1, DatabaseInitializer.Planning.cs): the year being planned, the scheduled and
-- actual cut-over (UTC), the year the cut-over archived, and the end of a 60-day trial. Added together.
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_subscriptions' AND COLUMN_NAME = 'planning_year_id');
SET @sql := IF(@has_col = 0, 'ALTER TABLE tenant_subscriptions ADD COLUMN planning_year_id INT NULL, ADD COLUMN cutover_at DATETIME NULL, ADD COLUMN cutover_done_at DATETIME NULL, ADD COLUMN archived_year_id INT NULL, ADD COLUMN trial_ends DATE NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- String catalogue (ROW Wave 1, build spec item 3). Same SQL as DatabaseInitializer.
CREATE TABLE IF NOT EXISTS i18n_strings (
    pk_string_id INT AUTO_INCREMENT PRIMARY KEY,
    namespace VARCHAR(50) NOT NULL,
    msg_key VARCHAR(200) NOT NULL,
    locale VARCHAR(20) NOT NULL,
    text TEXT NOT NULL,
    reviewed TINYINT(1) NOT NULL DEFAULT 0,
    updated_by INT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_i18n_string (locale, namespace, msg_key)
);

-- Platform-wide switches for flagged modules (api/Services/FeatureGate.cs); no row = off. 2026-10-21.
CREATE TABLE IF NOT EXISTS platform_features (
    feature_key VARCHAR(50) NOT NULL PRIMARY KEY,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    modified_by INT NULL,
    modified_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Build spec completion, 2026-10-28 (DatabaseInitializer.SpecCompletion.cs; undo:
-- database/maintenance/2026-10-28-build-spec-completion-down.sql).
-- S7 (3.14): district tenant retention rule for terminated members, in months (NULL or 0 = off).
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_subscriptions' AND COLUMN_NAME = 'anonymise_after_months');
SET @sql := IF(@has_col = 0, 'ALTER TABLE tenant_subscriptions ADD COLUMN anonymise_after_months SMALLINT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
-- S8 (3.12): RI fields. A designation's RI officer title (the six PlanningService mapped by name start mapped), the
-- ri_codes lists (member types, join and termination reasons; Active and Honorary start in the list), and each
-- membership's codes.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'designation_master' AND COLUMN_NAME = 'ri_title') = 0,
               'ALTER TABLE designation_master ADD COLUMN ri_title VARCHAR(30) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
UPDATE designation_master SET ri_title = CASE designation_name WHEN 'Club President' THEN 'President'
    WHEN 'Club Secretary' THEN 'Secretary' WHEN 'Club Treasurer' THEN 'Treasurer'
    WHEN 'Club Executive Secretary/Director' THEN 'Executive Secretary'
    WHEN 'Club Membership Chair' THEN 'Membership Chair' WHEN 'Club Foundation Chair' THEN 'Foundation Chair' END
WHERE ri_title IS NULL AND designation_name IN ('Club President', 'Club Secretary', 'Club Treasurer',
    'Club Executive Secretary/Director', 'Club Membership Chair', 'Club Foundation Chair');
CREATE TABLE IF NOT EXISTS ri_codes (
    pk_ri_code_id INT AUTO_INCREMENT PRIMARY KEY,
    kind VARCHAR(20) NOT NULL,
    code VARCHAR(40) NOT NULL,
    label VARCHAR(150) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    isdeleted TINYINT(1) NOT NULL DEFAULT 0,
    modified_by INT NULL,
    modified_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ri_code (kind, code)
);
INSERT IGNORE INTO ri_codes (kind, code, label, sort_order) VALUES
    ('member_type', 'active', 'Active', 1), ('member_type', 'honorary', 'Honorary', 2);
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'club_members' AND COLUMN_NAME = 'ri_member_type') = 0,
               'ALTER TABLE club_members ADD COLUMN ri_member_type VARCHAR(40) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'club_members' AND COLUMN_NAME = 'join_reason_code') = 0,
               'ALTER TABLE club_members ADD COLUMN join_reason_code VARCHAR(40) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'club_members' AND COLUMN_NAME = 'termination_reason_code') = 0,
               'ALTER TABLE club_members ADD COLUMN termination_reason_code VARCHAR(40) NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
-- S10 (B.29): district target setting (Services/TargetProposals.cs, same SQL).
CREATE TABLE IF NOT EXISTS district_target_proposals (
    pk_proposal_id INT AUTO_INCREMENT PRIMARY KEY,
    fk_district_id INT NOT NULL,
    fk_club_id INT NOT NULL,
    fk_year_id INT NOT NULL,
    metric VARCHAR(30) NOT NULL,
    proposed_value DECIMAL(18,2) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'proposed',
    counter_value DECIMAL(18,2) NULL,
    club_note VARCHAR(500) NULL,
    proposed_by INT NOT NULL,
    proposed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responded_by INT NULL,
    responded_at DATETIME NULL,
    UNIQUE KEY uk_target_proposal (fk_club_id, fk_year_id, metric),
    KEY ix_target_proposal_district (fk_district_id, fk_year_id)
);
-- S11 (3.5): renewal reminders (TenantRenewalService), added together.
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'tenant_subscriptions' AND COLUMN_NAME = 'auto_renew') = 0,
               'ALTER TABLE tenant_subscriptions ADD COLUMN auto_renew TINYINT(1) NOT NULL DEFAULT 1, ADD COLUMN renewal_notice_for DATE NULL, ADD COLUMN dunning_for DATE NULL, ADD COLUMN dunning_stage TINYINT NOT NULL DEFAULT 0',
               'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
-- S12 (3.1): DGE sign-ups at the booth (BoothSignupController.TableSql, same SQL).
CREATE TABLE IF NOT EXISTS booth_signups (
    pk_signup_id INT AUTO_INCREMENT PRIMARY KEY,
    fk_district_id INT NOT NULL,
    edition_code VARCHAR(20) NOT NULL,
    member_band VARCHAR(20) NULL,
    contact_name VARCHAR(150) NOT NULL,
    contact_email VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'awaiting_payment',
    payment_note VARCHAR(200) NULL,
    result_note VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by INT NULL,
    decided_at DATETIME NULL,
    KEY ix_booth_status (status, created_at)
);
-- S5 (3.3, 3.16): machine translations of the server's fixed texts (ServerStrings.TableSql, same SQL).
CREATE TABLE IF NOT EXISTS server_strings (
    text_hash CHAR(64) NOT NULL,
    language VARCHAR(20) NOT NULL,
    english TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (text_hash, language)
);
