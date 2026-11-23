-- Production catch-up for the 2026-11-20 competitor-gap release (commit 1cd7341a): its 94 new tables, the new
-- columns and indexes on existing tables, and the starter rows. Production runs with Database__SkipInit=true, so the
-- API never created them, and sign-in fails with "Table 'row_production.member_mfa' doesn't exist" (found 2026-11-23).
-- Generated from the local copy, where the API built these tables. Additive and re-runnable: tables IF NOT EXISTS,
-- columns and indexes only when missing, rows INSERT IGNORE. Undo: 2026-11-23-competitor-gap-schema-catchup-down.sql
SET NAMES utf8mb4;
SET @old_fk := @@FOREIGN_KEY_CHECKS; SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `acct_accounts` (
  `pk_account_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `system_key` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_bank` tinyint(1) NOT NULL DEFAULT '0',
  `bank_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `account_last4` varchar(4) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_account_id`),
  UNIQUE KEY `uk_acct_code` (`fk_club_id`,`code`),
  UNIQUE KEY `uk_acct_key` (`fk_club_id`,`system_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `acct_budgets` (
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_account_id` int NOT NULL,
  `amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`fk_club_id`,`fk_year_id`,`fk_account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `acct_journal_entries` (
  `pk_entry_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `entry_date` date NOT NULL,
  `memo` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_type` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reverses_entry_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL,
  `fk_vendor_id` int DEFAULT NULL,
  `reference` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_entry_id`),
  UNIQUE KEY `uk_acct_source` (`fk_club_id`,`source_type`,`source_id`),
  UNIQUE KEY `uk_acct_reverses` (`reverses_entry_id`),
  KEY `idx_acct_entry_date` (`fk_club_id`,`entry_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `acct_journal_lines` (
  `pk_line_id` int NOT NULL AUTO_INCREMENT,
  `fk_entry_id` int NOT NULL,
  `fk_account_id` int NOT NULL,
  `debit` decimal(14,2) NOT NULL DEFAULT '0.00',
  `credit` decimal(14,2) NOT NULL DEFAULT '0.00',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_line_id`),
  KEY `idx_acct_line_entry` (`fk_entry_id`),
  KEY `idx_acct_line_account` (`fk_account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `acct_statement_lines` (
  `pk_statement_line_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_account_id` int NOT NULL,
  `line_date` date NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `fk_journal_line_id` int DEFAULT NULL,
  `reconciled_by` int DEFAULT NULL,
  `reconciled_at` datetime DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL,
  PRIMARY KEY (`pk_statement_line_id`),
  UNIQUE KEY `uk_acct_stmt_match` (`fk_journal_line_id`),
  KEY `idx_acct_stmt_account` (`fk_club_id`,`fk_account_id`,`line_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `acct_vendors` (
  `pk_vendor_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notes` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_vendor_id`),
  KEY `idx_acct_vendor_club` (`fk_club_id`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `auth_login_challenges` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `token_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_member_id` int NOT NULL,
  `channel` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_temporary` tinyint(1) NOT NULL DEFAULT '0',
  `setup_required` tinyint(1) NOT NULL DEFAULT '0',
  `attempts` int NOT NULL DEFAULT '0',
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_login_challenge_token` (`token_hash`),
  KEY `idx_login_challenge_member` (`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `auth_magic_links` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `token_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_member_id` int NOT NULL,
  `channel` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `attempts` int NOT NULL DEFAULT '0',
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `request_ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_magic_link_token` (`token_hash`),
  KEY `idx_magic_link_member` (`fk_member_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `business_listings` (
  `pk_listing_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `fk_district_id` int NOT NULL,
  `business_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `classification` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(2000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `website` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `review_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewed_by` int DEFAULT NULL,
  `reviewed_utc` datetime DEFAULT NULL,
  `created_utc` datetime NOT NULL,
  `modified_utc` datetime NOT NULL,
  PRIMARY KEY (`pk_listing_id`),
  UNIQUE KEY `uk_business_listing_member` (`fk_member_id`),
  KEY `idx_business_listing_district` (`fk_district_id`,`status`),
  KEY `idx_business_listing_club` (`fk_club_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_attendance_closures` (
  `fk_attendance_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `closed_by` int NOT NULL,
  `closed_date` datetime NOT NULL DEFAULT (utc_timestamp()),
  PRIMARY KEY (`fk_attendance_id`),
  KEY `idx_closure_club` (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_attendance_makeups` (
  `pk_makeup_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `makeup_date` date NOT NULL,
  `makeup_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_missed_attendance_id` int DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL DEFAULT (utc_timestamp()),
  `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'approved',
  `reviewed_by` int DEFAULT NULL,
  `reviewed_date` datetime DEFAULT NULL,
  `review_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_makeup_id`),
  KEY `idx_makeup_club_member` (`fk_club_id`,`fk_member_id`,`makeup_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_attendance_member_type_rules` (
  `fk_club_id` int NOT NULL,
  `member_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `count_rule` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`fk_club_id`,`member_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_attendance_settings` (
  `fk_club_id` int NOT NULL,
  `makeup_window_days` int NOT NULL DEFAULT '14',
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_bulletin_deliveries` (
  `pk_delivery_id` int NOT NULL AUTO_INCREMENT,
  `fk_bulletin_id` int NOT NULL,
  `fk_subscriber_id` int NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Pending',
  `message_id` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_message` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sent_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_delivery_id`),
  UNIQUE KEY `uq_bulletin_subscriber` (`fk_bulletin_id`,`fk_subscriber_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_bulletin_subscribers` (
  `pk_subscriber_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `email` varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Pending',
  `confirm_token_hash` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `confirm_expires` datetime DEFAULT NULL,
  `confirm_sent_date` datetime DEFAULT NULL,
  `consent_text` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `signup_date` datetime NOT NULL DEFAULT (utc_timestamp()),
  `confirmed_date` datetime DEFAULT NULL,
  `unsubscribed_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_subscriber_id`),
  UNIQUE KEY `uq_club_subscriber` (`fk_club_id`,`email`),
  KEY `idx_subscriber_token` (`confirm_token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_bulletins` (
  `pk_bulletin_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `intro` text COLLATE utf8mb4_unicode_ci,
  `president_message` text COLLATE utf8mb4_unicode_ci,
  `layout` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'classic',
  `announcement_ids` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_ids` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `story_ids` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `include_birthdays` tinyint(1) NOT NULL DEFAULT '1',
  `include_speakers` tinyint(1) NOT NULL DEFAULT '1',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Draft',
  `fk_mass_email_id` int DEFAULT NULL,
  `sent_html` mediumtext COLLATE utf8mb4_unicode_ci,
  `sent_date` datetime DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL DEFAULT (utc_timestamp()),
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_bulletin_id`),
  KEY `idx_club_bulletin` (`fk_club_id`,`isdeleted`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_member_attendance_exemptions` (
  `pk_exemption_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `reason` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `end_date` date DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL DEFAULT (utc_timestamp()),
  PRIMARY KEY (`pk_exemption_id`),
  UNIQUE KEY `uk_exemption_club_member` (`fk_club_id`,`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_member_leaves` (
  `pk_leave_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `from_date` date NOT NULL,
  `to_date` date NOT NULL,
  `reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL DEFAULT (utc_timestamp()),
  PRIMARY KEY (`pk_leave_id`),
  KEY `idx_leave_club_member` (`fk_club_id`,`fk_member_id`,`from_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_password_reset_requests` (
  `pk_request_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `fk_sent_by_id` int NOT NULL,
  `created_utc` datetime NOT NULL,
  PRIMARY KEY (`pk_request_id`),
  KEY `ix_cprr_member` (`fk_member_id`,`created_utc`),
  KEY `ix_cprr_sender` (`fk_sent_by_id`,`created_utc`),
  KEY `ix_cprr_club` (`fk_club_id`,`created_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_profile_fields` (
  `pk_profile_field_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `label` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `field_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `options_json` text COLLATE utf8mb4_unicode_ci,
  `visibility` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'admins',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_profile_field_id`),
  UNIQUE KEY `uk_club_profile_fields_label` (`fk_club_id`,`label`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_profile_values` (
  `fk_profile_field_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `value` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`fk_profile_field_id`,`fk_member_id`),
  KEY `idx_cpv_member` (`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_security_policy` (
  `fk_club_id` int NOT NULL,
  `require_mfa` tinyint(1) NOT NULL DEFAULT '0',
  `updated_by` int DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_smart_lists` (
  `pk_smart_list_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `filter_json` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_smart_list_id`),
  UNIQUE KEY `uk_club_smart_lists_name` (`fk_club_id`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_stories` (
  `pk_story_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Pending',
  `fk_author_id` int NOT NULL,
  `submitted_date` datetime NOT NULL DEFAULT (utc_timestamp()),
  `fk_reviewer_id` int DEFAULT NULL,
  `review_note` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewed_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_story_id`),
  KEY `idx_club_story` (`fk_club_id`,`status`,`isdeleted`),
  KEY `idx_story_author` (`fk_author_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_tag_assignments` (
  `fk_club_tag_id` int NOT NULL,
  `entity_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` int NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`fk_club_tag_id`,`entity_type`,`entity_id`),
  KEY `idx_cta_entity` (`entity_type`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `club_tags` (
  `pk_club_tag_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `color` char(7) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '#17458F',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_club_tag_id`),
  UNIQUE KEY `uk_club_tags_name` (`fk_club_id`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `committee_documents` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `committee_kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_committee_id` int NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stored_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `size_bytes` int NOT NULL,
  `uploaded_by` int NOT NULL,
  `created_date` datetime NOT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `ix_committee_documents` (`committee_kind`,`fk_committee_id`,`isdeleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `committee_messages` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `committee_kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_committee_id` int NOT NULL,
  `fk_mass_email_id` int NOT NULL,
  `sent_by` int NOT NULL,
  `subject` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_date` datetime NOT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `ix_committee_messages` (`committee_kind`,`fk_committee_id`,`created_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `contact_merge_log` (
  `pk_merge_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL DEFAULT '0',
  `fk_district_id` int NOT NULL DEFAULT '0',
  `fk_survivor_contact_id` int NOT NULL,
  `merged_contact_id` int NOT NULL,
  `merged_snapshot` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `field_sources` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `merged_by` int DEFAULT NULL,
  `merged_date_utc` datetime NOT NULL,
  PRIMARY KEY (`pk_merge_id`),
  KEY `idx_contact_merge_survivor` (`fk_survivor_contact_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `custom_reports` (
  `pk_report_id` int NOT NULL AUTO_INCREMENT,
  `scope_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_id` int NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `definition` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `schedule_monthly` tinyint(1) NOT NULL DEFAULT '0',
  `schedule_day` tinyint NOT NULL DEFAULT '1',
  `schedule_format` varchar(5) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'xlsx',
  `last_sent_month` char(7) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_sent_at` datetime DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_report_id`),
  KEY `idx_custom_reports_scope` (`scope_type`,`scope_id`,`isdeleted`),
  KEY `idx_custom_reports_schedule` (`schedule_monthly`,`isdeleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `district_access_grants` (
  `pk_grant_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_id` int NOT NULL,
  `fk_district_id` int NOT NULL,
  `can_write` tinyint(1) NOT NULL DEFAULT '0',
  `purpose` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `starts_at_utc` datetime NOT NULL,
  `expires_at_utc` datetime NOT NULL,
  `granted_by` int NOT NULL,
  `granted_at_utc` datetime NOT NULL,
  `revoked_at_utc` datetime DEFAULT NULL,
  `revoked_by` int DEFAULT NULL,
  `revoke_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_grant_id`),
  KEY `idx_dag_member_district` (`fk_member_id`,`fk_district_id`,`expires_at_utc`),
  KEY `idx_dag_district` (`fk_district_id`),
  KEY `idx_dag_expires` (`expires_at_utc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `donation_campaigns` (
  `pk_campaign_id` int NOT NULL AUTO_INCREMENT,
  `scope_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_id` int NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `image_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `goal_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `currency` char(3) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tiers` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `allow_custom` tinyint(1) NOT NULL DEFAULT '1',
  `min_amount` decimal(12,2) NOT NULL DEFAULT '1.00',
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL DEFAULT (utc_timestamp()),
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_campaign_id`),
  KEY `idx_donation_campaign_scope` (`scope_type`,`scope_id`,`isdeleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `donation_receipt_templates` (
  `pk_template_id` int NOT NULL AUTO_INCREMENT,
  `scope_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_id` int NOT NULL,
  `legal_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tax_statement` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `body` text COLLATE utf8mb4_unicode_ci,
  `signatory_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `signatory_title` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `modified_by` int NOT NULL,
  `modified_date` datetime NOT NULL DEFAULT (utc_timestamp()),
  PRIMARY KEY (`pk_template_id`),
  UNIQUE KEY `uk_donation_receipt_scope` (`scope_type`,`scope_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `donations` (
  `pk_donation_id` int NOT NULL AUTO_INCREMENT,
  `fk_campaign_id` int NOT NULL,
  `donor_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `donor_email` varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_anonymous` tinyint(1) NOT NULL DEFAULT '0',
  `hide_amount` tinyint(1) NOT NULL DEFAULT '0',
  `fk_member_id` int DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `currency` char(3) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `merchant_order_id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `gateway_payment_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT (utc_timestamp()),
  `paid_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_donation_id`),
  UNIQUE KEY `uk_donation_order` (`merchant_order_id`),
  KEY `idx_donation_campaign_status` (`fk_campaign_id`,`status`),
  CONSTRAINT `fk_donation_campaign` FOREIGN KEY (`fk_campaign_id`) REFERENCES `donation_campaigns` (`pk_campaign_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `dues_invoice_counters` (
  `fk_club_id` int NOT NULL,
  `last_seq` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `dues_invoice_lines` (
  `pk_line_id` int NOT NULL AUTO_INCREMENT,
  `fk_invoice_id` int NOT NULL,
  `fk_product_id` int DEFAULT NULL,
  `description` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT '1.00',
  `unit_amount` decimal(12,2) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  PRIMARY KEY (`pk_line_id`),
  KEY `idx_dues_invoice_line` (`fk_invoice_id`),
  CONSTRAINT `fk_dues_invoice_line` FOREIGN KEY (`fk_invoice_id`) REFERENCES `dues_invoices` (`pk_invoice_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `dues_invoice_payments` (
  `fk_invoice_id` int NOT NULL,
  `fk_payment_id` int NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  PRIMARY KEY (`fk_invoice_id`,`fk_payment_id`),
  KEY `idx_dues_invoice_payment` (`fk_payment_id`),
  CONSTRAINT `fk_dues_invoice_payment` FOREIGN KEY (`fk_invoice_id`) REFERENCES `dues_invoices` (`pk_invoice_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `dues_invoices` (
  `pk_invoice_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_membership_dues_id` int DEFAULT NULL,
  `fk_member_fee_id` int DEFAULT NULL,
  `fk_member_profile_id` int NOT NULL,
  `fee_type` int DEFAULT NULL,
  `invoice_seq` int NOT NULL,
  `invoice_no` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `issue_date` date NOT NULL,
  `due_date` date NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `paid_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `notes` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `void_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `voided_by` int DEFAULT NULL,
  `voided_at` datetime DEFAULT NULL,
  `email_count` int NOT NULL DEFAULT '0',
  `emailed_at` datetime DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`pk_invoice_id`),
  UNIQUE KEY `uk_dues_invoice_seq` (`fk_club_id`,`invoice_seq`),
  KEY `idx_dues_invoice_member` (`fk_member_profile_id`),
  KEY `idx_dues_invoice_fee` (`fk_member_fee_id`,`fee_type`),
  KEY `idx_dues_invoice_dues` (`fk_membership_dues_id`),
  KEY `idx_dues_invoice_issue` (`fk_club_id`,`issue_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `goal_locks` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `EntityType` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_club_id` int NOT NULL DEFAULT '0',
  `fk_district_id` int NOT NULL DEFAULT '0',
  `fk_category_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `IsLocked` tinyint(1) NOT NULL DEFAULT '0',
  `LockedBy` int DEFAULT NULL,
  `LockedDate` datetime DEFAULT NULL,
  `UnlockedBy` int DEFAULT NULL,
  `UnlockedDate` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_goal_lock` (`EntityType`,`fk_club_id`,`fk_district_id`,`fk_category_id`,`fk_year_id`),
  KEY `fk_category_id` (`fk_category_id`),
  KEY `fk_year_id` (`fk_year_id`),
  CONSTRAINT `goal_locks_ibfk_1` FOREIGN KEY (`fk_category_id`) REFERENCES `goal_categories` (`pk_category_id`),
  CONSTRAINT `goal_locks_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `goal_role_assignment_districts` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_assignment_id` int NOT NULL,
  `fk_district_id` int NOT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_goal_role_assignment_district` (`fk_assignment_id`,`fk_district_id`),
  CONSTRAINT `goal_role_assignment_districts_ibfk_1` FOREIGN KEY (`fk_assignment_id`) REFERENCES `goal_role_assignments` (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `goal_role_assignment_zones` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_assignment_id` int NOT NULL,
  `fk_zone_id` int NOT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_goal_role_assignment_zone` (`fk_assignment_id`,`fk_zone_id`),
  CONSTRAINT `goal_role_assignment_zones_ibfk_1` FOREIGN KEY (`fk_assignment_id`) REFERENCES `goal_role_assignments` (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `goal_role_assignments` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_id` int NOT NULL,
  `MemberNameText` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RoleType` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `AssignmentName` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `RoleTitle` varchar(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Avenue` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_category_id` int DEFAULT NULL,
  `fk_zone_id` int DEFAULT NULL,
  `HomeDistrictId` int DEFAULT NULL,
  `DgYear` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SupportingText` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  `AssignedBy` int DEFAULT NULL,
  `AssignedDate` datetime DEFAULT CURRENT_TIMESTAMP,
  `RoleEmailSentDate` datetime DEFAULT NULL,
  `RevokedBy` int DEFAULT NULL,
  `RevokedDate` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  KEY `idx_goal_role_member` (`fk_member_id`,`IsActive`),
  KEY `fk_category_id` (`fk_category_id`),
  CONSTRAINT `goal_role_assignments_ibfk_1` FOREIGN KEY (`fk_category_id`) REFERENCES `goal_categories` (`pk_category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `grant_club_qualifications` (
  `pk_qualification_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `mou_signed_on` date DEFAULT NULL,
  `training_on` date DEFAULT NULL,
  `expires_on` date DEFAULT NULL,
  `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `modified_by` int NOT NULL,
  `modified_at_utc` datetime NOT NULL,
  PRIMARY KEY (`pk_qualification_id`),
  UNIQUE KEY `uk_grant_qual` (`fk_club_id`,`fk_year_id`),
  KEY `idx_grant_qual_district` (`fk_district_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `grant_cycle_receipts` (
  `pk_receipt_id` int NOT NULL AUTO_INCREMENT,
  `fk_cycle_id` int NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `received_on` date NOT NULL,
  `source` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recorded_by` int NOT NULL,
  `created_at_utc` datetime NOT NULL,
  PRIMARY KEY (`pk_receipt_id`),
  KEY `idx_grant_receipt_cycle` (`fk_cycle_id`,`received_on`),
  CONSTRAINT `fk_grant_receipt_cycle` FOREIGN KEY (`fk_cycle_id`) REFERENCES `grant_cycles` (`pk_cycle_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `grant_district_settings` (
  `fk_district_id` int NOT NULL,
  `require_qualification` tinyint(1) NOT NULL DEFAULT '0',
  `modified_by` int NOT NULL,
  `modified_at_utc` datetime NOT NULL,
  PRIMARY KEY (`fk_district_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `grant_email_templates` (
  `pk_template_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(250) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `modified_by` int NOT NULL,
  `modified_at_utc` datetime NOT NULL,
  PRIMARY KEY (`pk_template_id`),
  UNIQUE KEY `uk_grant_template` (`fk_district_id`,`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `grant_interim_reports` (
  `pk_report_id` int NOT NULL AUTO_INCREMENT,
  `fk_application_id` int NOT NULL,
  `progress` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount_spent` decimal(12,2) NOT NULL,
  `submitted_by` int NOT NULL,
  `submitted_at_utc` datetime NOT NULL,
  PRIMARY KEY (`pk_report_id`),
  KEY `idx_grant_interim_app` (`fk_application_id`),
  CONSTRAINT `fk_grant_interim_app` FOREIGN KEY (`fk_application_id`) REFERENCES `grant_applications` (`pk_application_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `grant_qualified_members` (
  `fk_qualification_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `trained_on` date DEFAULT NULL,
  PRIMARY KEY (`fk_qualification_id`,`fk_member_id`),
  CONSTRAINT `fk_grant_qual_member` FOREIGN KEY (`fk_qualification_id`) REFERENCES `grant_club_qualifications` (`pk_qualification_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `grant_report_reminders` (
  `pk_reminder_id` int NOT NULL AUTO_INCREMENT,
  `fk_application_id` int NOT NULL,
  `report` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stage` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `due_on` date DEFAULT NULL,
  `sent_at_utc` datetime NOT NULL,
  PRIMARY KEY (`pk_reminder_id`),
  UNIQUE KEY `uk_grant_reminder` (`fk_application_id`,`report`,`stage`),
  CONSTRAINT `fk_grant_reminder_app` FOREIGN KEY (`fk_application_id`) REFERENCES `grant_applications` (`pk_application_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `grant_signoffs` (
  `pk_signoff_id` int NOT NULL AUTO_INCREMENT,
  `fk_application_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `action` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `signer_role` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `signature_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `signed_at_utc` datetime NOT NULL,
  PRIMARY KEY (`pk_signoff_id`),
  KEY `idx_grant_signoff_app` (`fk_application_id`),
  CONSTRAINT `fk_grant_signoff_app` FOREIGN KEY (`fk_application_id`) REFERENCES `grant_applications` (`pk_application_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `help_articles` (
  `pk_article_id` int NOT NULL AUTO_INCREMENT,
  `fk_category_id` int NOT NULL,
  `slug` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary` varchar(400) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `body` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `body_text` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `keywords` varchar(400) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `context_path` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `sort_order` int NOT NULL DEFAULT '0',
  `helpful_yes` int NOT NULL DEFAULT '0',
  `helpful_no` int NOT NULL DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `updated_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `published_at` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_article_id`),
  UNIQUE KEY `ux_help_article_slug` (`slug`),
  KEY `ix_help_article_list` (`status`,`fk_category_id`,`sort_order`),
  KEY `fk_help_article_category` (`fk_category_id`),
  CONSTRAINT `fk_help_article_category` FOREIGN KEY (`fk_category_id`) REFERENCES `help_categories` (`pk_category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `help_categories` (
  `pk_category_id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_category_id`),
  UNIQUE KEY `ux_help_category_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `invoice_products` (
  `pk_product_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unit_amount` decimal(12,2) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_product_id`),
  KEY `idx_invoice_products_club` (`fk_club_id`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `invoice_receipt_allocations` (
  `fk_receipt_id` int NOT NULL,
  `fk_invoice_id` int NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `fk_dues_payment_id` int DEFAULT NULL,
  PRIMARY KEY (`fk_receipt_id`,`fk_invoice_id`),
  KEY `idx_invoice_receipt_alloc_invoice` (`fk_invoice_id`),
  CONSTRAINT `fk_invoice_receipt_alloc` FOREIGN KEY (`fk_receipt_id`) REFERENCES `invoice_receipts` (`pk_receipt_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `invoice_receipts` (
  `pk_receipt_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_member_profile_id` int NOT NULL,
  `receipt_date` date NOT NULL,
  `method` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `notes` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`pk_receipt_id`),
  KEY `idx_invoice_receipts_member` (`fk_club_id`,`fk_member_profile_id`),
  KEY `idx_invoice_receipts_date` (`fk_club_id`,`receipt_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `job_board_posts` (
  `pk_post_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `company` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact` varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_on` date NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `review_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewed_by` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`pk_post_id`),
  KEY `idx_job_post_district` (`fk_district_id`,`status`,`expires_on`),
  KEY `idx_job_post_member` (`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `job_board_reports` (
  `pk_report_id` int NOT NULL AUTO_INCREMENT,
  `fk_post_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `resolved_at` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_report_id`),
  UNIQUE KEY `uk_job_report_member` (`fk_post_id`,`fk_member_id`),
  CONSTRAINT `fk_job_report_post` FOREIGN KEY (`fk_post_id`) REFERENCES `job_board_posts` (`pk_post_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `mass_email_attachments` (
  `pk_attachment_id` int NOT NULL AUTO_INCREMENT,
  `fk_mass_email_id` int NOT NULL,
  `FileName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `StoredName` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ContentType` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `SizeBytes` int NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_attachment_id`),
  KEY `idx_mea_email` (`fk_mass_email_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `mass_email_signatures` (
  `fk_member_id` int NOT NULL,
  `SignatureHtml` text COLLATE utf8mb4_unicode_ci,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `mass_email_templates` (
  `pk_template_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL DEFAULT '0',
  `fk_district_id` int NOT NULL DEFAULT '0',
  `Name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Subject` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `BodyHtml` mediumtext COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT NULL,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_template_id`),
  KEY `idx_met_owner` (`fk_club_id`,`fk_district_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `meal_charges` (
  `pk_meal_charge_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_attendance_id` int NOT NULL,
  `fk_member_profile_id` int NOT NULL,
  `guest_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `meal_date` date NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `fk_invoice_id` int DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`pk_meal_charge_id`),
  UNIQUE KEY `uk_meal_charge` (`fk_attendance_id`,`fk_member_profile_id`,`guest_name`),
  KEY `idx_meal_charges_member` (`fk_club_id`,`fk_member_profile_id`,`meal_date`),
  KEY `idx_meal_charges_invoice` (`fk_invoice_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `meal_prices` (
  `fk_club_id` int NOT NULL,
  `fk_attendance_id` int NOT NULL,
  `price` decimal(12,2) NOT NULL,
  `updated_by` int NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`fk_club_id`,`fk_attendance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `member_map_pins` (
  `fk_member_id` int NOT NULL,
  `city` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `area` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `latitude` decimal(5,2) NOT NULL,
  `longitude` decimal(6,2) NOT NULL,
  `modified_utc` datetime NOT NULL,
  PRIMARY KEY (`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `member_mfa` (
  `fk_member_id` int NOT NULL,
  `secret_protected` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pending_secret_protected` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `enabled_at` datetime DEFAULT NULL,
  `last_used_step` bigint DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `member_mfa_recovery_codes` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_id` int NOT NULL,
  `code_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `idx_mfa_recovery_member` (`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `officer_progression` (
  `pk_progression_id` int NOT NULL AUTO_INCREMENT,
  `scope` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `nominee_start_year` int NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_progression_id`),
  KEY `idx_op_scope` (`scope`,`scope_id`,`isdeleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `officer_progression_step` (
  `pk_step_id` int NOT NULL AUTO_INCREMENT,
  `fk_progression_id` int NOT NULL,
  `role` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_year` int NOT NULL,
  `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `applied_ref` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decided_by` int DEFAULT NULL,
  `decided_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_step_id`),
  UNIQUE KEY `uq_ops_role` (`fk_progression_id`,`role`),
  KEY `idx_ops_year` (`start_year`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `profile_update_requests` (
  `pk_request_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `token_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requested_by` int NOT NULL,
  `requested_at` datetime NOT NULL,
  `expires_at` datetime NOT NULL,
  `email_status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `completed_at` datetime DEFAULT NULL,
  `completed_via` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_request_id`),
  UNIQUE KEY `uk_profile_update_token` (`token_hash`),
  KEY `idx_profile_update_club` (`fk_club_id`,`requested_at`),
  KEY `idx_profile_update_member` (`fk_member_id`,`completed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `prospect_notifications` (
  `pk_notification_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `fk_potential_member_id` int NOT NULL,
  `fk_task_id` int DEFAULT NULL,
  `kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(250) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` varchar(600) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `in_app` tinyint(1) NOT NULL DEFAULT '1',
  `email_status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none',
  `email_sent_at` datetime DEFAULT NULL,
  `created_date` datetime NOT NULL,
  PRIMARY KEY (`pk_notification_id`),
  KEY `idx_prospect_notif_member` (`fk_member_id`,`created_date`),
  KEY `idx_prospect_notif_email` (`email_status`),
  KEY `fk_prospect_notif_prospect` (`fk_potential_member_id`),
  CONSTRAINT `fk_prospect_notif_prospect` FOREIGN KEY (`fk_potential_member_id`) REFERENCES `potential_members` (`pk_potential_member_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `prospect_notify_members` (
  `fk_club_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  PRIMARY KEY (`fk_club_id`,`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `prospect_notify_settings` (
  `fk_club_id` int NOT NULL,
  `to_president` tinyint(1) NOT NULL DEFAULT '1',
  `to_membership_chair` tinyint(1) NOT NULL DEFAULT '1',
  `by_in_app` tinyint(1) NOT NULL DEFAULT '1',
  `by_email` tinyint(1) NOT NULL DEFAULT '1',
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `prospect_tasks` (
  `pk_task_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_potential_member_id` int NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `notes` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_assignee_member_id` int NOT NULL,
  `due_date` date NOT NULL,
  `remind_days_before` int DEFAULT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `reminder_sent_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `completed_by` int DEFAULT NULL,
  `completion_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_task_id`),
  KEY `idx_prospect_tasks_club` (`fk_club_id`,`status`,`due_date`),
  KEY `idx_prospect_tasks_assignee` (`fk_assignee_member_id`,`status`),
  KEY `fk_prospect_tasks_prospect` (`fk_potential_member_id`),
  CONSTRAINT `fk_prospect_tasks_prospect` FOREIGN KEY (`fk_potential_member_id`) REFERENCES `potential_members` (`pk_potential_member_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `service_contributions` (
  `pk_contribution_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_project_id` int NOT NULL,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `currency` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contributor` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contribution_date` date NOT NULL,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`pk_contribution_id`),
  KEY `idx_service_contrib_club` (`fk_club_id`,`fk_year_id`,`fk_project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `service_hours` (
  `pk_service_hours_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_project_id` int DEFAULT NULL,
  `other_service` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `service_date` date NOT NULL,
  `hours` decimal(6,2) NOT NULL,
  `note` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `photo_path` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `reviewed_by` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `review_note` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`pk_service_hours_id`),
  KEY `idx_service_hours_club` (`fk_club_id`,`fk_year_id`,`status`),
  KEY `idx_service_hours_member` (`fk_member_id`,`service_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `speaker_bureau_entries` (
  `pk_entry_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bio` varchar(1500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `topics` varchar(800) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `languages` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `email` varchar(254) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `available_online` tinyint(1) NOT NULL DEFAULT '0',
  `available_in_person` tinyint(1) NOT NULL DEFAULT '1',
  `photo_path` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_member_id` int DEFAULT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `fk_proposed_club_id` int DEFAULT NULL,
  `fk_source_speaker_id` int DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `reviewed_by` int DEFAULT NULL,
  `reviewed_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_entry_id`),
  KEY `idx_bureau_district_status` (`fk_district_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `speaker_bureau_ratings` (
  `pk_rating_id` int NOT NULL AUTO_INCREMENT,
  `fk_talk_id` int NOT NULL,
  `rating` tinyint NOT NULL,
  `comment` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `comment_hidden` tinyint(1) NOT NULL DEFAULT '0',
  `hidden_by` int DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL,
  PRIMARY KEY (`pk_rating_id`),
  UNIQUE KEY `uk_bureau_rating_talk` (`fk_talk_id`),
  CONSTRAINT `fk_bureau_rating_talk` FOREIGN KEY (`fk_talk_id`) REFERENCES `speaker_bureau_talks` (`pk_talk_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `speaker_bureau_talks` (
  `pk_talk_id` int NOT NULL AUTO_INCREMENT,
  `fk_entry_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `talk_date` date NOT NULL,
  `source` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_club_speaker_id` int DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL,
  PRIMARY KEY (`pk_talk_id`),
  UNIQUE KEY `uk_bureau_talk` (`fk_entry_id`,`fk_club_id`,`talk_date`),
  CONSTRAINT `fk_bureau_talk_entry` FOREIGN KEY (`fk_entry_id`) REFERENCES `speaker_bureau_entries` (`pk_entry_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `survey_answers` (
  `pk_answer_id` int NOT NULL AUTO_INCREMENT,
  `fk_response_id` int NOT NULL,
  `fk_question_id` int NOT NULL,
  `choices` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `text_value` text COLLATE utf8mb4_unicode_ci,
  `rating` tinyint DEFAULT NULL,
  PRIMARY KEY (`pk_answer_id`),
  UNIQUE KEY `uk_survey_answer` (`fk_response_id`,`fk_question_id`),
  KEY `idx_survey_answer_question` (`fk_question_id`),
  CONSTRAINT `fk_survey_answer_response` FOREIGN KEY (`fk_response_id`) REFERENCES `survey_responses` (`pk_response_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `survey_notifications` (
  `pk_notification_id` int NOT NULL AUTO_INCREMENT,
  `fk_survey_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `notify_at` datetime NOT NULL,
  PRIMARY KEY (`pk_notification_id`),
  UNIQUE KEY `uk_survey_notification` (`fk_survey_id`,`fk_member_id`),
  KEY `idx_survey_notification_member` (`fk_member_id`,`notify_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `survey_questions` (
  `pk_question_id` int NOT NULL AUTO_INCREMENT,
  `fk_survey_id` int NOT NULL,
  `sort_order` int NOT NULL,
  `question_text` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_required` tinyint(1) NOT NULL DEFAULT '0',
  `options_json` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk_question_id`),
  KEY `idx_survey_question_survey` (`fk_survey_id`),
  CONSTRAINT `fk_survey_question_survey` FOREIGN KEY (`fk_survey_id`) REFERENCES `surveys` (`pk_survey_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `survey_responses` (
  `pk_response_id` int NOT NULL AUTO_INCREMENT,
  `fk_survey_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `submitted_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_response_id`),
  UNIQUE KEY `uk_survey_response_member` (`fk_survey_id`,`fk_member_id`),
  KEY `idx_survey_response_member` (`fk_member_id`),
  CONSTRAINT `fk_survey_response_survey` FOREIGN KEY (`fk_survey_id`) REFERENCES `surveys` (`pk_survey_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `surveys` (
  `pk_survey_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int DEFAULT NULL,
  `fk_district_id` int DEFAULT NULL,
  `fk_sub_group_id` int DEFAULT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `is_anonymous` tinyint(1) NOT NULL DEFAULT '0',
  `show_results` tinyint(1) NOT NULL DEFAULT '0',
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `opens_at` datetime NOT NULL,
  `closes_at` datetime NOT NULL,
  `published_at` datetime DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT (utc_timestamp()),
  PRIMARY KEY (`pk_survey_id`),
  KEY `idx_survey_club` (`fk_club_id`),
  KEY `idx_survey_district` (`fk_district_id`),
  KEY `idx_survey_status_close` (`status`,`closes_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `volunteer_followup_sends` (
  `fk_followup_id` int NOT NULL,
  `fk_signup_id` int NOT NULL,
  `sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`fk_followup_id`,`fk_signup_id`),
  KEY `idx_volunteer_followup_send_signup` (`fk_signup_id`),
  CONSTRAINT `fk_volunteer_followup_send_followup` FOREIGN KEY (`fk_followup_id`) REFERENCES `volunteer_followups` (`pk_followup_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_volunteer_followup_send_signup` FOREIGN KEY (`fk_signup_id`) REFERENCES `volunteer_signups` (`pk_signup_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `volunteer_followups` (
  `pk_followup_id` int NOT NULL AUTO_INCREMENT,
  `fk_sheet_id` int NOT NULL,
  `kind` varchar(6) COLLATE utf8mb4_unicode_ci NOT NULL,
  `days` int NOT NULL,
  `subject` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`pk_followup_id`),
  KEY `idx_volunteer_followup_sheet` (`fk_sheet_id`),
  CONSTRAINT `fk_volunteer_followup_sheet` FOREIGN KEY (`fk_sheet_id`) REFERENCES `volunteer_sheets` (`pk_sheet_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `volunteer_sheet_coordinators` (
  `fk_sheet_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  PRIMARY KEY (`fk_sheet_id`,`fk_member_id`),
  CONSTRAINT `fk_volunteer_coordinator_sheet` FOREIGN KEY (`fk_sheet_id`) REFERENCES `volunteer_sheets` (`pk_sheet_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `website_api_keys` (
  `pk_website_api_key_id` int NOT NULL AUTO_INCREMENT,
  `scope_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_id` int NOT NULL,
  `label` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `key_prefix` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `key_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_utc` datetime NOT NULL,
  `last_used_utc` datetime DEFAULT NULL,
  `revoked_utc` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_website_api_key_id`),
  UNIQUE KEY `ux_website_api_keys_hash` (`key_hash`),
  KEY `idx_website_api_keys_scope` (`scope_type`,`scope_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `website_extras` (
  `scope` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_id` int NOT NULL,
  `facebook_page_url` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `instagram_username` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `x_username` varchar(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ga_measurement_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` int DEFAULT NULL,
  `updated_at_utc` datetime NOT NULL DEFAULT (utc_timestamp()),
  PRIMARY KEY (`scope`,`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `website_media` (
  `pk_website_media_id` int NOT NULL AUTO_INCREMENT,
  `owner_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_id` int NOT NULL,
  `url` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `members_only` tinyint(1) NOT NULL DEFAULT '0',
  `content_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_website_media_id`),
  KEY `idx_website_media_owner` (`owner_type`,`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `website_pages` (
  `pk_website_page_id` int NOT NULL AUTO_INCREMENT,
  `owner_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `owner_id` int NOT NULL,
  `slug` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sections_json` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `published_title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `published_sections_json` mediumtext COLLATE utf8mb4_unicode_ci,
  `published_at` datetime DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_by` int DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  `members_only` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_website_page_id`),
  UNIQUE KEY `uq_website_pages_slug` (`owner_type`,`owner_id`,`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `year_rollover_item` (
  `pk_item_id` int NOT NULL AUTO_INCREMENT,
  `fk_run_id` int NOT NULL,
  `kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_id` int NOT NULL DEFAULT '0',
  `target_table` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target_id` int NOT NULL,
  PRIMARY KEY (`pk_item_id`),
  KEY `idx_yri_run` (`fk_run_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `year_rollover_run` (
  `pk_run_id` int NOT NULL AUTO_INCREMENT,
  `scope` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope_id` int NOT NULL,
  `from_year_id` int NOT NULL,
  `to_year_id` int NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'applied',
  `summary_json` text COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `undone_by` int DEFAULT NULL,
  `undone_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_run_id`),
  KEY `idx_yrr_scope` (`scope`,`scope_id`,`to_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `youth_officers` (
  `pk_officer_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_club_id` int NOT NULL DEFAULT '0',
  `fk_member_id` int NOT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL,
  PRIMARY KEY (`pk_officer_id`),
  UNIQUE KEY `uk_youth_officer` (`fk_district_id`,`fk_club_id`,`fk_member_id`),
  KEY `idx_youth_officer_member` (`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `youth_participants` (
  `pk_participant_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `program` varchar(4) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_sponsor_club_id` int NOT NULL,
  `full_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `contact_email` varchar(254) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'applied',
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_participant_id`),
  KEY `idx_youth_part_district` (`fk_district_id`,`fk_year_id`,`program`),
  KEY `idx_youth_part_club` (`fk_sponsor_club_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `ypp_clearances` (
  `pk_clearance_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `training_date` date DEFAULT NULL,
  `check_date` date DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `reminder_sent_for` date DEFAULT NULL,
  `modified_by` int NOT NULL,
  `modified_date` datetime NOT NULL,
  PRIMARY KEY (`pk_clearance_id`),
  UNIQUE KEY `uk_ypp_member` (`fk_district_id`,`fk_member_id`),
  KEY `idx_ypp_member` (`fk_member_id`),
  KEY `idx_ypp_expiry` (`expiry_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

-- columns on tables that already existed (added only when the table exists and the column does not)
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sub_groups') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sub_groups' AND COLUMN_NAME = 'fk_parent_sub_group_id') = 0, 'ALTER TABLE `sub_groups` ADD COLUMN `fk_parent_sub_group_id` int NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'district_committee_group') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'district_committee_group' AND COLUMN_NAME = 'fk_parent_group_id') = 0, 'ALTER TABLE `district_committee_group` ADD COLUMN `fk_parent_group_id` int NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contact_groups') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contact_groups' AND COLUMN_NAME = 'system_key') = 0, 'ALTER TABLE `contact_groups` ADD COLUMN `system_key` varchar(20) NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_application_lines') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_application_lines' AND COLUMN_NAME = 'category') = 0, 'ALTER TABLE `grant_application_lines` ADD COLUMN `category` varchar(60) NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_application_lines') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_application_lines' AND COLUMN_NAME = 'supplier') = 0, 'ALTER TABLE `grant_application_lines` ADD COLUMN `supplier` varchar(150) NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_application_lines') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_application_lines' AND COLUMN_NAME = 'actual_amount') = 0, 'ALTER TABLE `grant_application_lines` ADD COLUMN `actual_amount` decimal(12,2) NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_applications') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_applications' AND COLUMN_NAME = 'report_accepted_at') = 0, 'ALTER TABLE `grant_applications` ADD COLUMN `report_accepted_at` datetime NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_applications') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_applications' AND COLUMN_NAME = 'report_accepted_by') = 0, 'ALTER TABLE `grant_applications` ADD COLUMN `report_accepted_by` int NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_cycles') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grant_cycles' AND COLUMN_NAME = 'interim_due_on') = 0, 'ALTER TABLE `grant_cycles` ADD COLUMN `interim_due_on` date NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rotary_org_sync_logins') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rotary_org_sync_logins' AND COLUMN_NAME = 'fk_club_id') = 0, 'ALTER TABLE `rotary_org_sync_logins` ADD COLUMN `fk_club_id` int NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rotary_org_sync_requests') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rotary_org_sync_requests' AND COLUMN_NAME = 'fk_club_id') = 0, 'ALTER TABLE `rotary_org_sync_requests` ADD COLUMN `fk_club_id` int NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'volunteer_sheets') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'volunteer_sheets' AND COLUMN_NAME = 'confirmation_text') = 0, 'ALTER TABLE `volunteer_sheets` ADD COLUMN `confirmation_text` text NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'volunteer_sheets') = 1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'volunteer_sheets' AND COLUMN_NAME = 'archived_at') = 0, 'ALTER TABLE `volunteer_sheets` ADD COLUMN `archived_at` datetime NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- indexes
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rotary_org_sync_logins') = 1 AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rotary_org_sync_logins' AND INDEX_NAME = 'ix_rosl_club') = 0, 'CREATE INDEX ix_rosl_club ON rotary_org_sync_logins (fk_club_id, isdeleted)', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl := IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rotary_org_sync_requests') = 1 AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rotary_org_sync_requests' AND INDEX_NAME = 'ix_rosr_club') = 0, 'CREATE INDEX ix_rosr_club ON rotary_org_sync_requests (fk_club_id, pk_id)', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- starter rows: help centre categories and articles, the website 'pages' module
INSERT  IGNORE INTO `help_categories` VALUES (1,'getting-started','Getting started','Signing in, finding your way around and choosing your language.',1,'2026-11-20 04:53:19','2026-11-20 04:53:19');
INSERT  IGNORE INTO `help_categories` VALUES (2,'members-and-app','Members and the app','Using the ROW mobile app as a club member.',2,'2026-11-20 04:53:19','2026-11-20 04:53:19');
INSERT  IGNORE INTO `help_categories` VALUES (3,'club-administration','Club administration','Running your club in the web admin: members, reports, projects and people.',3,'2026-11-20 04:53:19','2026-11-20 04:53:19');
INSERT  IGNORE INTO `help_categories` VALUES (4,'communication','Communication','Announcements, mass email, greetings and chat.',4,'2026-11-20 04:53:19','2026-11-20 04:53:19');
INSERT  IGNORE INTO `help_categories` VALUES (5,'club-website','Club website','Setting up and editing your club\'s public website.',5,'2026-11-20 04:53:19','2026-11-20 04:53:19');
INSERT  IGNORE INTO `help_categories` VALUES (6,'district-administration','District administration','Tools for district teams and Assistant Governors.',6,'2026-11-20 04:53:19','2026-11-20 04:53:19');
INSERT  IGNORE INTO `help_categories` VALUES (7,'account-and-privacy','Account, privacy and billing','Passwords, your data, subscriptions and payments.',7,'2026-11-20 04:53:19','2026-11-20 04:53:19');
INSERT  IGNORE INTO `help_articles` VALUES (1,1,'sign-in-to-row','Sign in to ROW','How to sign in to the web admin and the mobile app with your email address.','<p>ROW uses your email address to sign in, on the web and in the app. Your club or district administrator adds you to ROW, and you then sign in with the email address they used.</p>\n<h2>On the web</h2>\n<ol>\n<li>Open the ROW sign-in page and enter your email address and password.</li>\n<li>Tick <strong>Remember Me</strong> only on a computer that is yours.</li>\n<li>Select <strong>Sign In</strong>.</li>\n</ol>\n<p>If you do not have a password yet, choose <strong>Sign in with an email code</strong>. ROW emails you a one-time code to type in.</p>\n<h2>In the app</h2>\n<p>Install ROW from the App Store or Google Play, open it and sign in with the same email address and password.</p>\n<h2>If sign-in is refused</h2>\n<ul>\n<li>Check the email address for typing mistakes. It must be the one your club has on file.</li>\n<li>After several failed tries ROW pauses sign-in for about a minute. Wait and try again.</li>\n<li>If your district\'s trial has ended, the message says so. Your data is kept; ask your district to renew.</li>\n</ul>','ROW uses your email address to sign in, on the web and in the app. Your club or district administrator adds you to ROW, and you then sign in with the email address they used. On the web Open the ROW sign-in page and enter your email address and password. Tick Remember Me only on a computer that is yours. Select Sign In . If you do not have a password yet, choose Sign in with an email code . ROW emails you a one-time code to type in. In the app Install ROW from the App Store or Google Play, open it and sign in with the same email address and password. If sign-in is refused Check the email address for typing mistakes. It must be the one your club has on file. After several failed tries ROW pauses sign-in for about a minute. Wait and try again. If your district\'s trial has ended, the message says so. Your data is kept; ask your district to renew.','sign in, login, log in, password, email code','/login','published',1,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (2,1,'reset-your-password','Reset your password','Forgot your password? Set a new one from the sign-in page.','<ol>\n<li>On the sign-in page, select <strong>Forgot Password</strong>.</li>\n<li>Enter the email address you sign in with and send the request.</li>\n<li>Open the email from ROW and follow the link to choose a new password. The link works for a limited time.</li>\n<li>Sign in with the new password, on the web and in the app.</li>\n</ol>\n<p>No email after a few minutes? Look in your spam or junk folder. If it is not there, your club administrator can check that ROW has the right email address for you.</p>','On the sign-in page, select Forgot Password . Enter the email address you sign in with and send the request. Open the email from ROW and follow the link to choose a new password. The link works for a limited time. Sign in with the new password, on the web and in the app. No email after a few minutes? Look in your spam or junk folder. If it is not there, your club administrator can check that ROW has the right email address for you.','password, forgot password, reset, sign in','/forgot-password','published',2,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (3,1,'choose-your-language','Choose your language','Use ROW in English, French, German, Italian, Japanese, Korean, Portuguese or Spanish.','<p>ROW can show its screens in eight languages: English, French, German, Italian, Japanese, Korean, Portuguese and Spanish.</p>\n<h2>On the web</h2>\n<p>Use the language picker at the top of the page. Your choice is remembered in that browser.</p>\n<h2>In the app</h2>\n<ol>\n<li>Open <strong>Settings</strong>.</li>\n<li>Tap <strong>Language</strong> and pick yours.</li>\n</ol>\n<p>Screens are translated by machine. Names, club names and what people write (announcements, notes) stay as they were entered. Emails from ROW use the language set on your profile, or your club\'s language when you have not chosen one.</p>','ROW can show its screens in eight languages: English, French, German, Italian, Japanese, Korean, Portuguese and Spanish. On the web Use the language picker at the top of the page. Your choice is remembered in that browser. In the app Open Settings . Tap Language and pick yours. Screens are translated by machine. Names, club names and what people write (announcements, notes) stay as they were entered. Emails from ROW use the language set on your profile, or your club\'s language when you have not chosen one.','language, translation, french, german, italian, japanese, korean, portuguese, spanish',NULL,'published',3,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (4,1,'find-your-way-around-the-admin','Find your way around the web admin','What the dashboards are and how to switch between your roles and Rotary years.','<p>When you sign in, ROW opens the dashboard for your role: Club Admin, District Admin or Assistant Governor. If you hold more than one role, the sidebar lets you switch between them.</p>\n<h2>The sidebar</h2>\n<p>Each module has its own entry in the sidebar, for example <strong>Membership</strong>, <strong>Projects / Events</strong>, <strong>E-Governance</strong> and <strong>Communication</strong>. Some modules appear only when your district or the platform has switched them on.</p>\n<h2>Rotary years</h2>\n<p>Most pages show one Rotary year (1 July to 30 June). Use the year picker at the top of the dashboard to look at another year. Past years can be read; whether you can still change them depends on the rights your district gave you for that year.</p>','When you sign in, ROW opens the dashboard for your role: Club Admin, District Admin or Assistant Governor. If you hold more than one role, the sidebar lets you switch between them. The sidebar Each module has its own entry in the sidebar, for example Membership , Projects / Events , E-Governance and Communication . Some modules appear only when your district or the platform has switched them on. Rotary years Most pages show one Rotary year (1 July to 30 June). Use the year picker at the top of the dashboard to look at another year. Past years can be read; whether you can still change them depends on the rights your district gave you for that year.','dashboard, role, rotary year, year picker, navigation, sidebar','/club-admin-dashboard/dashboard','published',4,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (5,2,'using-the-row-app','Get started with the ROW app','What members can do in the app: directory, calendar, notifications and more.','<p>The ROW app is for every member of a club using ROW. After you sign in you can:</p>\n<ul>\n<li>Look up members of your club in the directory.</li>\n<li>See your club\'s meetings and events in the calendar, with times in your own time zone.</li>\n<li>Read announcements and get push notifications from your club and district.</li>\n<li>Find other Rotarians and clubs.</li>\n<li>Chat with members, where your club has chat turned on.</li>\n<li>Update your own profile.</li>\n</ul>\n<p>Officers see extra tools for their role, such as targets and admin screens.</p>','The ROW app is for every member of a club using ROW. After you sign in you can: Look up members of your club in the directory. See your club\'s meetings and events in the calendar, with times in your own time zone. Read announcements and get push notifications from your club and district. Find other Rotarians and clubs. Chat with members, where your club has chat turned on. Update your own profile. Officers see extra tools for their role, such as targets and admin screens.','app, mobile, directory, calendar, notifications, members',NULL,'published',5,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (6,2,'add-meetings-to-your-phone-calendar','Add club meetings to your phone calendar','Create a personal calendar link so meetings and events appear in your calendar app.','<p>Where your club has meetings turned on, you can follow your clubs\' meetings and events in your phone\'s own calendar app.</p>\n<ol>\n<li>In the app, open <strong>Settings</strong>, then <strong>Communication</strong>.</li>\n<li>Under <strong>Calendar feed</strong>, tap <strong>Create my calendar link</strong>.</li>\n<li>Tap <strong>Open in calendar app</strong>, or <strong>Copy link</strong> and add it as a subscribed calendar.</li>\n</ol>\n<p>The link is personal. If you shared it by mistake, tap <strong>Make a new link</strong>: the old one stops working.</p>','Where your club has meetings turned on, you can follow your clubs\' meetings and events in your phone\'s own calendar app. In the app, open Settings , then Communication . Under Calendar feed , tap Create my calendar link . Tap Open in calendar app , or Copy link and add it as a subscribed calendar. The link is personal. If you shared it by mistake, tap Make a new link : the old one stops working.','calendar, feed, ical, meetings, events, phone',NULL,'published',6,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (7,2,'choose-email-and-push-messages','Choose which messages you receive','Turn club emails and push notifications on or off, and set your email language.','<ol>\n<li>In the app, open <strong>Settings</strong>, then <strong>Communication</strong>.</li>\n<li>Switch <strong>Email</strong> off to stop newsletters, announcements and mass emails from your club and district.</li>\n<li>Switch <strong>Push notifications</strong> off to stop app alerts.</li>\n</ol>\n<p>Messages you need for your account, such as password resets, are still sent. Every newsletter email also has an unsubscribe link.</p>\n<p>This screen appears once your club uses ROW\'s email features.</p>','In the app, open Settings , then Communication . Switch Email off to stop newsletters, announcements and mass emails from your club and district. Switch Push notifications off to stop app alerts. Messages you need for your account, such as password resets, are still sent. Every newsletter email also has an unsubscribe link. This screen appears once your club uses ROW\'s email features.','email, push, notifications, consent, unsubscribe, newsletter',NULL,'published',7,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (8,3,'add-and-manage-members','Add and manage club members','Keep your member directory up to date: add members, edit details and record when someone leaves.','<p>Open <strong>Membership</strong> in the Club Admin sidebar. You see the member directory with totals, new joiners this Rotary year and monthly growth.</p>\n<h2>Find a member</h2>\n<p>Use <strong>Search members</strong> to filter by name.</p>\n<h2>Add or edit</h2>\n<p>Add a member with their name and email address. The email address is what they use to sign in, so check it carefully. Open a member to edit their details, membership type and join reason.</p>\n<h2>When a member leaves</h2>\n<p>Remove the member from the club and pick the termination reason. Their attendance and payment history stays in the club\'s records.</p>\n<p>If your club is linked to Rotary.org, membership changes are compared with Rotary\'s records during the sync.</p>','Open Membership in the Club Admin sidebar. You see the member directory with totals, new joiners this Rotary year and monthly growth. Find a member Use Search members to filter by name. Add or edit Add a member with their name and email address. The email address is what they use to sign in, so check it carefully. Open a member to edit their details, membership type and join reason. When a member leaves Remove the member from the club and pick the termination reason. Their attendance and payment history stays in the club\'s records. If your club is linked to Rotary.org, membership changes are compared with Rotary\'s records during the sync.','members, membership, directory, add member, remove member, termination','/club-admin-dashboard/membership','published',8,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (9,3,'record-attendance-and-monthly-reports','Record attendance and send the monthly report','Use E-Governance for meetings, attendance and the Club Monthly Report.','<p>Open <strong>E-Governance</strong> in the Club Admin sidebar. It holds attendance, reports, citations and what you submit to the district.</p>\n<h2>Attendance</h2>\n<ol>\n<li>Open the <strong>Attendance</strong> tab and add the meeting with its date, time and mode: in person, online or hybrid.</li>\n<li>Mark who attended. Meeting times are entered in your club\'s local time.</li>\n</ol>\n<h2>Club Monthly Report</h2>\n<p>Open <strong>Club Monthly Report</strong>, check the figures ROW has filled in from your records, complete the rest and submit it. Your district receives it, and ROW sends a reminder when a report has not been submitted.</p>','Open E-Governance in the Club Admin sidebar. It holds attendance, reports, citations and what you submit to the district. Attendance Open the Attendance tab and add the meeting with its date, time and mode: in person, online or hybrid. Mark who attended. Meeting times are entered in your club\'s local time. Club Monthly Report Open Club Monthly Report , check the figures ROW has filled in from your records, complete the rest and submit it. Your district receives it, and ROW sends a reminder when a report has not been submitted.','attendance, meeting, monthly report, cmr, e-governance, reporting','/club-admin-dashboard/e-governance','published',9,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (10,3,'projects-and-events','Add service projects and events','Record your club\'s projects and events with their Area of Focus.','<p>Open <strong>Projects / Events</strong> in the Club Admin sidebar to record what your club does.</p>\n<ol>\n<li>Add a project or event with its title, date and description.</li>\n<li>Choose its <strong>Area of Focus</strong>. ROW uses the Rotary Areas of Focus to group projects.</li>\n<li>Add photos and the figures the form asks for.</li>\n</ol>\n<p><strong>Service Projects &amp; Public Image</strong> shows the same work grouped for reporting. Projects can also appear on your club website.</p>','Open Projects / Events in the Club Admin sidebar to record what your club does. Add a project or event with its title, date and description. Choose its Area of Focus . ROW uses the Rotary Areas of Focus to group projects. Add photos and the figures the form asks for. Service Projects & Public Image shows the same work grouped for reporting. Projects can also appear on your club website.','projects, events, service, area of focus, public image','/club-admin-dashboard/foundation','published',10,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (11,3,'volunteers-speakers-and-duties','Organise volunteers, speakers and meeting duties','Run sign-up sheets for volunteers and plan speakers and duties for coming meetings.','<p>These two modules appear when the volunteers feature is on for your club.</p>\n<h2>Volunteers</h2>\n<p>Open <strong>Volunteers</strong> and create a sign-up sheet with its time slots and the number of places in each. Members sign up in the app, and the page shows the places taken.</p>\n<h2>Speakers and meeting duties</h2>\n<p>Open <strong>Speakers &amp; Duties</strong>. Add a speaker with the meeting date and topic; their email and phone are for the club only and are not shown on the website. Assign members to duties for coming meetings. Speakers booked for the next 30 days are listed in the club newsletter email.</p>','These two modules appear when the volunteers feature is on for your club. Volunteers Open Volunteers and create a sign-up sheet with its time slots and the number of places in each. Members sign up in the app, and the page shows the places taken. Speakers and meeting duties Open Speakers & Duties . Add a speaker with the meeting date and topic; their email and phone are for the club only and are not shown on the website. Assign members to duties for coming meetings. Speakers booked for the next 30 days are listed in the club newsletter email.','volunteers, sign-up sheet, speakers, duties, meetings','/club-admin-dashboard/volunteers','published',11,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (12,3,'goals-and-targets','Set goals and follow your targets','Enter the club\'s goals for the Rotary year and respond to targets proposed by the district.','<h2>Goal Setting</h2>\n<p>Open <strong>Goal Setting</strong> to enter your club\'s goals for the Rotary year. The district sees them in its goal overview.</p>\n<h2>Targets</h2>\n<p>Open <strong>Targets</strong> to see your club\'s live figures against its targets. When your district proposes a target for a metric such as membership growth or Foundation giving, you can accept it or reply with your own value and a note. The district sees your answer and can propose again.</p>','Goal Setting Open Goal Setting to enter your club\'s goals for the Rotary year. The district sees them in its goal overview. Targets Open Targets to see your club\'s live figures against its targets. When your district proposes a target for a metric such as membership growth or Foundation giving, you can accept it or reply with your own value and a note. The district sees your answer and can propose again.','goals, goal setting, targets, district target, proposal','/club-admin-dashboard/targets','published',12,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (13,4,'announcements-and-newsletters','Publish announcements, events and newsletters','Share news with your members in the app and by email.','<p>Open <strong>Communication</strong> in the Club Admin sidebar. The tabs are Announcements, Upcoming Events, Newsletters, Documents, Greetings, Mass Email, Subgroups and Web Links.</p>\n<h2>Announcements</h2>\n<ol>\n<li>Add an announcement with a title and text.</li>\n<li>Set the <strong>Publish Date</strong> and an <strong>Expiry Date</strong>; it shows to members between those dates.</li>\n<li>Choose whether to show it on the banner and whether to repeat the notification.</li>\n</ol>\n<h2>Newsletters and documents</h2>\n<p>Upload a newsletter or document and choose who may open it. Members find them in the app.</p>\n<h2>Subgroups</h2>\n<p>Make subgroups, such as a committee, to send to some members only.</p>','Open Communication in the Club Admin sidebar. The tabs are Announcements, Upcoming Events, Newsletters, Documents, Greetings, Mass Email, Subgroups and Web Links. Announcements Add an announcement with a title and text. Set the Publish Date and an Expiry Date ; it shows to members between those dates. Choose whether to show it on the banner and whether to repeat the notification. Newsletters and documents Upload a newsletter or document and choose who may open it. Members find them in the app. Subgroups Make subgroups, such as a committee, to send to some members only.','announcements, newsletters, documents, events, communication, publish','/club-admin-dashboard/communication','published',13,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (14,4,'send-a-mass-email','Send a mass email to members','Write an email with the editor and send it to your club or a subgroup.','<ol>\n<li>In <strong>Communication</strong>, open the <strong>Mass Email</strong> tab and start a new email.</li>\n<li>Choose the recipients: the whole club or a subgroup.</li>\n<li>Write the subject and message. You can add headings, lists, links and pictures; pictures are uploaded so they show in every mail program.</li>\n<li>Send now, or schedule it for later.</li>\n</ol>\n<p>Members who switched email off do not receive it. The email log shows what was sent and any addresses that bounced. Your club\'s monthly email allowance and sender name are under <strong>Email Settings</strong>.</p>','In Communication , open the Mass Email tab and start a new email. Choose the recipients: the whole club or a subgroup. Write the subject and message. You can add headings, lists, links and pictures; pictures are uploaded so they show in every mail program. Send now, or schedule it for later. Members who switched email off do not receive it. The email log shows what was sent and any addresses that bounced. Your club\'s monthly email allowance and sender name are under Email Settings .','mass email, email, send, newsletter, subgroup, brevo','/club-admin-dashboard/communication/mass-email','published',14,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (15,4,'birthday-and-anniversary-greetings','Birthday and anniversary greetings','ROW greets members on their birthdays and anniversaries. Edit the wording for your club.','<p>ROW sends greetings for members\' birthdays and wedding anniversaries from the dates in their profiles.</p>\n<p>In <strong>Communication</strong>, open <strong>Greetings</strong> to see today\'s greetings and those coming up this week and this month. Choose <strong>Edit birthday &amp; anniversary messages</strong> to change the wording your club sends.</p>\n<p>A member who has no date in their profile is not greeted, so ask members to complete their profile.</p>','ROW sends greetings for members\' birthdays and wedding anniversaries from the dates in their profiles. In Communication , open Greetings to see today\'s greetings and those coming up this week and this month. Choose Edit birthday & anniversary messages to change the wording your club sends. A member who has no date in their profile is not greeted, so ask members to complete their profile.','greetings, birthday, anniversary, wedding, messages',NULL,'published',15,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (16,4,'chat-and-moderation','Club chat and reported messages','How chat works in the app and how officers handle reported messages.','<p>When chat is turned on, members can message each other in the app.</p>\n<p>Any member can report a message. Reported messages appear in <strong>Chat Moderation</strong> in the Club Admin sidebar, where an officer reads the message and decides whether to remove it.</p>','When chat is turned on, members can message each other in the app. Any member can report a message. Reported messages appear in Chat Moderation in the Club Admin sidebar, where an officer reads the message and decides whether to remove it.','chat, messages, report, moderation','/club-admin-dashboard/chat-moderation','published',16,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (17,5,'set-up-your-club-website','Set up your club website','Choose a theme and fill in the sections of your club\'s public website.','<p>Open <strong>My Club Website</strong> in the Club Admin sidebar. Each card edits one part of your site:</p>\n<ul>\n<li><strong>Change Theme</strong>: pick a colour palette and visual style.</li>\n<li><strong>Banner Photos</strong>: the pictures in the homepage carousel.</li>\n<li><strong>About</strong>: the text that introduces your club.</li>\n<li><strong>Contact Details</strong>: phone, email and address shown in the footer.</li>\n<li>Menu: reorder, rename and hide menu items.</li>\n<li><strong>Advertisement Area</strong>: sponsor and promo blocks.</li>\n<li>Languages: offer the site in more languages.</li>\n</ul>\n<p>Your events, projects and board are taken from ROW, so the site stays current without extra work. If the page says the website is not yet set up, your plan does not include a website yet; see <strong>Subscription</strong>.</p>','Open My Club Website in the Club Admin sidebar. Each card edits one part of your site: Change Theme : pick a colour palette and visual style. Banner Photos : the pictures in the homepage carousel. About : the text that introduces your club. Contact Details : phone, email and address shown in the footer. Menu: reorder, rename and hide menu items. Advertisement Area : sponsor and promo blocks. Languages: offer the site in more languages. Your events, projects and board are taken from ROW, so the site stays current without extra work. If the page says the website is not yet set up, your plan does not include a website yet; see Subscription .','website, club website, theme, banner, about, contact, menu','/club-admin-dashboard/my-club-website','published',17,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (18,6,'district-dashboard-overview','The District Admin dashboard','What district teams can see and do across their clubs.','<p>District Admins see every club in the district. From the sidebar you can:</p>\n<ul>\n<li>Follow membership, meetings and reporting across clubs.</li>\n<li>Check which clubs have sent their monthly reports, and see meeting compliance.</li>\n<li>Propose targets to clubs and follow goal setting.</li>\n<li>Send communication to the whole district.</li>\n<li>Assign Assistant Governors to clubs.</li>\n<li>Manage the district website and quick links.</li>\n</ul>','District Admins see every club in the district. From the sidebar you can: Follow membership, meetings and reporting across clubs. Check which clubs have sent their monthly reports, and see meeting compliance. Propose targets to clubs and follow goal setting. Send communication to the whole district. Assign Assistant Governors to clubs. Manage the district website and quick links.','district, district admin, clubs, overview, compliance','/district-admin-dashboard','published',18,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (19,6,'assistant-governors','Assign Assistant Governors to clubs','Give an Assistant Governor access to the clubs they look after.','<ol>\n<li>Open the Assistant Governor page in the District Admin sidebar.</li>\n<li>Choose the member and the clubs they look after for the Rotary year.</li>\n<li>Save. ROW emails the Assistant Governor that they were assigned.</li>\n</ol>\n<p>An Assistant Governor sees only their assigned clubs, on their own AG dashboard, and can read those clubs\' reports.</p>','Open the Assistant Governor page in the District Admin sidebar. Choose the member and the clubs they look after for the Rotary year. Save. ROW emails the Assistant Governor that they were assigned. An Assistant Governor sees only their assigned clubs, on their own AG dashboard, and can read those clubs\' reports.','assistant governor, ag, clubs, assign, access','/district-admin-dashboard/ag','published',19,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (20,7,'download-your-data','Download your data or withdraw consent','See what ROW holds about you and ask for a copy.','<ol>\n<li>In the app, open <strong>Settings</strong>, then <strong>My data</strong>.</li>\n<li>Ask for a download of your data, or withdraw a consent you gave.</li>\n</ol>\n<p>Requests to correct or erase your data go to your club or district, who handle them in ROW. Attendance and payment totals are kept for the club\'s records after an erasure, without your name.</p>\n<p>The Privacy Policy on the ROW website explains what is collected and why.</p>','In the app, open Settings , then My data . Ask for a download of your data, or withdraw a consent you gave. Requests to correct or erase your data go to your club or district, who handle them in ROW. Attendance and payment totals are kept for the club\'s records after an erasure, without your name. The Privacy Policy on the ROW website explains what is collected and why.','privacy, my data, download, consent, gdpr, erase',NULL,'published',20,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (21,7,'subscriptions-and-renewals','Subscriptions and renewals','See your club\'s or district\'s plan, and renew it.','<p>Open <strong>Subscription</strong> in the Club Admin or District Admin sidebar. It shows your current plan, its state (active, in grace, or expired) and when the term ends.</p>\n<p>Officers who may buy see the option to renew. The price is set by ROW and shown before you pay.</p>\n<p>District Admins get an email 60 days before the term ends, and reminders after it if the term was not renewed. This page always stays open, even when a subscription has ended, so you can renew.</p>','Open Subscription in the Club Admin or District Admin sidebar. It shows your current plan, its state (active, in grace, or expired) and when the term ends. Officers who may buy see the option to renew. The price is set by ROW and shown before you pay. District Admins get an email 60 days before the term ends, and reminders after it if the term was not renewed. This page always stays open, even when a subscription has ended, so you can renew.','subscription, renew, plan, trial, billing, payment','/club-admin-dashboard/subscription','published',21,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT  IGNORE INTO `help_articles` VALUES (22,7,'app-lock','Lock the app with Face ID or a passcode','Ask for your phone\'s Face ID, fingerprint or passcode each time the app opens.','<ol>\n<li>In the app, open <strong>Settings</strong>.</li>\n<li>Tap <strong>App Lock</strong> and switch it on.</li>\n</ol>\n<p>From then on the app asks for your phone\'s Face ID, fingerprint or passcode when it opens. This protects member contact details if someone else uses your phone.</p>','In the app, open Settings . Tap App Lock and switch it on. From then on the app asks for your phone\'s Face ID, fingerprint or passcode when it opens. This protects member contact details if someone else uses your phone.','app lock, face id, fingerprint, passcode, security',NULL,'published',22,0,0,NULL,NULL,'2026-11-20 04:53:23','2026-11-20 04:53:23','2026-11-20 04:53:23');
INSERT INTO website_data_module_master (module_name, module_key, icon_class, sort_order, created_date, isdeleted)
  SELECT 'Pages and Layout', 'pages', 'LayoutGrid', 9, UTC_TIMESTAMP(), 0 FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM website_data_module_master WHERE module_key = 'pages');

SET FOREIGN_KEY_CHECKS = @old_fk;
