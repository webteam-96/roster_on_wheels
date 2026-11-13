-- Schema catch-up for row_production, 2026-11-13: the 15 tables the 9 Nov code creates at start-up
-- (Year-wise Admin Rights, Rotary.org goals and DG Sync, AI Assistant). The server API runs with Database__SkipInit=true,
-- so it does not create them itself. Taken with SHOW CREATE TABLE from row_prod_copy after the new code started on it.
-- Safe to run again (IF NOT EXISTS, INSERT IGNORE). Undo: 2026-11-13-schema-catchup-down.sql
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `assistant_answer_cache` (
  `cache_key` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `answer` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `model` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime NOT NULL,
  `hits` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`cache_key`),
  KEY `ix_aac_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `assistant_budget_monthly` (
  `budget_month` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cap_usd` decimal(10,2) NOT NULL,
  `spent_usd` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `reserved_usd` decimal(12,6) NOT NULL DEFAULT '0.000000',
  PRIMARY KEY (`budget_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `assistant_conversations` (
  `pk_conversation_id` bigint NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_conversation_id`),
  KEY `ix_ac_member` (`member_id`,`isdeleted`,`updated_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `assistant_index_items` (
  `source` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `item_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `point_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `indexed_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`source`,`item_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `assistant_messages` (
  `pk_message_id` bigint NOT NULL AUTO_INCREMENT,
  `conversation_id` bigint NOT NULL,
  `member_id` int NOT NULL,
  `role` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `route` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `model` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `language` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `input_tokens` int NOT NULL DEFAULT '0',
  `output_tokens` int NOT NULL DEFAULT '0',
  `cache_read_tokens` int NOT NULL DEFAULT '0',
  `cache_write_tokens` int NOT NULL DEFAULT '0',
  `cost_usd` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `latency_ms` int NOT NULL DEFAULT '0',
  `tools_used` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `flag` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_message_id`),
  KEY `ix_am_conversation` (`conversation_id`,`pk_message_id`),
  KEY `ix_am_created` (`created_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `assistant_security_events` (
  `pk_event_id` bigint NOT NULL AUTO_INCREMENT,
  `member_id` int NOT NULL,
  `kind` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `detail` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_event_id`),
  KEY `ix_ase_member` (`member_id`,`created_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `assistant_usage_daily` (
  `member_id` int NOT NULL,
  `usage_date` date NOT NULL,
  `questions` int NOT NULL DEFAULT '0',
  `contact_lookups` int NOT NULL DEFAULT '0',
  `cost_usd` decimal(12,6) NOT NULL DEFAULT '0.000000',
  PRIMARY KEY (`member_id`,`usage_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `assistant_users` (
  `member_id` int NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `daily_limit` int DEFAULT NULL,
  `blocked_until` datetime DEFAULT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `goal_rotary_org_values` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_year_id` int NOT NULL,
  `EntityType` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_district_id` int NOT NULL DEFAULT '0',
  `fk_club_id` int NOT NULL DEFAULT '0',
  `ItemName` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Kind` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `NumericValue` decimal(18,2) DEFAULT NULL,
  `Source` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uq_grov` (`fk_year_id`,`EntityType`,`fk_district_id`,`fk_club_id`,`ItemName`,`Kind`),
  KEY `ix_grov_district` (`fk_district_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `member_admin_years` (
  `pk_member_admin_year_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_master_profile_id` int NOT NULL,
  `fk_club_id` int NOT NULL DEFAULT '0',
  `fk_district_id` int NOT NULL DEFAULT '0',
  `fk_year_id` int NOT NULL DEFAULT '0',
  `AllYears` tinyint(1) NOT NULL DEFAULT '0',
  `GrantedBy` int DEFAULT NULL,
  `GrantedDate` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `RevokedBy` int DEFAULT NULL,
  `RevokedDate` datetime DEFAULT NULL,
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_member_admin_year_id`),
  UNIQUE KEY `idx_may_unique_grant` (`fk_member_master_profile_id`,`fk_club_id`,`fk_district_id`,`fk_year_id`),
  KEY `idx_may_member` (`fk_member_master_profile_id`,`IsActive`,`isdeleted`),
  KEY `idx_may_club` (`fk_club_id`,`fk_year_id`),
  KEY `idx_may_district` (`fk_district_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `rotary_org_club_member_sync_status` (
  `fk_club_id` int NOT NULL,
  `LastOkUtc` datetime DEFAULT NULL,
  `LastFailUtc` datetime DEFAULT NULL,
  `LastError` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `modified_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `rotary_org_sync_logins` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `RotaryEmail` varchar(200) NOT NULL,
  `PasswordEnc` varchar(1000) DEFAULT NULL,
  `AllowNightly` tinyint(1) NOT NULL DEFAULT '0',
  `Status` varchar(20) NOT NULL DEFAULT 'NEW',
  `StatusMessage` varchar(500) DEFAULT NULL,
  `LastOkAt` datetime DEFAULT NULL,
  `ExpiredMailSentAt` datetime DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  KEY `ix_rosl_district` (`fk_district_id`,`isdeleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
;

CREATE TABLE IF NOT EXISTS `rotary_org_sync_requests` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `DistrictNumber` varchar(20) NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_member_id` int DEFAULT NULL,
  `TriggerType` varchar(10) NOT NULL,
  `fk_login_id` int DEFAULT NULL,
  `OneTimeEmail` varchar(200) DEFAULT NULL,
  `OneTimePasswordEnc` varchar(1000) DEFAULT NULL,
  `SaveOnSuccess` tinyint(1) NOT NULL DEFAULT '0',
  `SaveAllowNightly` tinyint(1) NOT NULL DEFAULT '0',
  `Status` varchar(20) NOT NULL DEFAULT 'QUEUED',
  `Stage` varchar(100) DEFAULT NULL,
  `ClubsDone` int NOT NULL DEFAULT '0',
  `ClubsTotal` int NOT NULL DEFAULT '0',
  `RowsWritten` int NOT NULL DEFAULT '0',
  `ErrorMessage` varchar(1000) DEFAULT NULL,
  `StartedAt` datetime DEFAULT NULL,
  `FinishedAt` datetime DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `ix_rosr_status` (`Status`,`pk_id`),
  KEY `ix_rosr_district` (`fk_district_id`,`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
;

CREATE TABLE IF NOT EXISTS `year_rule_messages` (
  `pk_year_rule_message_id` int NOT NULL AUTO_INCREMENT,
  `MessageKey` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Template` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_year_rule_message_id`),
  UNIQUE KEY `uq_year_rule_message` (`MessageKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

CREATE TABLE IF NOT EXISTS `year_rule_scope_settings` (
  `pk_year_rule_setting_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL DEFAULT '0',
  `fk_club_id` int NOT NULL DEFAULT '0',
  `IsEnabled` tinyint(1) NOT NULL,
  `Notes` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_year_rule_setting_id`),
  UNIQUE KEY `uq_year_rule_scope` (`fk_district_id`,`fk_club_id`),
  KEY `idx_yrs_district` (`fk_district_id`,`isdeleted`),
  KEY `idx_yrs_club` (`fk_club_id`,`isdeleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
;

-- Platform default for the year rule: OFF until a SuperAdmin switches it on (same row the API seeds).
INSERT IGNORE INTO year_rule_scope_settings (pk_year_rule_setting_id, fk_district_id, fk_club_id, IsEnabled, Notes, created_date, isdeleted) VALUES (1, 0, 0, 0, 'Platform default (off until SuperAdmin switches it on)', UTC_TIMESTAMP(), 0);
INSERT  IGNORE INTO `year_rule_messages` VALUES (1,'current_year_only','View only: Only an admin for the current year ({currentYear}) can {actions}.',NULL,'2026-11-09 12:12:01',NULL,NULL,0);
INSERT  IGNORE INTO `year_rule_messages` VALUES (2,'wrong_year_with_years','View only: you are not an admin for {year}, so you cannot add, edit or delete these records. You can make changes in {years}.',NULL,'2026-11-09 12:12:01',NULL,NULL,0);
INSERT  IGNORE INTO `year_rule_messages` VALUES (3,'wrong_year_no_years','View only: you are not an admin for {year}, so you cannot add, edit or delete these records.',NULL,'2026-11-09 12:12:01',NULL,NULL,0);
INSERT  IGNORE INTO `year_rule_messages` VALUES (4,'default_actions','add, edit or delete it',NULL,'2026-11-09 12:12:01',NULL,NULL,0);
