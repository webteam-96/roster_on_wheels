
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `announcement_push_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_announcement_id` int NOT NULL,
  `fk_member_master_profile_id` int NOT NULL,
  `FcmToken` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FirebaseMessageId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ErrorMessage` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SentAt` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `idx_announcement` (`fk_announcement_id`),
  KEY `idx_member_status` (`fk_member_master_profile_id`,`Status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `announcement_reminder_push_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_reminder_id` int NOT NULL,
  `fk_announcement_id` int NOT NULL,
  `fk_member_master_profile_id` int NOT NULL,
  `FcmToken` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FirebaseMessageId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ErrorMessage` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SentAt` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `idx_reminder` (`fk_reminder_id`),
  KEY `idx_member_status` (`fk_member_master_profile_id`,`Status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `announcement_reminders` (
  `pk_reminder_id` int NOT NULL AUTO_INCREMENT,
  `fk_announcement_id` int NOT NULL,
  `ReminderDateTime` datetime NOT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `PushSentAt` datetime DEFAULT NULL,
  `WhatsAppSentDate` datetime DEFAULT NULL,
  `WhatsAppSentCount` int NOT NULL DEFAULT '0',
  `WhatsAppFailedCount` int NOT NULL DEFAULT '0',
  `EmailSentDate` datetime DEFAULT NULL,
  `EmailSentCount` int NOT NULL DEFAULT '0',
  `EmailFailedCount` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_reminder_id`),
  KEY `fk_announcement_id` (`fk_announcement_id`),
  CONSTRAINT `announcement_reminders_ibfk_1` FOREIGN KEY (`fk_announcement_id`) REFERENCES `announcements` (`pk_announcement_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `announcements` (
  `pk_announcement_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int DEFAULT NULL,
  `fk_club_id` int NOT NULL,
  `Title` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ImagePath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PublishDateTime` datetime NOT NULL,
  `ExpiryDateTime` datetime NOT NULL,
  `IsDisplayOnBanner` tinyint(1) DEFAULT '0',
  `IsSendWhatsapp` tinyint(1) DEFAULT '0',
  `IsRepeatNotification` tinyint(1) DEFAULT '0',
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'Unpublished',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `PushNotificationSent` tinyint(1) DEFAULT '0',
  `PushNotificationSentAt` datetime DEFAULT NULL,
  `Scope` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'district',
  `RecipientTarget` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RecipientZoneIds` text COLLATE utf8mb4_unicode_ci,
  `RecipientDistrictIds` text COLLATE utf8mb4_unicode_ci,
  `RecipientSubgroupIds` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `WhatsAppSentDate` datetime DEFAULT NULL,
  `WhatsAppSentCount` int NOT NULL DEFAULT '0',
  `WhatsAppFailedCount` int NOT NULL DEFAULT '0',
  `IsSendEmail` tinyint(1) NOT NULL DEFAULT '0',
  `EmailSentDate` datetime DEFAULT NULL,
  `EmailSentCount` int NOT NULL DEFAULT '0',
  `EmailFailedCount` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_announcement_id`),
  KEY `fk_club_id` (`fk_club_id`),
  KEY `idx_ann_wa_pending` (`IsSendWhatsapp`,`WhatsAppSentDate`,`PublishDateTime`),
  KEY `idx_ann_email_pending` (`IsSendEmail`,`EmailSentDate`,`PublishDateTime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `area_of_focus_master` (
  `pk_area_of_focus_id` int NOT NULL AUTO_INCREMENT,
  `fk_module_id` int DEFAULT NULL,
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `image_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_area_of_focus_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_log` (
  `pk_audit_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_member_master_profile_id` int DEFAULT NULL,
  `member_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` int DEFAULT NULL,
  `entity_name` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `details` text COLLATE utf8mb4_unicode_ci,
  `ip_address` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_audit_id`),
  KEY `idx_audit_member` (`fk_member_master_profile_id`),
  KEY `idx_audit_entity` (`entity_type`,`entity_id`),
  KEY `idx_audit_date` (`created_date`),
  KEY `idx_audit_action` (`action`),
  KEY `idx_audit_entity_type` (`entity_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `beneficiary_approval_requests` (
  `pk_approval_id` int NOT NULL AUTO_INCREMENT,
  `fk_project_id` int NOT NULL,
  `fk_zone_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `requested_beneficiaries` int NOT NULL,
  `approved_beneficiaries` int DEFAULT NULL,
  `current_limit` int NOT NULL,
  `approval_token` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `remark` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `requested_by` int NOT NULL,
  `responded_by` int DEFAULT NULL,
  `responded_date` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_approval_id`),
  UNIQUE KEY `approval_token` (`approval_token`),
  KEY `fk_zone_id` (`fk_zone_id`),
  KEY `fk_club_id` (`fk_club_id`),
  KEY `idx_approval_token` (`approval_token`),
  KEY `idx_approval_project` (`fk_project_id`),
  KEY `idx_approval_status` (`status`),
  CONSTRAINT `beneficiary_approval_requests_ibfk_1` FOREIGN KEY (`fk_zone_id`) REFERENCES `zone_master` (`pk_zone_id`),
  CONSTRAINT `beneficiary_approval_requests_ibfk_2` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `board_of_directors` (
  `pk_board_director_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_member_master_profile_id` int DEFAULT NULL,
  `non_member_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `non_member_mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `non_member_email` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_designation_id` int NOT NULL,
  `custom_designation` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_year_id` int NOT NULL,
  `sort_order` int DEFAULT NULL,
  `SyncSource` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT 'Manual',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_board_director_id`),
  KEY `fk_member_master_profile_id` (`fk_member_master_profile_id`),
  KEY `fk_designation_id` (`fk_designation_id`),
  KEY `fk_year_id` (`fk_year_id`),
  KEY `idx_bod_club_year_active` (`fk_club_id`,`fk_year_id`,`isdeleted`,`sort_order`),
  CONSTRAINT `board_of_directors_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`),
  CONSTRAINT `board_of_directors_ibfk_2` FOREIGN KEY (`fk_member_master_profile_id`) REFERENCES `member_master_profile` (`pk_member_master_profile_id`),
  CONSTRAINT `board_of_directors_ibfk_3` FOREIGN KEY (`fk_designation_id`) REFERENCES `designation_master` (`pk_designation_id`),
  CONSTRAINT `board_of_directors_ibfk_4` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cashfree_kyc` (
  `pk_kyc_id` int NOT NULL AUTO_INCREMENT,
  `vendor_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_holder` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_number` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ifsc` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pan` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'PENDING',
  `verify_account` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT 'true',
  `dashboard_access` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT 'true',
  `schedule_option` int DEFAULT '2',
  `account_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Current',
  `business_type` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'Non Profit/NGO',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `Defualt_per` decimal(5,2) DEFAULT '0.00',
  PRIMARY KEY (`pk_kyc_id`),
  UNIQUE KEY `vendor_id` (`vendor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cashfree_otp` (
  `pk_otp_id` int NOT NULL AUTO_INCREMENT,
  `otp_code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `purpose` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'CASHFREE_KYC',
  `is_used` tinyint(1) DEFAULT '0',
  `expiry_date` datetime NOT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_otp_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `category_master` (
  `pk_category_id` int NOT NULL AUTO_INCREMENT,
  `fk_area_of_focus_id` int NOT NULL,
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_category_id`),
  KEY `fk_area_of_focus_id` (`fk_area_of_focus_id`),
  CONSTRAINT `category_master_ibfk_1` FOREIGN KEY (`fk_area_of_focus_id`) REFERENCES `area_of_focus_master` (`pk_area_of_focus_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_attendance` (
  `pk_attendance_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `EventName` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(10000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EventDateTime` datetime NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_attendance_id`),
  KEY `fk_club_id` (`fk_club_id`),
  CONSTRAINT `club_attendance_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_attendance_annets` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_attendance_id` int NOT NULL,
  `AnnetName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `fk_attendance_id` (`fk_attendance_id`),
  CONSTRAINT `club_attendance_annets_ibfk_1` FOREIGN KEY (`fk_attendance_id`) REFERENCES `club_attendance` (`pk_attendance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_attendance_anns` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_attendance_id` int NOT NULL,
  `AnnName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `fk_attendance_id` (`fk_attendance_id`),
  CONSTRAINT `club_attendance_anns_ibfk_1` FOREIGN KEY (`fk_attendance_id`) REFERENCES `club_attendance` (`pk_attendance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_attendance_delegates` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_attendance_id` int NOT NULL,
  `RotarianName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `DistrictDesignation` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ClubName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `fk_attendance_id` (`fk_attendance_id`),
  CONSTRAINT `club_attendance_delegates_ibfk_1` FOREIGN KEY (`fk_attendance_id`) REFERENCES `club_attendance` (`pk_attendance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_attendance_members` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_attendance_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `fk_attendance_id` (`fk_attendance_id`),
  CONSTRAINT `club_attendance_members_ibfk_1` FOREIGN KEY (`fk_attendance_id`) REFERENCES `club_attendance` (`pk_attendance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_attendance_rotarians` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_attendance_id` int NOT NULL,
  `RotarianName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ClubName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `fk_attendance_id` (`fk_attendance_id`),
  CONSTRAINT `club_attendance_rotarians_ibfk_1` FOREIGN KEY (`fk_attendance_id`) REFERENCES `club_attendance` (`pk_attendance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_attendance_visitors` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_attendance_id` int NOT NULL,
  `VisitorName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `InvitedBy` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `fk_attendance_id` (`fk_attendance_id`),
  CONSTRAINT `club_attendance_visitors_ibfk_1` FOREIGN KEY (`fk_attendance_id`) REFERENCES `club_attendance` (`pk_attendance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_award_status` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `on_track` tinyint(1) DEFAULT '0',
  `achieved` tinyint(1) DEFAULT '0',
  `presidential_citation_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `district_citation_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `membership_excellence_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_club_year` (`fk_club_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_credit_offline_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_credit_id` int NOT NULL,
  `fk_district_id` int NOT NULL,
  `fk_club_id` int NOT NULL DEFAULT '0',
  `CreditType` varchar(20) NOT NULL,
  `EntryType` varchar(20) NOT NULL,
  `CreditCount` int DEFAULT NULL,
  `CountBefore` int DEFAULT NULL,
  `CountAfter` int DEFAULT NULL,
  `ToDate` date DEFAULT NULL,
  `TransactionId` varchar(200) DEFAULT NULL,
  `PaymentDate` date DEFAULT NULL,
  `ProofDocumentPath` varchar(500) DEFAULT NULL,
  `Note` varchar(300) DEFAULT NULL,
  `created_by` int NOT NULL DEFAULT '0',
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `ix_ccol_scope` (`fk_district_id`,`fk_club_id`,`CreditType`),
  KEY `ix_ccol_credit` (`fk_credit_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_credit_usage_history` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_district_id` int DEFAULT NULL,
  `CreditType` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `DeductedCount` int NOT NULL DEFAULT '0',
  `Source` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `SourceId` int DEFAULT NULL,
  `SourceDetail` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BalanceBefore` int NOT NULL DEFAULT '0',
  `BalanceAfter` int NOT NULL DEFAULT '0',
  `created_by` int DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_credits` (
  `pk_credit_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `CreditType` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `CreditCount` int NOT NULL DEFAULT '0',
  `UsedCount` int NOT NULL DEFAULT '0',
  `FromDate` date NOT NULL,
  `ToDate` date NOT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) DEFAULT '0',
  `TransactionId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PaymentDate` date DEFAULT NULL,
  `ProofDocumentPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PreviousCount` int DEFAULT '0',
  PRIMARY KEY (`pk_credit_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_documents` (
  `pk_document_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int DEFAULT NULL,
  `fk_club_id` int NOT NULL,
  `Title` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `AccessType` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'downloadable',
  `FilePath` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `OriginalFileName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PublishDateTime` datetime NOT NULL,
  `ExpiryDateTime` datetime NOT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'Unpublished',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `PushNotificationSent` tinyint(1) DEFAULT '0',
  `PushNotificationSentAt` datetime DEFAULT NULL,
  `Scope` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'district',
  `RecipientTarget` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RecipientZoneIds` text COLLATE utf8mb4_unicode_ci,
  `RecipientDistrictIds` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk_document_id`),
  KEY `fk_club_id` (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_dues` (
  `pk_club_dues_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `RotaryYear` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Purpose` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PurposeDescription` text COLLATE utf8mb4_unicode_ci,
  `PurposeLogo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BackgroundImage` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailHeaderLogo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `DefaultPerMemberRate` decimal(12,2) NOT NULL DEFAULT '0.00',
  `AmountType` int NOT NULL DEFAULT '1',
  `DefaultPercentage` decimal(5,2) DEFAULT '2.95',
  `OnlineSurchargePercent` decimal(5,2) NOT NULL DEFAULT '0.00',
  `RateModel` tinyint(1) NOT NULL DEFAULT '0',
  `OnlinePerMemberRate` decimal(12,2) NOT NULL DEFAULT '0.00',
  `OfflinePerMemberRate` decimal(12,2) NOT NULL DEFAULT '0.00',
  `ModeOfPayment` int DEFAULT '3',
  `IsShowBankInReceipt` tinyint(1) DEFAULT '0',
  `OfflineBankName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineAccountNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineIfscCode` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ApproverEmail` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailCC` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailSubject` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailBody` text COLLATE utf8mb4_unicode_ci,
  `EmailReminderSubject` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailReminderBody` text COLLATE utf8mb4_unicode_ci,
  `ReminderButtonText` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `GoogleSheetId` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `GoogleSheetUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `GoogleSheetEmail` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `WeblinkUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_weblink_id` int DEFAULT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_club_dues_id`),
  UNIQUE KEY `uk_club_dues_district_year` (`fk_district_id`,`RotaryYear`,`isdeleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_dues_club_vendors` (
  `pk_club_dues_club_vendor_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_dues_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `fk_club_dues_club_id` int DEFAULT NULL,
  `fk_route_account_id` int NOT NULL,
  `IsOnline` tinyint(1) NOT NULL DEFAULT '1',
  `AccountId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SplitAmount` decimal(12,2) DEFAULT '0.00',
  `SplitPercentage` decimal(5,2) DEFAULT '0.00',
  `IsSelf` tinyint(1) DEFAULT '0',
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_club_dues_club_vendor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_dues_clubs` (
  `pk_club_dues_club_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_dues_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `PerMemberRate` decimal(12,2) NOT NULL DEFAULT '0.00',
  `OnlinePerMemberRate` decimal(12,2) NOT NULL DEFAULT '0.00',
  `OfflinePerMemberRate` decimal(12,2) NOT NULL DEFAULT '0.00',
  `MemberCountCached` int DEFAULT '0',
  `PaidMemberCountCached` int DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_club_dues_club_id`),
  UNIQUE KEY `uk_club_dues_club` (`fk_club_dues_id`,`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_dues_members` (
  `pk_club_dues_member_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_dues_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `fk_member_profile_id` int NOT NULL,
  `IsHonorary` tinyint(1) DEFAULT '0',
  `Rate` decimal(12,2) DEFAULT '0.00',
  `IsPaid` tinyint(1) DEFAULT '0',
  `fk_payment_id` int DEFAULT NULL,
  `PaidDate` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_club_dues_member_id`),
  UNIQUE KEY `uk_club_dues_member` (`fk_club_dues_id`,`fk_club_id`,`fk_member_profile_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_dues_payments` (
  `pk_club_dues_payment_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_dues_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `Amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `MemberCountCovered` int DEFAULT '0',
  `PaidByMemberId` int DEFAULT NULL,
  `PaidByRole` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsPaid` tinyint(1) DEFAULT '0',
  `IsOnline` tinyint(1) DEFAULT '1',
  `PaymentStatus` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT 'Pending',
  `PaidSource` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PaymentDate` datetime DEFAULT NULL,
  `TransactionId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RazorpayOrderId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RazorpayPaymentId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RazorpaySignature` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OrderSplitsJson` text COLLATE utf8mb4_unicode_ci,
  `IsWebhookReceived` tinyint(1) DEFAULT '0',
  `WebhookReceivedDate` datetime DEFAULT NULL,
  `OfflineTransactionType` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineTransactionId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineGivenTo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineBankName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FkRouteAccountId` int DEFAULT NULL,
  `OfflineChequeNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineRemark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Attachment` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineStatus` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RejectionReason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ApprovedBy` int DEFAULT NULL,
  `ApprovedDate` datetime DEFAULT NULL,
  `RejectedBy` int DEFAULT NULL,
  `RejectedDate` datetime DEFAULT NULL,
  `ApprovalRemark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ApprovalSource` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RejectionSource` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsReceiptSent` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_club_dues_payment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_dues_settlements` (
  `pk_club_dues_settlement_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_dues_id` int NOT NULL,
  `fk_payment_id` int NOT NULL,
  `RazorpayOrderId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AccountId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Amount` decimal(12,2) DEFAULT '0.00',
  `SettlementStatus` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SettlementId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SettlementUtr` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SettlementTime` datetime DEFAULT NULL,
  `ServiceCharge` decimal(12,2) DEFAULT '0.00',
  `ServiceTax` decimal(12,2) DEFAULT '0.00',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_club_dues_settlement_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_dues_vendors` (
  `pk_club_dues_vendor_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_dues_id` int NOT NULL,
  `fk_route_account_id` int NOT NULL,
  `IsOnline` tinyint(1) NOT NULL DEFAULT '1',
  `AccountId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SplitAmount` decimal(12,2) DEFAULT '0.00',
  `SplitPercentage` decimal(5,2) DEFAULT '0.00',
  `IsDefault` tinyint(1) DEFAULT '0',
  `IsSelf` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_club_dues_vendor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_foundation_collection_goals` (
  `pk_goal_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `apf_goal_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `polio_plus_goal_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `endowment_fund_goal_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `other_goal_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USD',
  `remarks` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_goal_id`),
  UNIQUE KEY `uk_fgoal_club_year_active` (`fk_club_id`,`fk_year_id`,`isdeleted`),
  KEY `idx_fgoal_club_year` (`fk_club_id`,`fk_year_id`,`isdeleted`),
  KEY `fk_year_id` (`fk_year_id`),
  CONSTRAINT `club_foundation_collection_goals_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`),
  CONSTRAINT `club_foundation_collection_goals_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_leadership_email_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_schedule_id` int NOT NULL,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `DesignationName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Email` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'Pending',
  `SentDate` datetime DEFAULT NULL,
  `ErrorMessage` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `fk_schedule_id` (`fk_schedule_id`),
  CONSTRAINT `club_leadership_email_log_ibfk_1` FOREIGN KEY (`fk_schedule_id`) REFERENCES `club_leadership_email_schedule` (`pk_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_leadership_email_schedule` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `ScheduleDateTime` datetime NOT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'Pending',
  `TotalRecipients` int DEFAULT '0',
  `SentCount` int DEFAULT '0',
  `FailedCount` int DEFAULT '0',
  `ProcessedDate` datetime DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_mass_email_recipients` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_mass_email_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `MemberName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Email` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'Pending',
  `SentDate` datetime DEFAULT NULL,
  `ErrorMessage` text COLLATE utf8mb4_unicode_ci,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_mass_emails` (
  `pk_mass_email_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_district_id` int DEFAULT NULL,
  `RecipientType` int NOT NULL DEFAULT '1',
  `fk_subgroup_id` int DEFAULT NULL,
  `FromName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ReplyName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ReplyEmail` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Subject` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `EmailBody` mediumtext COLLATE utf8mb4_unicode_ci,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Draft',
  `TotalRecipients` int DEFAULT '0',
  `SentCount` int DEFAULT '0',
  `FailedCount` int DEFAULT '0',
  `SentDate` datetime DEFAULT NULL,
  `created_by` int DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) DEFAULT '0',
  `Scope` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'district',
  `RecipientTarget` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RecipientZoneIds` text COLLATE utf8mb4_unicode_ci,
  `RecipientDistrictIds` text COLLATE utf8mb4_unicode_ci,
  `RecipientSubgroupIds` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_mass_email_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_master` (
  `pk_club_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `ClubRotaryId` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ClubName` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Timezone` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'UTC',
  `ClubCharterDate` date DEFAULT NULL,
  `ClubLogoPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ClubWebsite` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MeetingDay` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MeetingFromTime` time DEFAULT NULL,
  `MeetingToTime` time DEFAULT NULL,
  `MeetingAddress` text COLLATE utf8mb4_unicode_ci,
  `Country` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'India',
  `State` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `City` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Pincode` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ActiveFromDate` date DEFAULT NULL,
  `ActiveToDate` date DEFAULT NULL,
  `IsAutomaticMeetingReminder` tinyint(1) DEFAULT '1',
  `IsFamilyLogin` tinyint(1) DEFAULT '0',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `Is_healthy_club` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ClubType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BirthdayGreeting` varchar(700) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsEnableBirthdayNotification` tinyint(1) DEFAULT '0',
  `AnniversaryGreeting` varchar(700) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsEnableAnniversaryNotification` tinyint(1) DEFAULT '0',
  `IsGreetingSendWhatsapp` tinyint(1) DEFAULT '0',
  `IsGreetingSendEmail` tinyint(1) DEFAULT '0',
  `IsEnableBirthdayEmail` tinyint(1) DEFAULT '0',
  `BirthdayEmailFrom` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BirthdayEmailSubject` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BirthdayEmailMessage` text COLLATE utf8mb4_unicode_ci,
  `IsEnableAnniversaryEmail` tinyint(1) DEFAULT '0',
  `AnniversaryEmailFrom` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AnniversaryEmailSubject` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AnniversaryEmailMessage` text COLLATE utf8mb4_unicode_ci,
  `GreetingReviewedYearId` int DEFAULT NULL,
  `Latitude` decimal(10,7) DEFAULT NULL,
  `Longitude` decimal(10,7) DEFAULT NULL,
  `ROW_as_vendor_selected` tinyint(1) DEFAULT '0',
  `IsSyncedFromRotaryOrg` tinyint(1) DEFAULT '0',
  `LastSyncedFromRotaryOrg` datetime DEFAULT NULL,
  `RotaryOrgAddressLastUpdatedIst` datetime DEFAULT NULL,
  `ClubEmail` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AddedByCountrySync` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_club_id`),
  UNIQUE KEY `ClubRotaryId` (`ClubRotaryId`),
  KEY `idx_club_active` (`isdeleted`,`IsActive`),
  KEY `idx_club_district` (`fk_district_id`,`isdeleted`),
  CONSTRAINT `club_master_ibfk_1` FOREIGN KEY (`fk_district_id`) REFERENCES `district_master` (`pk_district_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_prevent_hard_delete_club` BEFORE DELETE ON `club_master` FOR EACH ROW BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_members` (
  `pk_club_member_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_member_master_profile_id` int NOT NULL,
  `JoinedDate` date DEFAULT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `TerminationDate` date DEFAULT NULL,
  `TerminationReason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Designation` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ClassificationProfession` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsHonoraryMember` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_club_member_id`),
  UNIQUE KEY `uk_club_member` (`fk_club_id`,`fk_member_master_profile_id`),
  KEY `idx_club_members_club` (`fk_club_id`,`isdeleted`),
  KEY `idx_club_members_member` (`fk_member_master_profile_id`,`isdeleted`),
  CONSTRAINT `club_members_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`),
  CONSTRAINT `club_members_ibfk_2` FOREIGN KEY (`fk_member_master_profile_id`) REFERENCES `member_master_profile` (`pk_member_master_profile_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_prevent_hard_delete_club_member` BEFORE DELETE ON `club_members` FOR EACH ROW BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_modules` (
  `pk_club_module_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_module_id` int NOT NULL,
  `IsEnabled` tinyint(1) DEFAULT '1',
  `AssignedBy` int DEFAULT NULL,
  `AssignedDate` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_club_module_id`),
  UNIQUE KEY `uk_club_module` (`fk_club_id`,`fk_module_id`),
  KEY `fk_module_id` (`fk_module_id`),
  CONSTRAINT `club_modules_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`),
  CONSTRAINT `club_modules_ibfk_2` FOREIGN KEY (`fk_module_id`) REFERENCES `module_master` (`pk_module_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_monthly_reports` (
  `pk_report_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `ReportMonth` int NOT NULL,
  `MemberCountLastMonth` int DEFAULT '0',
  `MembersDeleted` int DEFAULT '0',
  `MembersAdded` int DEFAULT '0',
  `CurrentMemberCount` int DEFAULT '0',
  `AdditionalRemarks` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsUploadedToDistrict` tinyint(1) DEFAULT '0',
  `uploaded_to_district_date` datetime DEFAULT NULL,
  `fk_ag_member_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) DEFAULT '0',
  `report_snapshot_json` mediumtext COLLATE utf8mb4_unicode_ci,
  `snapshot_captured_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_report_id`),
  UNIQUE KEY `uk_club_year_month` (`fk_club_id`,`fk_year_id`,`ReportMonth`),
  KEY `fk_year_id` (`fk_year_id`),
  CONSTRAINT `club_monthly_reports_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`),
  CONSTRAINT `club_monthly_reports_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_myrotary_tracking` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `registered_members` int DEFAULT '0',
  `total_members` int DEFAULT '0',
  `registration_percentage` decimal(5,2) DEFAULT '0.00',
  `last_synced` datetime DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_club_year` (`fk_club_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_rotary_org_credentials` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `RotaryOrgUsernameEncrypted` text NOT NULL,
  `RotaryOrgPasswordEncrypted` text NOT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `ux_crc_club` (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_website_about` (
  `pk_club_website_about_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `content` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `fk_district_id` int DEFAULT NULL,
  PRIMARY KEY (`pk_club_website_about_id`),
  KEY `idx_about_club` (`fk_club_id`,`fk_district_id`,`isdeleted`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_website_advertisement` (
  `pk_club_website_advertisement_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `advertisement_image_path` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `document_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `fk_district_id` int DEFAULT NULL,
  PRIMARY KEY (`pk_club_website_advertisement_id`),
  KEY `fk_year_id` (`fk_year_id`),
  KEY `idx_ad_club_year` (`fk_club_id`,`fk_year_id`,`isdeleted`,`is_active`,`sort_order`),
  CONSTRAINT `club_website_advertisement_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_website_banner` (
  `pk_club_website_banner_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `banner_image_path` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `fk_district_id` int DEFAULT NULL,
  PRIMARY KEY (`pk_club_website_banner_id`),
  KEY `fk_year_id` (`fk_year_id`),
  KEY `idx_banner_club_year` (`fk_club_id`,`fk_year_id`,`isdeleted`,`is_active`,`sort_order`),
  CONSTRAINT `club_website_banner_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_website_contact_detail` (
  `pk_club_website_contact_detail_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `email` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `fk_district_id` int DEFAULT NULL,
  PRIMARY KEY (`pk_club_website_contact_detail_id`),
  KEY `fk_year_id` (`fk_year_id`),
  KEY `idx_contact_club_year` (`fk_club_id`,`fk_year_id`,`isdeleted`,`is_active`,`sort_order`),
  CONSTRAINT `club_website_contact_detail_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_website_logs` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_website_id` int NOT NULL,
  `Action` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Details` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PerformedBy` int DEFAULT NULL,
  `PerformedDate` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `fk_website_id` (`fk_website_id`),
  CONSTRAINT `club_website_logs_ibfk_1` FOREIGN KEY (`fk_website_id`) REFERENCES `club_websites` (`pk_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_website_menu` (
  `pk_club_website_menu_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `menu_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `link_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'page',
  `link_value` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `fk_district_id` int DEFAULT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `content_html` longtext COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk_club_website_menu_id`),
  KEY `idx_menu_club_active` (`fk_club_id`,`isdeleted`,`is_active`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_website_orders` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_district_id` int NOT NULL DEFAULT '0',
  `OrderType` varchar(20) NOT NULL,
  `Subdomain` varchar(100) NOT NULL,
  `fk_theme_id` int DEFAULT NULL,
  `ReminderDays` int DEFAULT NULL,
  `ValidityMonths` int NOT NULL DEFAULT '12',
  `BaseAmount` decimal(12,2) NOT NULL,
  `GstAmount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `TotalAmount` decimal(12,2) NOT NULL,
  `Currency` varchar(10) NOT NULL DEFAULT 'INR',
  `GatewayType` varchar(20) DEFAULT NULL,
  `fk_route_account_id` int DEFAULT NULL,
  `StartDate` date DEFAULT NULL,
  `EndDate` date DEFAULT NULL,
  `RazorpayOrderId` varchar(100) DEFAULT NULL,
  `RazorpayPaymentId` varchar(100) DEFAULT NULL,
  `RazorpaySignature` varchar(255) DEFAULT NULL,
  `PaymentStatus` varchar(30) NOT NULL DEFAULT 'CREATED',
  `IsProvisioned` tinyint(1) NOT NULL DEFAULT '0',
  `ProvisionedDate` datetime DEFAULT NULL,
  `ProvisionStatus` varchar(30) DEFAULT NULL,
  `IsWebhookReceived` tinyint(1) NOT NULL DEFAULT '0',
  `WebhookReceivedDate` datetime DEFAULT NULL,
  `fk_website_id` int DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `ux_cwo_rzp_order` (`RazorpayOrderId`),
  KEY `ix_cwo_club` (`fk_club_id`),
  KEY `ix_cwo_subdomain` (`Subdomain`,`IsProvisioned`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_website_pricing` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `BaseAmount` decimal(12,2) NOT NULL,
  `RenewalAmount` decimal(12,2) DEFAULT NULL,
  `GstPercent` decimal(5,2) NOT NULL DEFAULT '18.00',
  `GatewayType` varchar(20) NOT NULL DEFAULT 'normal',
  `fk_route_account_id` int DEFAULT NULL,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `ux_cwp_club_year` (`fk_club_id`,`fk_year_id`),
  KEY `ix_cwp_year` (`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_website_social_link` (
  `pk_club_website_social_link_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `platform` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `link_url` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `fk_district_id` int DEFAULT NULL,
  PRIMARY KEY (`pk_club_website_social_link_id`),
  KEY `idx_social_club` (`fk_club_id`,`fk_district_id`,`isdeleted`,`is_active`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_website_submenu` (
  `pk_club_website_submenu_id` int NOT NULL AUTO_INCREMENT,
  `fk_menu_id` int NOT NULL,
  `submenu_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `link_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'page',
  `link_value` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `is_system_managed` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_club_website_submenu_id`),
  KEY `idx_submenu_menu_active` (`fk_menu_id`,`isdeleted`,`is_active`,`sort_order`),
  CONSTRAINT `club_website_submenu_ibfk_1` FOREIGN KEY (`fk_menu_id`) REFERENCES `club_website_menu` (`pk_club_website_menu_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_website_theme` (
  `pk_club_website_theme_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_theme_id` int NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_club_website_theme_id`),
  UNIQUE KEY `uk_club_year` (`fk_club_id`,`fk_year_id`),
  KEY `fk_year_id` (`fk_year_id`),
  KEY `fk_theme_id` (`fk_theme_id`),
  CONSTRAINT `club_website_theme_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`),
  CONSTRAINT `club_website_theme_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`),
  CONSTRAINT `club_website_theme_ibfk_3` FOREIGN KEY (`fk_theme_id`) REFERENCES `theme_master` (`pk_theme_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `club_websites` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `Subdomain` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ClientDomain` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ClientDomainVerifiedDate` datetime DEFAULT NULL,
  `ClientDomainProvisioned` tinyint(1) NOT NULL DEFAULT '0',
  `fk_theme_id` int DEFAULT NULL,
  `StartDate` date NOT NULL,
  `EndDate` date NOT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'Inactive',
  `IsPurchased` tinyint(1) NOT NULL DEFAULT '0',
  `ReminderDays` int DEFAULT NULL,
  `AmountPaid` decimal(15,2) DEFAULT NULL,
  `TransactionId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PaymentDate` date DEFAULT NULL,
  `PaymentMode` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PaymentProofPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LastReminderSent` datetime DEFAULT NULL,
  `Notes` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_subdomain` (`Subdomain`),
  KEY `idx_cw_client_domain` (`ClientDomain`,`isdeleted`),
  KEY `idx_cw_club_active` (`fk_club_id`,`isdeleted`,`Status`),
  CONSTRAINT `club_websites_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `country_master` (
  `pk_country_id` int NOT NULL AUTO_INCREMENT,
  `CountryName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `CountryCode` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `PhoneCode` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `GmtOpt` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `GmtTime` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `Ordering` int DEFAULT '999',
  `isdeleted` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_country_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `designation_master` (
  `pk_designation_id` int NOT NULL AUTO_INCREMENT,
  `designation_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_designation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `directory_data_member_status` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_config_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `SpouseNotApplicable` tinyint(1) NOT NULL DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_ddms_config_member` (`fk_config_id`,`fk_member_id`),
  KEY `idx_ddms_member` (`fk_member_id`),
  CONSTRAINT `directory_data_member_status_ibfk_1` FOREIGN KEY (`fk_config_id`) REFERENCES `district_directory_config` (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_ag` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ag_club_year` (`fk_club_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_awards_config` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uq_district_awards_cfg` (`fk_district_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_citation_activity_master` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `activity_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sub_type` int DEFAULT '0',
  `sort_order` int DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_citation_auto_question` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_category_id` int NOT NULL,
  `fk_activity_id` int NOT NULL,
  `points` decimal(10,2) DEFAULT '0.00',
  `is_bonus` tinyint(1) DEFAULT '0',
  `bonus_points` decimal(10,2) DEFAULT '0.00',
  `min_bonus` int DEFAULT '0',
  `max_bonus` int DEFAULT '0',
  `sort_order` int DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_citation_auto_question_sub` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_auto_question_id` int NOT NULL,
  `sub_item_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sub_item_id` int DEFAULT NULL,
  `sub_item_name` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `filter_aof_id` int DEFAULT NULL,
  `filter_cat_id` int DEFAULT NULL,
  `points` decimal(10,2) DEFAULT '0.00',
  `is_bonus` tinyint(1) DEFAULT '0',
  `bonus_points` decimal(10,2) DEFAULT '0.00',
  `min_bonus` int DEFAULT '0',
  `max_bonus` int DEFAULT '0',
  `sort_order` int DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_citation_category` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `category_name` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_citation_club_entry` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `entry_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_question_id` int NOT NULL,
  `fk_sub_question_id` int DEFAULT NULL,
  `answer_value` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `points_earned` decimal(10,2) DEFAULT '0.00',
  `bonus_earned` decimal(10,2) DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_citation_club_entry_backup` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `batch_id` varchar(48) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `entry_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_question_id` int NOT NULL,
  `fk_sub_question_id` int DEFAULT NULL,
  `answer_value` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `points_earned` decimal(10,2) DEFAULT '0.00',
  `bonus_earned` decimal(10,2) DEFAULT '0.00',
  `orig_created_by` int DEFAULT NULL,
  `orig_created_date` datetime DEFAULT NULL,
  `cleared_by` int DEFAULT NULL,
  `cleared_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `restored` tinyint(1) DEFAULT '0',
  `restored_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `idx_batch` (`fk_district_id`,`fk_year_id`,`batch_id`),
  KEY `idx_lookup` (`fk_district_id`,`fk_year_id`,`restored`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_citation_description` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `description_html` longtext COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_district_year_desc` (`fk_district_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_citation_manual_criteria` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_category_id` int NOT NULL,
  `criteria_name` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_citation_manual_sub_criteria` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_criteria_id` int NOT NULL,
  `sub_criteria_title` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `answer_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'number',
  `points` decimal(10,2) DEFAULT '0.00',
  `is_bonus` tinyint(1) DEFAULT '0',
  `bonus_points` decimal(10,2) DEFAULT '0.00',
  `min_bonus` int DEFAULT '0',
  `max_bonus` int DEFAULT '0',
  `remark` text COLLATE utf8mb4_unicode_ci,
  `sort_order` int DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_citation_manual_sub_criteria_option` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_sub_criteria_id` int NOT NULL,
  `option_text` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `option_points` decimal(10,2) DEFAULT '0.00',
  `sort_order` int DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_club_moderator` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_club_moderator` (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_committee_group` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `group_name` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_committee_group_member` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fk_group_id` int NOT NULL,
  `fk_member_id` int DEFAULT NULL,
  `is_member` tinyint(1) DEFAULT '1',
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `district_designation` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_club_id` int DEFAULT NULL,
  `club_name` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `district_remark` text COLLATE utf8mb4_unicode_ci,
  `profile_photo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_dcgm_member` (`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_committee_member` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_member_id` int DEFAULT NULL,
  `is_member` tinyint(1) DEFAULT '1',
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `district_designation` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_club_id` int DEFAULT NULL,
  `club_name` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `district_remark` text COLLATE utf8mb4_unicode_ci,
  `profile_photo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_committee_sub_group` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fk_group_id` int NOT NULL,
  `sub_group_name` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_committee_sub_group_member` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fk_sub_group_id` int NOT NULL,
  `fk_member_id` int DEFAULT NULL,
  `is_member` tinyint(1) DEFAULT '1',
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `district_designation` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_club_id` int DEFAULT NULL,
  `club_name` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `district_remark` text COLLATE utf8mb4_unicode_ci,
  `profile_photo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_directory_config` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `UrlHash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FirstContactName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FirstContactMobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FirstContactPasswordHash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SecondContactName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SecondContactMobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SecondContactPasswordHash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `DcFieldsJson` mediumtext COLLATE utf8mb4_unicode_ci,
  `BodFieldsJson` mediumtext COLLATE utf8mb4_unicode_ci,
  `MemberFieldsJson` mediumtext COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `SendEmail` tinyint(1) NOT NULL DEFAULT '1',
  `SendWhatsapp` tinyint(1) NOT NULL DEFAULT '1',
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `UrlHash` (`UrlHash`),
  KEY `idx_ddc_district_year` (`fk_district_id`,`fk_year_id`),
  KEY `idx_ddc_urlhash` (`UrlHash`),
  KEY `fk_year_id` (`fk_year_id`),
  CONSTRAINT `district_directory_config_ibfk_1` FOREIGN KEY (`fk_district_id`) REFERENCES `district_master` (`pk_district_id`),
  CONSTRAINT `district_directory_config_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_directory_submission_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_config_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `GroupType` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FieldsSubmittedJson` mediumtext COLLATE utf8mb4_unicode_ci,
  `CompletedCount` int DEFAULT '0',
  `TotalCount` int DEFAULT '0',
  `IpAddress` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `UserAgent` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SubmittedAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `FilledByAdminMobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `idx_ddsl_config` (`fk_config_id`),
  KEY `idx_ddsl_member` (`fk_member_id`),
  KEY `idx_ddsl_date` (`SubmittedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_foundation_goal` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `target_annual_fund_usd` decimal(15,2) DEFAULT '0.00',
  `target_polio_fund_usd` decimal(15,2) DEFAULT '0.00',
  `target_endowment_fund_usd` decimal(15,2) DEFAULT '0.00',
  `target_other_fund_usd` decimal(15,2) DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_district_year` (`fk_district_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_governors` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_member_id` int DEFAULT NULL,
  `member_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `profile_photo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `email` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mobile_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_district_year` (`fk_district_id`,`fk_year_id`),
  KEY `fk_year_id` (`fk_year_id`),
  CONSTRAINT `district_governors_ibfk_1` FOREIGN KEY (`fk_district_id`) REFERENCES `district_master` (`pk_district_id`),
  CONSTRAINT `district_governors_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_master` (
  `pk_district_id` int NOT NULL AUTO_INCREMENT,
  `DistrictNumber` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `DistrictLogoPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_zone_id` int DEFAULT NULL,
  `Country` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `DefaultCurrency` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `BirthdayGreeting` varchar(700) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsEnableBirthdayNotification` tinyint(1) DEFAULT '0',
  `AnniversaryGreeting` varchar(700) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsEnableAnniversaryNotification` tinyint(1) DEFAULT '0',
  `IsGreetingSendWhatsapp` tinyint(1) DEFAULT '0',
  `IsGreetingSendEmail` tinyint(1) DEFAULT '0',
  `IsGreetingSendPush` tinyint(1) DEFAULT '1',
  `IsEnableBirthdayEmail` tinyint(1) DEFAULT '0',
  `BirthdayEmailFrom` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BirthdayEmailSubject` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BirthdayEmailMessage` text COLLATE utf8mb4_unicode_ci,
  `IsEnableAnniversaryEmail` tinyint(1) DEFAULT '0',
  `AnniversaryEmailFrom` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AnniversaryEmailSubject` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AnniversaryEmailMessage` text COLLATE utf8mb4_unicode_ci,
  `GreetingReviewedYearId` int DEFAULT NULL,
  PRIMARY KEY (`pk_district_id`),
  KEY `idx_district_country_number` (`Country`,`DistrictNumber`),
  KEY `idx_district_zone` (`fk_zone_id`,`isdeleted`),
  KEY `idx_district_active` (`isdeleted`,`IsActive`),
  CONSTRAINT `fk_district_zone` FOREIGN KEY (`fk_zone_id`) REFERENCES `zone_master` (`pk_zone_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_prevent_hard_delete_district` BEFORE DELETE ON `district_master` FOR EACH ROW BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_membership_goal` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `target_total` int DEFAULT '0',
  `target_new_members` int DEFAULT '0',
  `target_retention_percent` decimal(5,2) DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_district_year` (`fk_district_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_modules` (
  `pk_district_module_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_module_id` int NOT NULL,
  `IsEnabled` tinyint(1) DEFAULT '1',
  `AssignedBy` int DEFAULT NULL,
  `AssignedDate` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_district_module_id`),
  UNIQUE KEY `uk_district_module` (`fk_district_id`,`fk_module_id`),
  KEY `fk_module_id` (`fk_module_id`),
  CONSTRAINT `district_modules_ibfk_1` FOREIGN KEY (`fk_district_id`) REFERENCES `district_master` (`pk_district_id`),
  CONSTRAINT `district_modules_ibfk_2` FOREIGN KEY (`fk_module_id`) REFERENCES `module_master` (`pk_module_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_performance_report_log` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL DEFAULT '0',
  `RunType` varchar(20) NOT NULL,
  `ToEmail` varchar(255) DEFAULT NULL,
  `CcEmails` varchar(1000) DEFAULT NULL,
  `Status` varchar(20) NOT NULL,
  `Message` varchar(1000) DEFAULT NULL,
  `RunDate` date NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `ix_dpr_log_district_day` (`fk_district_id`,`RunDate`,`RunType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_project_target` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_module_id` int NOT NULL,
  `target_count` int DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_district_year_module` (`fk_district_id`,`fk_year_id`,`fk_module_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_report_reminder_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `report_month` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `member_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designation` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'not_sent',
  `whatsapp_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'not_sent',
  `sent_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `sent_by` int DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_rotary_refresh_jobs` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Running',
  `TotalLinkedClubs` int NOT NULL DEFAULT '0',
  `ClubsDone` int NOT NULL DEFAULT '0',
  `StartedByMemberId` int DEFAULT NULL,
  `StartedUtc` datetime NOT NULL,
  `UpdatedUtc` datetime NOT NULL,
  `FinishedUtc` datetime DEFAULT NULL,
  `Warning` varchar(2000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `idx_district` (`fk_district_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_website_logs` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_website_id` int NOT NULL,
  `Action` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Details` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PerformedBy` int DEFAULT NULL,
  `PerformedDate` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `fk_district_website_id` (`fk_district_website_id`),
  CONSTRAINT `district_website_logs_ibfk_1` FOREIGN KEY (`fk_district_website_id`) REFERENCES `district_websites` (`pk_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `district_websites` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `Subdomain` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ClientDomain` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'Inactive',
  `Notes` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_district_subdomain` (`Subdomain`),
  KEY `fk_district_id` (`fk_district_id`),
  CONSTRAINT `district_websites_ibfk_1` FOREIGN KEY (`fk_district_id`) REFERENCES `district_master` (`pk_district_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `document_push_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_document_id` int NOT NULL,
  `fk_member_master_profile_id` int NOT NULL,
  `FcmToken` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FirebaseMessageId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ErrorMessage` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SentAt` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `idx_document` (`fk_document_id`),
  KEY `idx_member_status` (`fk_member_master_profile_id`,`Status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_log` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `recipient_email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cc_emails` varchar(2000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subject` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `body_html` mediumtext COLLATE utf8mb4_unicode_ci,
  `email_type` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Pending',
  `brevo_message_id` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_message` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_club_id` int DEFAULT NULL,
  `fk_district_id` int DEFAULT NULL,
  `sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `ix_email_log_sent` (`sent_at`),
  KEY `ix_email_log_recipient` (`recipient_email`),
  KEY `ix_email_log_status` (`status`),
  KEY `ix_email_log_club` (`fk_club_id`),
  KEY `ix_email_log_district` (`fk_district_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_food_preferences` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `FoodType` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `SortOrder` int DEFAULT '0',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  `updated_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_payment_designations` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_payment_link_id` int NOT NULL,
  `DesignationName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  KEY `fk_payment_link_id` (`fk_payment_link_id`),
  CONSTRAINT `event_payment_designations_ibfk_1` FOREIGN KEY (`fk_payment_link_id`) REFERENCES `event_payment_links` (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_payment_links` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `FormType` int NOT NULL DEFAULT '1',
  `AmountType` int NOT NULL DEFAULT '1',
  `fk_district_master_id` int DEFAULT NULL,
  `fk_club_id` int DEFAULT NULL,
  `IsForAllDistricts` tinyint(1) DEFAULT '0',
  `DistrictIdsList` text COLLATE utf8mb4_unicode_ci,
  `RecipientType` int NOT NULL DEFAULT '1',
  `SubgroupIds` text COLLATE utf8mb4_unicode_ci,
  `SubgroupYear` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Title` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Description` text COLLATE utf8mb4_unicode_ci,
  `PurposeLogo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PurposeEventImage` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BackgroundImage` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `WeblinkUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsHideCharges` tinyint(1) DEFAULT '0',
  `IsForm` tinyint(1) DEFAULT '0',
  `IsTshirtSize` tinyint(1) DEFAULT '0',
  `IsFood` tinyint(1) DEFAULT '0',
  `FoodPreferenceIds` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsPartner` tinyint(1) DEFAULT '0',
  `IsPartnerName` tinyint(1) DEFAULT '0',
  `IsPartnerMobile` tinyint(1) DEFAULT '0',
  `IsPartnerEmail` tinyint(1) DEFAULT '0',
  `IsPartnerGender` tinyint(1) DEFAULT '0',
  `IsRemark1` tinyint(1) DEFAULT '0',
  `Remark1Title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsRemark2` tinyint(1) DEFAULT '0',
  `Remark2Title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsRemark3` tinyint(1) DEFAULT '0',
  `Remark3Title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsDesignation` tinyint(1) DEFAULT '0',
  `DesignationLabel` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsPersonal` tinyint(1) DEFAULT '0',
  `IsPersonalName` tinyint(1) DEFAULT '0',
  `IsPersonalMobile` tinyint(1) DEFAULT '0',
  `IsPersonalEmail` tinyint(1) DEFAULT '0',
  `IsPersonalDistrict` tinyint(1) DEFAULT '0',
  `IsPersonalClub` tinyint(1) DEFAULT '0',
  `EmailHeaderLogo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailCc` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailSubject` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailBody` text COLLATE utf8mb4_unicode_ci,
  `EmailReminderSubject` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailReminderBody` text COLLATE utf8mb4_unicode_ci,
  `GoogleSheetUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `GoogleSheetName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_weblink_id` int DEFAULT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  `updated_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) DEFAULT '0',
  `GoogleSheetId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `GoogleSheetEmail` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_payment_members` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_payment_link_id` int NOT NULL,
  `fk_member_profile_id` int DEFAULT NULL,
  `fk_registration_id` int DEFAULT NULL,
  `MemberName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Email` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_country_code_id` int DEFAULT NULL,
  `DistrictNumber` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ClubName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Amount` decimal(12,2) DEFAULT NULL,
  `IsPaid` tinyint(1) DEFAULT '0',
  `IsOnline` tinyint(1) DEFAULT '0',
  `PaymentDate` datetime DEFAULT NULL,
  `TransactionId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `CfOrderId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineTransactionType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineGivenTo` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineBankName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineChequeNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineRemark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Attachment` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_tshirt_size_id` int DEFAULT NULL,
  `fk_food_preference_id` int DEFAULT NULL,
  `PartnerName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PartnerMobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PartnerEmail` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PartnerGender` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Remark1` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Remark2` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Remark3` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_designation_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  `updated_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) DEFAULT '0',
  `PaymentStatus` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PaymentSessionId` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PaidSource` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsReceiptSent` tinyint(1) DEFAULT '0',
  `IsWebhookReceived` tinyint(1) DEFAULT '0',
  `WebhookReceivedDate` datetime DEFAULT NULL,
  `OrderSplitsJson` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk_id`),
  KEY `fk_payment_link_id` (`fk_payment_link_id`),
  CONSTRAINT `event_payment_members_ibfk_1` FOREIGN KEY (`fk_payment_link_id`) REFERENCES `event_payment_links` (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_payment_otp` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_payment_link_id` int NOT NULL,
  `Email` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Mobile` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OtpCode` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `IsVerified` tinyint(1) DEFAULT '0',
  `ExpiresAt` datetime NOT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `ix_event_payment_otp_link` (`fk_payment_link_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_payment_registrations` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_payment_link_id` int NOT NULL,
  `RegistrationName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  KEY `fk_payment_link_id` (`fk_payment_link_id`),
  CONSTRAINT `event_payment_registrations_ibfk_1` FOREIGN KEY (`fk_payment_link_id`) REFERENCES `event_payment_links` (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_payment_settlements` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_payment_link_id` int NOT NULL,
  `fk_member_payment_id` int NOT NULL,
  `CfOrderId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `VendorId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Amount` decimal(12,2) DEFAULT '0.00',
  `SettlementStatus` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SettlementId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SettlementUtr` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SettlementTime` datetime DEFAULT NULL,
  `ServiceCharge` decimal(12,2) DEFAULT '0.00',
  `ServiceTax` decimal(12,2) DEFAULT '0.00',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_payment_vendor_splits` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_payment_link_id` int NOT NULL,
  `fk_registration_id` int NOT NULL,
  `fk_kyc_id` int NOT NULL,
  `SplitAmount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  KEY `fk_payment_link_id` (`fk_payment_link_id`),
  KEY `fk_registration_id` (`fk_registration_id`),
  CONSTRAINT `event_payment_vendor_splits_ibfk_1` FOREIGN KEY (`fk_payment_link_id`) REFERENCES `event_payment_links` (`pk_id`),
  CONSTRAINT `event_payment_vendor_splits_ibfk_2` FOREIGN KEY (`fk_registration_id`) REFERENCES `event_payment_registrations` (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_push_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_upcoming_event_id` int NOT NULL,
  `fk_member_master_profile_id` int NOT NULL,
  `FcmToken` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FirebaseMessageId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ErrorMessage` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SentAt` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `idx_event` (`fk_upcoming_event_id`),
  KEY `idx_member_status` (`fk_member_master_profile_id`,`Status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_reminder_push_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_reminder_id` int NOT NULL,
  `fk_upcoming_event_id` int NOT NULL,
  `fk_member_master_profile_id` int NOT NULL,
  `FcmToken` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FirebaseMessageId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ErrorMessage` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SentAt` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `idx_reminder` (`fk_reminder_id`),
  KEY `idx_member_status` (`fk_member_master_profile_id`,`Status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_tshirt_sizes` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `SizeName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `SortOrder` int DEFAULT '0',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  `updated_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `funding_master` (
  `pk_funding_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_funding_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_categories` (
  `pk_category_id` int NOT NULL AUTO_INCREMENT,
  `Name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `SortOrder` int NOT NULL DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_category_id`),
  UNIQUE KEY `uk_goal_category_name` (`Name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_comments` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_category_id` int NOT NULL,
  `fk_district_id` int NOT NULL,
  `fk_club_id` int NOT NULL DEFAULT '0',
  `ThreadOwnerMemberId` int NOT NULL DEFAULT '0',
  `fk_assignment_id` int NOT NULL DEFAULT '0',
  `fk_zone_id` int NOT NULL DEFAULT '0',
  `fk_year_id` int NOT NULL,
  `CommentText` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `PostedByMemberId` int NOT NULL,
  `PostedByTier` tinyint NOT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  KEY `idx_goal_comment_thread` (`fk_district_id`,`fk_category_id`,`fk_year_id`,`PostedByTier`),
  KEY `fk_category_id` (`fk_category_id`),
  KEY `fk_year_id` (`fk_year_id`),
  KEY `idx_goal_comment_zone` (`fk_zone_id`,`fk_year_id`),
  KEY `idx_goal_comment_seat` (`fk_assignment_id`),
  CONSTRAINT `goal_comments_ibfk_1` FOREIGN KEY (`fk_category_id`) REFERENCES `goal_categories` (`pk_category_id`),
  CONSTRAINT `goal_comments_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_entries` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_field_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `EntityType` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_club_id` int NOT NULL DEFAULT '0',
  `fk_district_id` int NOT NULL DEFAULT '0',
  `NumericValue` decimal(18,2) DEFAULT NULL,
  `TextValue` text COLLATE utf8mb4_unicode_ci,
  `BoolValue` tinyint(1) DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_goal_entry` (`fk_field_id`,`fk_year_id`,`EntityType`,`fk_club_id`,`fk_district_id`),
  KEY `idx_goal_entry_club` (`fk_club_id`,`fk_year_id`),
  KEY `idx_goal_entry_district` (`fk_district_id`,`fk_year_id`),
  KEY `fk_year_id` (`fk_year_id`),
  CONSTRAINT `goal_entries_ibfk_1` FOREIGN KEY (`fk_field_id`) REFERENCES `goal_fields` (`pk_field_id`),
  CONSTRAINT `goal_entries_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_entries_monthly` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_field_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `EntityType` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_club_id` int NOT NULL DEFAULT '0',
  `fk_district_id` int NOT NULL DEFAULT '0',
  `PeriodMonth` tinyint NOT NULL,
  `NumericValue` decimal(18,2) DEFAULT NULL,
  `TargetValue` decimal(18,2) DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_goal_entry_month` (`fk_field_id`,`fk_year_id`,`EntityType`,`fk_club_id`,`fk_district_id`,`PeriodMonth`),
  KEY `idx_gem_club` (`fk_club_id`,`fk_year_id`),
  KEY `idx_gem_district` (`fk_district_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_fields` (
  `pk_field_id` int NOT NULL AUTO_INCREMENT,
  `fk_category_id` int NOT NULL,
  `GroupName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FieldKey` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FieldLabel` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `DataType` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Unit` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FieldRole` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ComputeExpression` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AppliesTo` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Both',
  `SortOrder` int NOT NULL DEFAULT '0',
  `IsHidden` tinyint(1) NOT NULL DEFAULT '0',
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_field_id`),
  UNIQUE KEY `uk_goal_field_key` (`FieldKey`),
  KEY `idx_goal_field_category` (`fk_category_id`,`SortOrder`),
  CONSTRAINT `goal_fields_ibfk_1` FOREIGN KEY (`fk_category_id`) REFERENCES `goal_categories` (`pk_category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_foundation_import_months` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_year_id` int NOT NULL,
  `Scope` varchar(10) NOT NULL,
  `PeriodMonth` tinyint NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_gfim` (`fk_year_id`,`Scope`,`PeriodMonth`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_leadership_designations` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `Title` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Avenue` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `RoleType` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `DefaultCategoryName` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SortOrder` int NOT NULL DEFAULT '0',
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_goal_designation_title` (`Title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_locks` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `EntityType` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_message_seen` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_id` int NOT NULL,
  `fk_zone_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `last_seen_date` datetime NOT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uq_seen` (`fk_member_id`,`fk_zone_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_message_thread_seen` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_id` int NOT NULL,
  `ThreadOwnerMemberId` int NOT NULL,
  `fk_category_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `last_seen_date` datetime NOT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uq_thread_seen` (`fk_member_id`,`ThreadOwnerMemberId`,`fk_category_id`,`fk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_oversight_access` (
  `fk_member_id` int NOT NULL,
  `IsEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL,
  `modified_by` int DEFAULT NULL,
  PRIMARY KEY (`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_role_assignment_districts` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_assignment_id` int NOT NULL,
  `fk_district_id` int NOT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_goal_role_assignment_district` (`fk_assignment_id`,`fk_district_id`),
  CONSTRAINT `goal_role_assignment_districts_ibfk_1` FOREIGN KEY (`fk_assignment_id`) REFERENCES `goal_role_assignments` (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_role_assignment_zones` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_assignment_id` int NOT NULL,
  `fk_zone_id` int NOT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_goal_role_assignment_zone` (`fk_assignment_id`,`fk_zone_id`),
  CONSTRAINT `goal_role_assignment_zones_ibfk_1` FOREIGN KEY (`fk_assignment_id`) REFERENCES `goal_role_assignments` (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `goal_role_assignments` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_id` int NOT NULL,
  `MemberNameText` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RoleType` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `AssignmentName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `RoleTitle` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Avenue` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_category_id` int DEFAULT NULL,
  `fk_zone_id` int DEFAULT NULL,
  `HomeDistrictId` int DEFAULT NULL,
  `DgYear` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SupportingText` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `international_president` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_year_id` int NOT NULL,
  `Name` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Designation` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ProfilePhotoPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Description` mediumtext COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_ip_year` (`fk_year_id`),
  CONSTRAINT `international_president_ibfk_1` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_announcement_reads` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_announcement_id` int NOT NULL,
  `fk_member_id` int NOT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_ann_member` (`fk_announcement_id`,`fk_member_id`),
  CONSTRAINT `login_announcement_reads_ibfk_1` FOREIGN KEY (`fk_announcement_id`) REFERENCES `login_announcements` (`pk_announcement_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_announcements` (
  `pk_announcement_id` int NOT NULL AUTO_INCREMENT,
  `content` mediumtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `target_roles` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_filters` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_locations` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk_announcement_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_audit_logs` (
  `pk_log_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_id` int DEFAULT NULL,
  `member_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email_or_mobile` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `login_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `ip_address` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `login_status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'success',
  `failure_reason` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_log_id`),
  KEY `idx_audit_member` (`fk_member_id`),
  KEY `idx_audit_time` (`login_time`),
  KEY `idx_audit_status` (`login_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_address_details` (
  `pk_member_address_details_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_master_profile_id` int NOT NULL,
  `AddressType` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_country_id` int DEFAULT '1',
  `PhoneNumber` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Address` text COLLATE utf8mb4_unicode_ci,
  `State` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `City` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PinCode` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BusinessName` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BusinessEmailId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Keywords` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_source` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_member_address_details_id`),
  KEY `fk_address_country` (`fk_country_id`),
  KEY `idx_address_member_active` (`fk_member_master_profile_id`,`isdeleted`,`AddressType`),
  CONSTRAINT `fk_address_country` FOREIGN KEY (`fk_country_id`) REFERENCES `country_master` (`pk_country_id`),
  CONSTRAINT `member_address_details_ibfk_1` FOREIGN KEY (`fk_member_master_profile_id`) REFERENCES `member_master_profile` (`pk_member_master_profile_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = latin1 */ ;
/*!50003 SET character_set_results = latin1 */ ;
/*!50003 SET collation_connection  = latin1_swedish_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `trg_mcl_insert_address` AFTER INSERT ON `member_address_details` FOR EACH ROW BEGIN
    INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
    VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id,
            '(record created)', NULL, CONCAT(COALESCE(NEW.AddressType,''), ' address'), 'Create', NEW.created_by, NEW.modified_source);
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = latin1 */ ;
/*!50003 SET character_set_results = latin1 */ ;
/*!50003 SET collation_connection  = latin1_swedish_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `trg_mcl_update_address` AFTER UPDATE ON `member_address_details` FOR EACH ROW BEGIN
    DECLARE v_action VARCHAR(20);
    IF NOT (OLD.isdeleted <=> NEW.isdeleted) AND COALESCE(NEW.isdeleted,0) = 1 THEN SET v_action = 'SoftDelete';
    ELSEIF NOT (OLD.isdeleted <=> NEW.isdeleted) AND COALESCE(NEW.isdeleted,0) = 0 THEN SET v_action = 'Restore';
    ELSE SET v_action = 'Update';
    END IF;

    IF NOT (OLD.AddressType <=> NEW.AddressType) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id, 'AddressType', OLD.AddressType, NEW.AddressType, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.fk_country_id <=> NEW.fk_country_id) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id, 'fk_country_id', OLD.fk_country_id, NEW.fk_country_id, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.PhoneNumber <=> NEW.PhoneNumber) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id, 'PhoneNumber', OLD.PhoneNumber, NEW.PhoneNumber, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.Address <=> NEW.Address) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id, 'Address', OLD.Address, NEW.Address, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.State <=> NEW.State) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id, 'State', OLD.State, NEW.State, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.City <=> NEW.City) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id, 'City', OLD.City, NEW.City, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.PinCode <=> NEW.PinCode) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id, 'PinCode', OLD.PinCode, NEW.PinCode, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.BusinessName <=> NEW.BusinessName) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id, 'BusinessName', OLD.BusinessName, NEW.BusinessName, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.BusinessEmailId <=> NEW.BusinessEmailId) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id, 'BusinessEmailId', OLD.BusinessEmailId, NEW.BusinessEmailId, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.Keywords <=> NEW.Keywords) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id, 'Keywords', OLD.Keywords, NEW.Keywords, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.isdeleted <=> NEW.isdeleted) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_address_details', NEW.pk_member_address_details_id, 'isdeleted', OLD.isdeleted, NEW.isdeleted, v_action, NEW.modified_by, NEW.modified_source); END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_prevent_hard_delete_address` BEFORE DELETE ON `member_address_details` FOR EACH ROW BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_change_log` (
  `pk_change_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_member_master_profile_id` int NOT NULL,
  `table_name` varchar(40) NOT NULL,
  `record_id` int NOT NULL,
  `field_name` varchar(64) NOT NULL,
  `old_value` text,
  `new_value` text,
  `action_type` varchar(20) NOT NULL,
  `changed_by` int DEFAULT NULL,
  `changed_source` varchar(20) DEFAULT NULL,
  `changed_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_change_id`),
  KEY `ix_mcl_member` (`fk_member_master_profile_id`,`changed_date`),
  KEY `ix_mcl_date` (`changed_date`),
  KEY `ix_mcl_actor` (`changed_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_credentials` (
  `pk_member_credential_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_master_profile_id` int NOT NULL,
  `PasswordHash` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `IsTemporaryPassword` tinyint(1) DEFAULT '1',
  `IsActive` tinyint(1) DEFAULT '1',
  `LastPasswordChangeDate` datetime DEFAULT NULL,
  `FailedLoginAttempts` int DEFAULT '0',
  `LockoutEndTime` datetime DEFAULT NULL,
  `LastLoginDate` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_member_credential_id`),
  UNIQUE KEY `fk_member_master_profile_id` (`fk_member_master_profile_id`),
  KEY `idx_credentials_member` (`fk_member_master_profile_id`,`isdeleted`),
  CONSTRAINT `member_credentials_ibfk_1` FOREIGN KEY (`fk_member_master_profile_id`) REFERENCES `member_master_profile` (`pk_member_master_profile_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_device_sessions` (
  `pk_session_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_master_profile_id` int NOT NULL,
  `fk_family_member_id` int DEFAULT NULL,
  `imei` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `device_token` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `device_name` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `app_version` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `login_count` int DEFAULT '1',
  `first_visit` datetime NOT NULL,
  `last_visit` datetime NOT NULL,
  `last_logout` datetime DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_session_id`),
  UNIQUE KEY `uk_member_imei` (`fk_member_master_profile_id`,`imei`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_family_details` (
  `pk_member_family_details_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_master_profile_id` int NOT NULL,
  `Name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Relation` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BloodGroup` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_country_id` int DEFAULT '1',
  `PhoneNumber` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BirthDate` date DEFAULT NULL,
  `AnniversaryDate` date DEFAULT NULL,
  `PhotoPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_source` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_member_family_details_id`),
  KEY `fk_family_country` (`fk_country_id`),
  KEY `idx_family_member_active` (`fk_member_master_profile_id`,`isdeleted`),
  CONSTRAINT `fk_family_country` FOREIGN KEY (`fk_country_id`) REFERENCES `country_master` (`pk_country_id`),
  CONSTRAINT `member_family_details_ibfk_1` FOREIGN KEY (`fk_member_master_profile_id`) REFERENCES `member_master_profile` (`pk_member_master_profile_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = latin1 */ ;
/*!50003 SET character_set_results = latin1 */ ;
/*!50003 SET collation_connection  = latin1_swedish_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `trg_mcl_insert_family` AFTER INSERT ON `member_family_details` FOR EACH ROW BEGIN
    INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
    VALUES (NEW.fk_member_master_profile_id, 'member_family_details', NEW.pk_member_family_details_id,
            '(record created)', NULL, CONCAT(COALESCE(NEW.Name,''), ' (', COALESCE(NEW.Relation,'?'), ')'), 'Create', NEW.created_by, NEW.modified_source);
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = latin1 */ ;
/*!50003 SET character_set_results = latin1 */ ;
/*!50003 SET collation_connection  = latin1_swedish_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `trg_mcl_update_family` AFTER UPDATE ON `member_family_details` FOR EACH ROW BEGIN
    DECLARE v_action VARCHAR(20);
    IF NOT (OLD.isdeleted <=> NEW.isdeleted) AND COALESCE(NEW.isdeleted,0) = 1 THEN SET v_action = 'SoftDelete';
    ELSEIF NOT (OLD.isdeleted <=> NEW.isdeleted) AND COALESCE(NEW.isdeleted,0) = 0 THEN SET v_action = 'Restore';
    ELSE SET v_action = 'Update';
    END IF;

    IF NOT (OLD.Name <=> NEW.Name) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_family_details', NEW.pk_member_family_details_id, 'Name', OLD.Name, NEW.Name, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.Relation <=> NEW.Relation) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_family_details', NEW.pk_member_family_details_id, 'Relation', OLD.Relation, NEW.Relation, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.BloodGroup <=> NEW.BloodGroup) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_family_details', NEW.pk_member_family_details_id, 'BloodGroup', OLD.BloodGroup, NEW.BloodGroup, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.fk_country_id <=> NEW.fk_country_id) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_family_details', NEW.pk_member_family_details_id, 'fk_country_id', OLD.fk_country_id, NEW.fk_country_id, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.PhoneNumber <=> NEW.PhoneNumber) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_family_details', NEW.pk_member_family_details_id, 'PhoneNumber', OLD.PhoneNumber, NEW.PhoneNumber, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.EmailId <=> NEW.EmailId) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_family_details', NEW.pk_member_family_details_id, 'EmailId', OLD.EmailId, NEW.EmailId, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.BirthDate <=> NEW.BirthDate) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_family_details', NEW.pk_member_family_details_id, 'BirthDate', OLD.BirthDate, NEW.BirthDate, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.AnniversaryDate <=> NEW.AnniversaryDate) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_family_details', NEW.pk_member_family_details_id, 'AnniversaryDate', OLD.AnniversaryDate, NEW.AnniversaryDate, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.PhotoPath <=> NEW.PhotoPath) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_family_details', NEW.pk_member_family_details_id, 'PhotoPath', OLD.PhotoPath, NEW.PhotoPath, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.isdeleted <=> NEW.isdeleted) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.fk_member_master_profile_id, 'member_family_details', NEW.pk_member_family_details_id, 'isdeleted', OLD.isdeleted, NEW.isdeleted, v_action, NEW.modified_by, NEW.modified_source); END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_prevent_hard_delete_family` BEFORE DELETE ON `member_family_details` FOR EACH ROW BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_fcm_tokens` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_master_profile_id` int NOT NULL,
  `FcmToken` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `DeviceType` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `DeviceId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `isdeleted` tinyint(1) DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `last_used_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uq_fcm_token` (`FcmToken`),
  KEY `idx_member_active` (`fk_member_master_profile_id`,`IsActive`,`isdeleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_master_profile` (
  `pk_member_master_profile_id` int NOT NULL AUTO_INCREMENT,
  `MemberName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ProfilePhotoPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_primary_country_id` int DEFAULT '1',
  `PrimaryMobileNumber` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BirthDate` date DEFAULT NULL,
  `AnniversaryDate` date DEFAULT NULL,
  `BloodGroup` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_secondary_country_id` int DEFAULT '1',
  `SecondaryMobileNumber` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsPersonalDetailsVisible` bit(1) DEFAULT b'1',
  `Gender` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PrimaryLanguage` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'English',
  `IsYouth` bit(1) DEFAULT b'0',
  `MemberIntroduction` text COLLATE utf8mb4_unicode_ci,
  `Facebook` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Instagram` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LinkedIn` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Twitter` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Youtube` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Website` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RotaryId` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `DonorRecognition` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FamilyPhotoPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsFamilyDetailsVisible` bit(1) DEFAULT b'1',
  `ShowPhoneInMyClub` tinyint(1) NOT NULL DEFAULT '1',
  `ShowPhoneInAllClubs` tinyint(1) NOT NULL DEFAULT '1',
  `ShowEmailInMyClub` tinyint(1) NOT NULL DEFAULT '1',
  `ShowEmailInAllClubs` tinyint(1) NOT NULL DEFAULT '1',
  `NotifyUpcomingEvents` tinyint(1) NOT NULL DEFAULT '1',
  `NotifyAnnouncements` tinyint(1) NOT NULL DEFAULT '1',
  `NotifyNewsletters` tinyint(1) NOT NULL DEFAULT '1',
  `NotifyDocuments` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_source` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `MobileLoginCount` int DEFAULT '0',
  `LastImei` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LastDeviceToken` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LastDeviceName` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FirstMobileVisit` datetime DEFAULT NULL,
  `LastMobileVisit` datetime DEFAULT NULL,
  `LastMobileLogout` datetime DEFAULT NULL,
  `mobile_force_relogin_at` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_member_master_profile_id`),
  UNIQUE KEY `PrimaryMobileNumber` (`PrimaryMobileNumber`),
  UNIQUE KEY `EmailId` (`EmailId`),
  UNIQUE KEY `RotaryId` (`RotaryId`),
  KEY `fk_member_primary_country` (`fk_primary_country_id`),
  KEY `fk_member_secondary_country` (`fk_secondary_country_id`),
  KEY `idx_member_active` (`isdeleted`,`MemberName`),
  KEY `idx_member_blood_group` (`isdeleted`,`BloodGroup`),
  KEY `idx_member_gender` (`isdeleted`,`Gender`),
  KEY `idx_member_rotary_id` (`isdeleted`,`RotaryId`),
  KEY `idx_member_email` (`isdeleted`,`EmailId`),
  CONSTRAINT `fk_member_primary_country` FOREIGN KEY (`fk_primary_country_id`) REFERENCES `country_master` (`pk_country_id`),
  CONSTRAINT `fk_member_secondary_country` FOREIGN KEY (`fk_secondary_country_id`) REFERENCES `country_master` (`pk_country_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = latin1 */ ;
/*!50003 SET character_set_results = latin1 */ ;
/*!50003 SET collation_connection  = latin1_swedish_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `trg_mcl_insert_member` AFTER INSERT ON `member_master_profile` FOR EACH ROW BEGIN
    INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
    VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id,
            '(record created)', NULL, NEW.MemberName, 'Create', NEW.created_by, NEW.modified_source);
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = latin1 */ ;
/*!50003 SET character_set_results = latin1 */ ;
/*!50003 SET collation_connection  = latin1_swedish_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `trg_mcl_update_member` AFTER UPDATE ON `member_master_profile` FOR EACH ROW BEGIN
    DECLARE v_action VARCHAR(20);

    
    
    IF NOT (OLD.isdeleted <=> NEW.isdeleted) AND COALESCE(NEW.isdeleted,0) = 1 THEN
        SET v_action = 'SoftDelete';
    ELSEIF NOT (OLD.isdeleted <=> NEW.isdeleted) AND COALESCE(NEW.isdeleted,0) = 0 THEN
        SET v_action = 'Restore';
    ELSE
        SET v_action = 'Update';
    END IF;

    IF NOT (OLD.MemberName <=> NEW.MemberName) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'MemberName', OLD.MemberName, NEW.MemberName, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.ProfilePhotoPath <=> NEW.ProfilePhotoPath) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'ProfilePhotoPath', OLD.ProfilePhotoPath, NEW.ProfilePhotoPath, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.fk_primary_country_id <=> NEW.fk_primary_country_id) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'fk_primary_country_id', OLD.fk_primary_country_id, NEW.fk_primary_country_id, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.PrimaryMobileNumber <=> NEW.PrimaryMobileNumber) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'PrimaryMobileNumber', OLD.PrimaryMobileNumber, NEW.PrimaryMobileNumber, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.EmailId <=> NEW.EmailId) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'EmailId', OLD.EmailId, NEW.EmailId, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.BirthDate <=> NEW.BirthDate) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'BirthDate', OLD.BirthDate, NEW.BirthDate, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.AnniversaryDate <=> NEW.AnniversaryDate) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'AnniversaryDate', OLD.AnniversaryDate, NEW.AnniversaryDate, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.BloodGroup <=> NEW.BloodGroup) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'BloodGroup', OLD.BloodGroup, NEW.BloodGroup, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.fk_secondary_country_id <=> NEW.fk_secondary_country_id) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'fk_secondary_country_id', OLD.fk_secondary_country_id, NEW.fk_secondary_country_id, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.SecondaryMobileNumber <=> NEW.SecondaryMobileNumber) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'SecondaryMobileNumber', OLD.SecondaryMobileNumber, NEW.SecondaryMobileNumber, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.IsPersonalDetailsVisible <=> NEW.IsPersonalDetailsVisible) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'IsPersonalDetailsVisible', CAST(OLD.IsPersonalDetailsVisible AS UNSIGNED), CAST(NEW.IsPersonalDetailsVisible AS UNSIGNED), v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.Gender <=> NEW.Gender) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'Gender', OLD.Gender, NEW.Gender, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.PrimaryLanguage <=> NEW.PrimaryLanguage) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'PrimaryLanguage', OLD.PrimaryLanguage, NEW.PrimaryLanguage, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.IsYouth <=> NEW.IsYouth) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'IsYouth', CAST(OLD.IsYouth AS UNSIGNED), CAST(NEW.IsYouth AS UNSIGNED), v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.MemberIntroduction <=> NEW.MemberIntroduction) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'MemberIntroduction', OLD.MemberIntroduction, NEW.MemberIntroduction, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.Facebook <=> NEW.Facebook) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'Facebook', OLD.Facebook, NEW.Facebook, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.Instagram <=> NEW.Instagram) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'Instagram', OLD.Instagram, NEW.Instagram, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.LinkedIn <=> NEW.LinkedIn) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'LinkedIn', OLD.LinkedIn, NEW.LinkedIn, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.Twitter <=> NEW.Twitter) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'Twitter', OLD.Twitter, NEW.Twitter, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.Youtube <=> NEW.Youtube) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'Youtube', OLD.Youtube, NEW.Youtube, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.Website <=> NEW.Website) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'Website', OLD.Website, NEW.Website, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.RotaryId <=> NEW.RotaryId) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'RotaryId', OLD.RotaryId, NEW.RotaryId, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.DonorRecognition <=> NEW.DonorRecognition) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'DonorRecognition', OLD.DonorRecognition, NEW.DonorRecognition, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.FamilyPhotoPath <=> NEW.FamilyPhotoPath) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'FamilyPhotoPath', OLD.FamilyPhotoPath, NEW.FamilyPhotoPath, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.IsFamilyDetailsVisible <=> NEW.IsFamilyDetailsVisible) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'IsFamilyDetailsVisible', CAST(OLD.IsFamilyDetailsVisible AS UNSIGNED), CAST(NEW.IsFamilyDetailsVisible AS UNSIGNED), v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.ShowPhoneInMyClub <=> NEW.ShowPhoneInMyClub) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'ShowPhoneInMyClub', OLD.ShowPhoneInMyClub, NEW.ShowPhoneInMyClub, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.ShowPhoneInAllClubs <=> NEW.ShowPhoneInAllClubs) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'ShowPhoneInAllClubs', OLD.ShowPhoneInAllClubs, NEW.ShowPhoneInAllClubs, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.ShowEmailInMyClub <=> NEW.ShowEmailInMyClub) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'ShowEmailInMyClub', OLD.ShowEmailInMyClub, NEW.ShowEmailInMyClub, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.ShowEmailInAllClubs <=> NEW.ShowEmailInAllClubs) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'ShowEmailInAllClubs', OLD.ShowEmailInAllClubs, NEW.ShowEmailInAllClubs, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.NotifyUpcomingEvents <=> NEW.NotifyUpcomingEvents) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'NotifyUpcomingEvents', OLD.NotifyUpcomingEvents, NEW.NotifyUpcomingEvents, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.NotifyAnnouncements <=> NEW.NotifyAnnouncements) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'NotifyAnnouncements', OLD.NotifyAnnouncements, NEW.NotifyAnnouncements, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.NotifyNewsletters <=> NEW.NotifyNewsletters) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'NotifyNewsletters', OLD.NotifyNewsletters, NEW.NotifyNewsletters, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.NotifyDocuments <=> NEW.NotifyDocuments) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'NotifyDocuments', OLD.NotifyDocuments, NEW.NotifyDocuments, v_action, NEW.modified_by, NEW.modified_source); END IF;

    IF NOT (OLD.isdeleted <=> NEW.isdeleted) THEN INSERT INTO member_change_log
        (fk_member_master_profile_id, table_name, record_id, field_name, old_value, new_value, action_type, changed_by, changed_source)
        VALUES (NEW.pk_member_master_profile_id, 'member_master_profile', NEW.pk_member_master_profile_id, 'isdeleted', OLD.isdeleted, NEW.isdeleted, v_action, NEW.modified_by, NEW.modified_source); END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_prevent_hard_delete_member` BEFORE DELETE ON `member_master_profile` FOR EACH ROW BEGIN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hard delete not allowed. Use soft delete (SET isdeleted = 1).';
                    END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_roles` (
  `pk_member_role_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_master_profile_id` int NOT NULL,
  `fk_role_id` int NOT NULL,
  `fk_club_id` int DEFAULT NULL,
  `fk_zone_id` int DEFAULT NULL,
  `fk_district_id` int DEFAULT NULL,
  `AllClubsAccess` tinyint(1) NOT NULL DEFAULT '0',
  `AssignedDate` datetime DEFAULT CURRENT_TIMESTAMP,
  `AssignedBy` int DEFAULT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `RevokedDate` datetime DEFAULT NULL,
  `RevokedBy` int DEFAULT NULL,
  `isdeleted` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_member_role_id`),
  KEY `idx_member_roles_member` (`fk_member_master_profile_id`,`isdeleted`),
  KEY `idx_member_roles_role` (`fk_role_id`,`isdeleted`),
  CONSTRAINT `member_roles_ibfk_1` FOREIGN KEY (`fk_member_master_profile_id`) REFERENCES `member_master_profile` (`pk_member_master_profile_id`) ON DELETE CASCADE,
  CONSTRAINT `member_roles_ibfk_2` FOREIGN KEY (`fk_role_id`) REFERENCES `roles` (`pk_role_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `membership_dues` (
  `pk_membership_dues_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `RotaryYear` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Purpose` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PurposeDescription` text COLLATE utf8mb4_unicode_ci,
  `PurposeLogo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BackgroundImage` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ModeOfPayment` int DEFAULT '3',
  `IsShowBankInReceipt` tinyint(1) DEFAULT '0',
  `IsFees1` tinyint(1) DEFAULT '1',
  `IsFees2` tinyint(1) DEFAULT '0',
  `IsFees3` tinyint(1) DEFAULT '0',
  `Fees1Text` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'Annual',
  `Fees2Text` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'Semi Annual 1',
  `Fees3Text` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'Semi Annual 2',
  `DefaultCategoryType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'Standard',
  `DefaultAnnualAmount` decimal(12,2) DEFAULT '0.00',
  `DefaultOfflineAnnualAmount` decimal(12,2) DEFAULT '0.00',
  `DefaultSemi1Amount` decimal(12,2) DEFAULT '0.00',
  `DefaultOfflineSemi1Amount` decimal(12,2) DEFAULT '0.00',
  `DefaultSemi2Amount` decimal(12,2) DEFAULT '0.00',
  `DefaultOfflineSemi2Amount` decimal(12,2) DEFAULT '0.00',
  `AmountType` int DEFAULT '1',
  `DefaultPercentage` decimal(5,2) DEFAULT '2.95',
  `OfflineBankName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineAccountNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineIfscCode` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailHeaderLogo` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailCC` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailSubject` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailBody` text COLLATE utf8mb4_unicode_ci,
  `EmailReminderSubject` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EmailReminderBody` text COLLATE utf8mb4_unicode_ci,
  `GoogleSheetId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `GoogleSheetUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `GoogleSheetEmail` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `WeblinkUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_weblink_id` int DEFAULT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `OnlineSurchargePercent` decimal(5,2) NOT NULL DEFAULT '2.95',
  PRIMARY KEY (`pk_membership_dues_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `membership_dues_member_fees` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_membership_dues_id` int NOT NULL,
  `fk_member_profile_id` int NOT NULL,
  `CategoryType` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'Standard',
  `AnnualAmount` decimal(12,2) DEFAULT '0.00',
  `OfflineAnnualAmount` decimal(12,2) DEFAULT '0.00',
  `Semi1Amount` decimal(12,2) DEFAULT '0.00',
  `OfflineSemi1Amount` decimal(12,2) DEFAULT '0.00',
  `Semi2Amount` decimal(12,2) DEFAULT '0.00',
  `OfflineSemi2Amount` decimal(12,2) DEFAULT '0.00',
  `IsNewMember` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `membership_dues_member_vendors` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_membership_dues_id` int NOT NULL,
  `fk_member_profile_id` int NOT NULL,
  `fk_member_fee_id` int DEFAULT NULL,
  `fk_kyc_id` int NOT NULL,
  `VendorId` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `AnnualAmount` decimal(12,2) DEFAULT '0.00',
  `Semi1Amount` decimal(12,2) DEFAULT '0.00',
  `Semi2Amount` decimal(12,2) DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `IsSelf` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `membership_dues_payments` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_membership_dues_id` int NOT NULL,
  `fk_member_profile_id` int NOT NULL,
  `fk_member_fee_id` int NOT NULL,
  `FeeType` int NOT NULL,
  `Amount` decimal(12,2) NOT NULL,
  `IsPaid` tinyint(1) DEFAULT '0',
  `IsOnline` tinyint(1) DEFAULT '0',
  `PaymentStatus` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Pending',
  `PaidSource` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PaymentDate` datetime DEFAULT NULL,
  `TransactionId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `CfOrderId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PaymentSessionId` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineTransactionType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineTransactionId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineGivenTo` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineBankName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineChequeNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineRemark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Attachment` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OfflineStatus` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RejectionReason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ApprovedBy` int DEFAULT NULL,
  `ApprovedDate` datetime DEFAULT NULL,
  `RejectedBy` int DEFAULT NULL,
  `RejectedDate` datetime DEFAULT NULL,
  `IsReceiptSent` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `IsWebhookReceived` tinyint(1) DEFAULT '0',
  `WebhookReceivedDate` datetime DEFAULT NULL,
  `OrderSplitsJson` text COLLATE utf8mb4_unicode_ci,
  `ApprovalRemark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ApprovalSource` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RejectionSource` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `membership_dues_settlements` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_membership_dues_id` int NOT NULL,
  `fk_payment_id` int NOT NULL,
  `CfOrderId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `VendorId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Amount` decimal(12,2) DEFAULT '0.00',
  `SettlementStatus` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SettlementId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SettlementUtr` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SettlementTime` datetime DEFAULT NULL,
  `ServiceCharge` decimal(12,2) DEFAULT '0.00',
  `ServiceTax` decimal(12,2) DEFAULT '0.00',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `membership_dues_vendors` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_membership_dues_id` int NOT NULL,
  `fk_kyc_id` int NOT NULL,
  `VendorId` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `AnnualAmount` decimal(12,2) DEFAULT '0.00',
  `Semi1Amount` decimal(12,2) DEFAULT '0.00',
  `Semi2Amount` decimal(12,2) DEFAULT '0.00',
  `IsDefault` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `IsSelf` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mobile_app_versions` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `Version` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Message` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PlayStoreUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AppStoreUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT 'https://itunes.apple.com/in/app/viewSoftwareUpdate/id682238809?mt=8',
  `IsForceUpdate` tinyint(1) DEFAULT '1',
  `IsActive` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mobile_login_otp` (
  `pk_otp_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_master_profile_id` int DEFAULT NULL,
  `fk_family_member_id` int DEFAULT NULL,
  `login_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `identifier` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `country_id` int DEFAULT NULL,
  `otp_code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `attempts` int DEFAULT '0',
  `max_attempts` int DEFAULT '5',
  `expires_at` datetime NOT NULL,
  `is_used` tinyint(1) DEFAULT '0',
  `sent_email` tinyint(1) DEFAULT '0',
  `sent_sms` tinyint(1) DEFAULT '0',
  `sent_whatsapp` tinyint(1) NOT NULL DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_otp_id`),
  KEY `idx_otp_lookup` (`identifier`,`is_used`,`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `module_categories` (
  `pk_category_id` int NOT NULL AUTO_INCREMENT,
  `CategoryName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `SortOrder` int NOT NULL DEFAULT '0',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `module_master` (
  `pk_module_id` int NOT NULL AUTO_INCREMENT,
  `ModuleName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ModuleKey` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_category_id` int NOT NULL,
  `ModuleLevel` enum('District','Club','Both') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Both',
  `IconClass` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IconPath` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RouteUrl` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsDefaultForDistrict` tinyint(1) DEFAULT '0',
  `IsDefaultForClub` tinyint(1) DEFAULT '0',
  `IsDefaultForMember` tinyint(1) DEFAULT '0',
  `SortOrder` int NOT NULL DEFAULT '0',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `IsComingSoon` tinyint(1) NOT NULL DEFAULT '0',
  `ComingSoonDate` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_module_id`),
  UNIQUE KEY `ModuleKey` (`ModuleKey`),
  KEY `fk_category_id` (`fk_category_id`),
  CONSTRAINT `module_master_ibfk_1` FOREIGN KEY (`fk_category_id`) REFERENCES `module_categories` (`pk_category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `newsletter_push_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_newsletter_id` int NOT NULL,
  `fk_member_master_profile_id` int NOT NULL,
  `FcmToken` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FirebaseMessageId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ErrorMessage` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SentAt` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `idx_newsletter` (`fk_newsletter_id`),
  KEY `idx_member_status` (`fk_member_master_profile_id`,`Status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `newsletters` (
  `pk_newsletter_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int DEFAULT NULL,
  `fk_club_id` int NOT NULL,
  `Title` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `PublishDateTime` datetime NOT NULL,
  `ExpiryDateTime` datetime NOT NULL,
  `AttachmentType` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT 'link',
  `LinkUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FilePath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsSendWhatsapp` tinyint(1) DEFAULT '0',
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'Unpublished',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `PushNotificationSent` tinyint(1) DEFAULT '0',
  `PushNotificationSentAt` datetime DEFAULT NULL,
  `Scope` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'district',
  `RecipientTarget` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RecipientZoneIds` text COLLATE utf8mb4_unicode_ci,
  `RecipientDistrictIds` text COLLATE utf8mb4_unicode_ci,
  `RecipientSubgroupIds` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `WhatsAppSentDate` datetime DEFAULT NULL,
  `WhatsAppSentCount` int NOT NULL DEFAULT '0',
  `WhatsAppFailedCount` int NOT NULL DEFAULT '0',
  `IsSendEmail` tinyint(1) NOT NULL DEFAULT '0',
  `EmailSentDate` datetime DEFAULT NULL,
  `EmailSentCount` int NOT NULL DEFAULT '0',
  `EmailFailedCount` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_newsletter_id`),
  KEY `fk_club_id` (`fk_club_id`),
  KEY `idx_nl_wa_pending` (`IsSendWhatsapp`,`WhatsAppSentDate`,`PublishDateTime`),
  KEY `idx_nl_email_pending` (`IsSendEmail`,`EmailSentDate`,`PublishDateTime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ocv_document_category` (
  `pk_category_id` int NOT NULL AUTO_INCREMENT,
  `CategoryName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `CategoryCode` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `IconClass` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SortOrder` int DEFAULT '0',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_category_id`),
  UNIQUE KEY `uk_category_code` (`CategoryCode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ocv_document_type` (
  `pk_type_id` int NOT NULL AUTO_INCREMENT,
  `fk_category_id` int NOT NULL,
  `TypeName` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `AllowMultiple` tinyint(1) DEFAULT '0',
  `SortOrder` int DEFAULT '0',
  `IsActive` tinyint(1) DEFAULT '1',
  `isdeleted` tinyint(1) DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_type_id`),
  KEY `fk_category_id` (`fk_category_id`),
  CONSTRAINT `ocv_document_type_ibfk_1` FOREIGN KEY (`fk_category_id`) REFERENCES `ocv_document_category` (`pk_category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ocv_documents` (
  `pk_document_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_category_id` int NOT NULL,
  `fk_type_id` int NOT NULL,
  `FileName` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `OriginalFileName` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FilePath` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FileSize` bigint DEFAULT '0',
  `CustomTypeName` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Amount` decimal(15,2) DEFAULT NULL,
  `PaidOn` date DEFAULT NULL,
  `UploadedBy` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_document_id`),
  KEY `fk_club_id` (`fk_club_id`),
  KEY `fk_year_id` (`fk_year_id`),
  KEY `fk_category_id` (`fk_category_id`),
  KEY `fk_type_id` (`fk_type_id`),
  CONSTRAINT `ocv_documents_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`),
  CONSTRAINT `ocv_documents_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`),
  CONSTRAINT `ocv_documents_ibfk_3` FOREIGN KEY (`fk_category_id`) REFERENCES `ocv_document_category` (`pk_category_id`),
  CONSTRAINT `ocv_documents_ibfk_4` FOREIGN KEY (`fk_type_id`) REFERENCES `ocv_document_type` (`pk_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_reset_tokens` (
  `pk_password_reset_token_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_master_profile_id` int NOT NULL,
  `Token` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ExpiryDate` datetime NOT NULL,
  `IsUsed` tinyint(1) DEFAULT '0',
  `UsedDate` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_password_reset_token_id`),
  KEY `idx_reset_token` (`Token`,`IsUsed`,`ExpiryDate`),
  KEY `idx_reset_member` (`fk_member_master_profile_id`,`IsUsed`),
  CONSTRAINT `password_reset_tokens_ibfk_1` FOREIGN KEY (`fk_member_master_profile_id`) REFERENCES `member_master_profile` (`pk_member_master_profile_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `past_presidents` (
  `pk_past_president_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_member_master_profile_id` int DEFAULT NULL,
  `non_member_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `non_member_photo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_year_id` int NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_past_president_id`),
  UNIQUE KEY `uk_club_year` (`fk_club_id`,`fk_year_id`),
  KEY `fk_member_master_profile_id` (`fk_member_master_profile_id`),
  KEY `fk_year_id` (`fk_year_id`),
  KEY `idx_pp_club` (`fk_club_id`,`isdeleted`,`fk_year_id`),
  CONSTRAINT `past_presidents_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`),
  CONSTRAINT `past_presidents_ibfk_2` FOREIGN KEY (`fk_member_master_profile_id`) REFERENCES `member_master_profile` (`pk_member_master_profile_id`),
  CONSTRAINT `past_presidents_ibfk_3` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `potential_members` (
  `pk_potential_member_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mobile_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reference_details` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_member_master_profile_id_as_referrer` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_potential_member_id`),
  KEY `fk_club_id` (`fk_club_id`),
  KEY `fk_member_master_profile_id_as_referrer` (`fk_member_master_profile_id_as_referrer`),
  CONSTRAINT `potential_members_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`),
  CONSTRAINT `potential_members_ibfk_2` FOREIGN KEY (`fk_member_master_profile_id_as_referrer`) REFERENCES `member_master_profile` (`pk_member_master_profile_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pph_camp_attendance` (
  `pk_attendance_id` int NOT NULL AUTO_INCREMENT,
  `fk_camp_id` int NOT NULL,
  `fk_attendee_id` int DEFAULT NULL,
  `RegistrationNo` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Age` int DEFAULT NULL,
  `BPSystolic` int DEFAULT NULL,
  `BPDiastolic` int DEFAULT NULL,
  `BloodSugarType` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BloodSugarValue` decimal(10,2) DEFAULT NULL,
  `HeightCm` decimal(10,2) DEFAULT NULL,
  `WeightKg` decimal(10,2) DEFAULT NULL,
  `BMI` decimal(10,2) DEFAULT NULL,
  `DiabetesStatus` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BPStatus` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsOverweight` tinyint(1) DEFAULT '0',
  `IsObese` tinyint(1) DEFAULT '0',
  `IsConsentedForMessages` tinyint(1) DEFAULT '0',
  `Remarks` text COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_attendance_id`),
  KEY `fk_camp_id` (`fk_camp_id`),
  CONSTRAINT `pph_camp_attendance_ibfk_1` FOREIGN KEY (`fk_camp_id`) REFERENCES `pph_camps` (`pk_camp_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pph_camp_attendies` (
  `pk_attendee_id` int NOT NULL AUTO_INCREMENT,
  `fk_camp_id` int NOT NULL,
  `Name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `MobileNo` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Sex` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Address` text COLLATE utf8mb4_unicode_ci,
  `IsConsentedForMessages` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_attendee_id`),
  KEY `idx_pph_attendee_camp_mobile` (`fk_camp_id`,`MobileNo`),
  CONSTRAINT `pph_camp_attendies_ibfk_1` FOREIGN KEY (`fk_camp_id`) REFERENCES `pph_camps` (`pk_camp_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pph_camps` (
  `pk_camp_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int DEFAULT NULL,
  `fk_district_id` int DEFAULT NULL,
  `Title` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` text COLLATE utf8mb4_unicode_ci,
  `Address` text COLLATE utf8mb4_unicode_ci,
  `CampDate` date NOT NULL,
  `CampLogoPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_camp_id`),
  KEY `fk_club_id` (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_push_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_project_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `fk_member_master_profile_id` int NOT NULL,
  `FcmToken` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FirebaseMessageId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ErrorMessage` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SentAt` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `idx_project` (`fk_project_id`,`fk_year_id`),
  KEY `idx_member_status` (`fk_member_master_profile_id`,`Status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `razorpay_route_accounts` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `AccountId` varchar(50) NOT NULL,
  `Name` varchar(150) NOT NULL,
  `IsActive` tinyint(1) NOT NULL DEFAULT '1',
  `Notes` varchar(500) DEFAULT NULL,
  `Status` varchar(50) DEFAULT NULL,
  `StakeholderId` varchar(80) DEFAULT NULL,
  `ProductConfigId` varchar(80) DEFAULT NULL,
  `RazorpayJson` longtext,
  `StatusRefreshedDate` datetime DEFAULT NULL,
  `BankAccountLast4` varchar(10) DEFAULT NULL,
  `BankIfsc` varchar(15) DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  KEY `ix_rra_active` (`IsActive`,`isdeleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `razorpay_settlements` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `RazorpayPaymentId` varchar(100) NOT NULL,
  `RazorpayOrderId` varchar(100) DEFAULT NULL,
  `SettlementId` varchar(100) DEFAULT NULL,
  `SettlementUtr` varchar(100) DEFAULT NULL,
  `SettlementAmount` decimal(12,2) DEFAULT NULL,
  `SettlementStatus` varchar(30) DEFAULT NULL,
  `SettlementDate` datetime DEFAULT NULL,
  `LinkedAccountId` varchar(50) DEFAULT NULL,
  `RawJson` longtext,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `ux_rs_payment` (`RazorpayPaymentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ri_director_credential_email` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_member_id` int NOT NULL,
  `IssuesPassword` tinyint(1) NOT NULL DEFAULT '0',
  `SentCount` int NOT NULL DEFAULT '0',
  `LastSentDate` datetime DEFAULT NULL,
  `LastSentBy` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_ri_cred_member` (`fk_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ri_director_credit_usage_history` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `CreditType` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `DeductedCount` int NOT NULL DEFAULT '0',
  `Source` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `SourceId` int DEFAULT NULL,
  `SourceDetail` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BalanceBefore` int NOT NULL DEFAULT '0',
  `BalanceAfter` int NOT NULL DEFAULT '0',
  `created_by` int DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ri_director_credits` (
  `pk_credit_id` int NOT NULL AUTO_INCREMENT,
  `CreditType` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `CreditCount` int NOT NULL DEFAULT '0',
  `UsedCount` int NOT NULL DEFAULT '0',
  `PreviousCount` int DEFAULT '0',
  `FromDate` date NOT NULL,
  `ToDate` date NOT NULL,
  `TransactionId` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PaymentDate` date DEFAULT NULL,
  `ProofDocumentPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_credit_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `pk_role_id` int NOT NULL AUTO_INCREMENT,
  `RoleName` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `isdeleted` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_role_id`),
  UNIQUE KEY `RoleName` (`RoleName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rotary_org_club_members_cache` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_rotary_club_id` int NOT NULL,
  `RotaryMemberId` bigint NOT NULL,
  `LocalizedName` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Prefix` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FirstName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MiddleName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LastName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Suffix` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AdmissionDate` date DEFAULT NULL,
  `TerminationDate` date DEFAULT NULL,
  `BirthYear` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MemberType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LastFetchedUtc` datetime NOT NULL,
  `Email` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Mobile` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `DateOfBirth` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Gender` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PrimaryLanguage` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AddressLine` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `City` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `State` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Country` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PostalCode` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_club_member` (`fk_rotary_club_id`,`RotaryMemberId`),
  KEY `idx_club` (`fk_rotary_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rotary_org_clubs_cache` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `RotaryClubId` int NOT NULL,
  `ClubName` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ClubType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `DistrictNumber` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Country` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `CharterDate` date DEFAULT NULL,
  `NumberOfActiveMembers` int DEFAULT NULL,
  `Latitude` double DEFAULT NULL,
  `Longitude` double DEFAULT NULL,
  `Website` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Email` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AddressLine1` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `City` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `State` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PostalCode` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LastFetchedUtc` datetime NOT NULL,
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_rotary_club_id` (`RotaryClubId`),
  KEY `idx_district` (`DistrictNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rotary_org_project_sync_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_project_id` int NOT NULL,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int DEFAULT NULL,
  `projects_table` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fk_member_id` int DEFAULT NULL,
  `client_ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `ix_club_project` (`fk_club_id`,`fk_project_id`),
  KEY `ix_created` (`created_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rotary_org_sync_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `SyncType` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `StartedAtUtc` datetime NOT NULL,
  `FinishedAtUtc` datetime DEFAULT NULL,
  `TotalFetched` int DEFAULT '0',
  `InsertedCount` int DEFAULT '0',
  `UpdatedCount` int DEFAULT '0',
  `DisabledCount` int DEFAULT '0',
  `SkippedDistrictMissing` int DEFAULT '0',
  `ErrorCount` int DEFAULT '0',
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'Running',
  `ErrorDetail` text COLLATE utf8mb4_unicode_ci,
  `TriggeredBy` int DEFAULT NULL,
  `isdeleted` tinyint(1) DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `idx_ros_log_started` (`StartedAtUtc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rotary_org_terminated_cache` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_rotary_club_id` int NOT NULL,
  `RotaryMemberId` bigint NOT NULL,
  `LocalizedName` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Prefix` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FirstName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MiddleName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LastName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Suffix` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AdmissionDate` date DEFAULT NULL,
  `TerminationDate` date DEFAULT NULL,
  `TerminationReason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MemberType` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LastFetchedUtc` datetime NOT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `idx_club` (`fk_rotary_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rotary_project_audit_log` (
  `pk_audit_id` int NOT NULL AUTO_INCREMENT,
  `fk_project_id` int NOT NULL,
  `fk_club_id` int DEFAULT NULL,
  `action_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `field_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `old_value` text COLLATE utf8mb4_unicode_ci,
  `new_value` text COLLATE utf8mb4_unicode_ci,
  `action_by` int DEFAULT NULL,
  `action_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_audit_id`),
  KEY `idx_audit_project` (`fk_project_id`),
  KEY `idx_audit_club` (`fk_club_id`),
  KEY `idx_audit_date` (`action_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rotary_project_photos` (
  `pk_photo_id` int NOT NULL AUTO_INCREMENT,
  `fk_project_id` int NOT NULL,
  `image_path` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_primary` tinyint(1) DEFAULT '0',
  `sort_order` int DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_photo_id`),
  KEY `idx_photos_project` (`fk_project_id`),
  CONSTRAINT `rotary_project_photos_ibfk_1` FOREIGN KEY (`fk_project_id`) REFERENCES `rotary_projects` (`pk_project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rotary_projects` (
  `pk_project_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_district_id` int DEFAULT NULL,
  `fk_module_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `project_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'one_time',
  `parent_project_id` int DEFAULT NULL,
  `ongoing_group_title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_joint_project` tinyint(1) DEFAULT '0',
  `co_host_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `club_role` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_area_of_focus_id` int DEFAULT NULL,
  `other_area_of_focus` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_category_id` int DEFAULT NULL,
  `other_category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_sub_category_id` int DEFAULT NULL,
  `other_sub_category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `project_date` date DEFAULT NULL,
  `project_cost` decimal(15,2) DEFAULT NULL,
  `fk_funding_id` int DEFAULT NULL,
  `direct_beneficiaries` int DEFAULT NULL,
  `man_hours` int DEFAULT NULL,
  `rotarians_involved` int DEFAULT NULL,
  `rotaractors_involved` int DEFAULT NULL,
  `rcc_involved` int DEFAULT '0',
  `send_whatsapp` tinyint(1) DEFAULT '0',
  `meeting_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `agenda_document` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `minutes_document` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attendance` int DEFAULT NULL,
  `attendance_percentage` decimal(5,2) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `global_grant_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount_sanctioned` decimal(15,2) DEFAULT NULL,
  `amount_received` decimal(15,2) DEFAULT NULL,
  `amount_spent` decimal(15,2) DEFAULT NULL,
  `host_clubs_districts` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `global_partner_clubs_districts` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `csr_company_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsSendWhatsapp` tinyint(1) NOT NULL DEFAULT '0',
  `WhatsAppSentDate` datetime DEFAULT NULL,
  `WhatsAppSentCount` int NOT NULL DEFAULT '0',
  `WhatsAppFailedCount` int NOT NULL DEFAULT '0',
  `IsSendEmail` tinyint(1) NOT NULL DEFAULT '0',
  `EmailSentDate` datetime DEFAULT NULL,
  `EmailSentCount` int NOT NULL DEFAULT '0',
  `EmailFailedCount` int NOT NULL DEFAULT '0',
  `approval_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approval_remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approved_by` int DEFAULT NULL,
  `approval_date` datetime DEFAULT NULL,
  `approval_token` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `DistrictProjectType` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`pk_project_id`),
  KEY `fk_module_id` (`fk_module_id`),
  KEY `fk_year_id` (`fk_year_id`),
  KEY `fk_area_of_focus_id` (`fk_area_of_focus_id`),
  KEY `fk_category_id` (`fk_category_id`),
  KEY `fk_sub_category_id` (`fk_sub_category_id`),
  KEY `fk_funding_id` (`fk_funding_id`),
  KEY `idx_projects_club_year_module` (`fk_club_id`,`fk_year_id`,`fk_module_id`,`isdeleted`),
  KEY `idx_projects_parent` (`parent_project_id`),
  KEY `idx_projects_date` (`project_date`),
  KEY `idx_proj_wa_pending` (`IsSendWhatsapp`,`WhatsAppSentDate`),
  KEY `idx_projects_approval_token` (`approval_token`),
  KEY `idx_projects_approval_status` (`approval_status`),
  CONSTRAINT `rotary_projects_ibfk_3` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`),
  CONSTRAINT `rotary_projects_ibfk_4` FOREIGN KEY (`parent_project_id`) REFERENCES `rotary_projects` (`pk_project_id`),
  CONSTRAINT `rotary_projects_ibfk_5` FOREIGN KEY (`fk_area_of_focus_id`) REFERENCES `area_of_focus_master` (`pk_area_of_focus_id`),
  CONSTRAINT `rotary_projects_ibfk_6` FOREIGN KEY (`fk_category_id`) REFERENCES `category_master` (`pk_category_id`),
  CONSTRAINT `rotary_projects_ibfk_7` FOREIGN KEY (`fk_sub_category_id`) REFERENCES `sub_category_master` (`pk_sub_category_id`),
  CONSTRAINT `rotary_projects_ibfk_8` FOREIGN KEY (`fk_funding_id`) REFERENCES `funding_master` (`pk_funding_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_project_after_insert` AFTER INSERT ON `rotary_projects` FOR EACH ROW BEGIN
                        INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                        VALUES (NEW.pk_project_id, NEW.fk_club_id, 'INSERT', 'title', NULL, NEW.title, NEW.created_by, NOW());
                    END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER `trg_project_after_update` AFTER UPDATE ON `rotary_projects` FOR EACH ROW BEGIN
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
                            IF OLD.fk_category_id != NEW.fk_category_id OR (OLD.fk_category_id IS NULL AND NEW.fk_category_id IS NOT NULL) OR (OLD.fk_category_id IS NOT NULL AND NEW.fk_category_id IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'category', CAST(OLD.fk_category_id AS CHAR), CAST(NEW.fk_category_id AS CHAR), NEW.modified_by, NOW());
                            END IF;
                            IF OLD.fk_sub_category_id != NEW.fk_sub_category_id OR (OLD.fk_sub_category_id IS NULL AND NEW.fk_sub_category_id IS NOT NULL) OR (OLD.fk_sub_category_id IS NOT NULL AND NEW.fk_sub_category_id IS NULL) THEN
                                INSERT INTO rotary_project_audit_log (fk_project_id, fk_club_id, action_type, field_name, old_value, new_value, action_by, action_date)
                                VALUES (NEW.pk_project_id, NEW.fk_club_id, 'UPDATE', 'sub_category', CAST(OLD.fk_sub_category_id AS CHAR), CAST(NEW.fk_sub_category_id AS CHAR), NEW.modified_by, NOW());
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
                    END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rotary_year_master` (
  `pk_year_id` int NOT NULL AUTO_INCREMENT,
  `YearLabel` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `StartDate` date NOT NULL,
  `EndDate` date NOT NULL,
  `IsCurrent` tinyint(1) DEFAULT '0',
  `isdeleted` tinyint(1) DEFAULT '0',
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_year_id`),
  UNIQUE KEY `YearLabel` (`YearLabel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `route_maintenance` (
  `pk_route_maintenance_id` int NOT NULL AUTO_INCREMENT,
  `RouteKey` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Label` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsUnderMaintenance` tinyint(1) NOT NULL DEFAULT '0',
  `Message` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MaintenanceUntil` datetime DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  PRIMARY KEY (`pk_route_maintenance_id`),
  UNIQUE KEY `RouteKey` (`RouteKey`),
  KEY `idx_under_maintenance` (`IsUnderMaintenance`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sub_category_master` (
  `pk_sub_category_id` int NOT NULL AUTO_INCREMENT,
  `fk_category_id` int NOT NULL,
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_sub_category_id`),
  KEY `fk_category_id` (`fk_category_id`),
  CONSTRAINT `sub_category_master_ibfk_1` FOREIGN KEY (`fk_category_id`) REFERENCES `category_master` (`pk_category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sub_group_members` (
  `pk_sub_group_member_id` int NOT NULL AUTO_INCREMENT,
  `fk_sub_group_id` int NOT NULL,
  `fk_member_master_profile_id` int NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_sub_group_member_id`),
  KEY `fk_sub_group_id` (`fk_sub_group_id`),
  KEY `fk_member_master_profile_id` (`fk_member_master_profile_id`),
  CONSTRAINT `sub_group_members_ibfk_1` FOREIGN KEY (`fk_sub_group_id`) REFERENCES `sub_groups` (`pk_sub_group_id`),
  CONSTRAINT `sub_group_members_ibfk_2` FOREIGN KEY (`fk_member_master_profile_id`) REFERENCES `member_master_profile` (`pk_member_master_profile_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sub_groups` (
  `pk_sub_group_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int DEFAULT NULL,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `GroupName` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `Scope` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'district',
  PRIMARY KEY (`pk_sub_group_id`),
  KEY `fk_club_id` (`fk_club_id`),
  KEY `fk_year_id` (`fk_year_id`),
  CONSTRAINT `sub_groups_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `superadmin_audit` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_target_member_id` int NOT NULL,
  `fk_by_member_id` int NOT NULL,
  `Action` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `OtpSentTo` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IpAddress` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `TimestampUtc` datetime DEFAULT CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  KEY `idx_sa_audit_target` (`fk_target_member_id`),
  KEY `idx_sa_audit_by` (`fk_by_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sync_exception_log` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `exception_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rotary_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rotary_org_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `field_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `conflict_value` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `conflict_with_member_pk` int DEFAULT NULL,
  `conflict_with_member_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `admin_message` text COLLATE utf8mb4_unicode_ci,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `raw_payload` text COLLATE utf8mb4_unicode_ci,
  `fk_club_id` int DEFAULT NULL,
  `fk_member_master_profile_id` int DEFAULT NULL,
  `is_resolved` tinyint(1) NOT NULL DEFAULT '0',
  `resolved_by` int DEFAULT NULL,
  `resolved_date` datetime DEFAULT NULL,
  `resolution_notes` text COLLATE utf8mb4_unicode_ci,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`),
  KEY `idx_sync_unresolved` (`is_resolved`,`created_date`),
  KEY `idx_sync_rotary_id` (`rotary_id`),
  KEY `idx_sync_type` (`exception_type`),
  KEY `idx_sync_club` (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_settings` (
  `pk_setting_id` int NOT NULL AUTO_INCREMENT,
  `SettingKey` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `SettingValue` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_setting_id`),
  UNIQUE KEY `SettingKey` (`SettingKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `theme_master` (
  `pk_theme_id` int NOT NULL AUTO_INCREMENT,
  `theme_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `theme_image_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_theme_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `training_date_overrides` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `OverrideDate` date NOT NULL,
  `IsUnavailableAllDay` tinyint(1) NOT NULL DEFAULT '0',
  `StartTime` time DEFAULT NULL,
  `EndTime` time DEFAULT NULL,
  `Reason` varchar(200) DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  KEY `ix_tdo_date` (`OverrideDate`,`isdeleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `training_weekly_hours` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `DayOfWeek` tinyint NOT NULL,
  `StartTime` time NOT NULL,
  `EndTime` time NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  KEY `ix_twh_day` (`DayOfWeek`,`isdeleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `trf_contributions` (
  `pk_trf_id` int NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `TrfDate` datetime NOT NULL,
  `DonorName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `AmountUSD` decimal(15,2) NOT NULL,
  `fk_fund_id` int NOT NULL,
  `FundType` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `OtherFundName` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_trf_id`),
  KEY `fk_club_id` (`fk_club_id`),
  KEY `fk_year_id` (`fk_year_id`),
  KEY `fk_fund_id` (`fk_fund_id`),
  CONSTRAINT `trf_contributions_ibfk_1` FOREIGN KEY (`fk_club_id`) REFERENCES `club_master` (`pk_club_id`),
  CONSTRAINT `trf_contributions_ibfk_2` FOREIGN KEY (`fk_year_id`) REFERENCES `rotary_year_master` (`pk_year_id`),
  CONSTRAINT `trf_contributions_ibfk_3` FOREIGN KEY (`fk_fund_id`) REFERENCES `trf_fund_master` (`pk_fund_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `trf_fund_master` (
  `pk_fund_id` int NOT NULL AUTO_INCREMENT,
  `FundName` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `SortOrder` int DEFAULT '0',
  `IsActive` tinyint(1) DEFAULT '1',
  `isdeleted` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_fund_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `upcoming_event_reminders` (
  `pk_reminder_id` int NOT NULL AUTO_INCREMENT,
  `fk_upcoming_event_id` int NOT NULL,
  `ReminderDateTime` datetime NOT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `PushSentAt` datetime DEFAULT NULL,
  `WhatsAppSentDate` datetime DEFAULT NULL,
  `WhatsAppSentCount` int NOT NULL DEFAULT '0',
  `WhatsAppFailedCount` int NOT NULL DEFAULT '0',
  `EmailSentDate` datetime DEFAULT NULL,
  `EmailSentCount` int NOT NULL DEFAULT '0',
  `EmailFailedCount` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_reminder_id`),
  KEY `fk_upcoming_event_id` (`fk_upcoming_event_id`),
  CONSTRAINT `upcoming_event_reminders_ibfk_1` FOREIGN KEY (`fk_upcoming_event_id`) REFERENCES `upcoming_events` (`pk_upcoming_event_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `upcoming_events` (
  `pk_upcoming_event_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int DEFAULT NULL,
  `fk_club_id` int NOT NULL,
  `Title` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ImagePath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EventDate` datetime NOT NULL,
  `PublishDate` datetime NOT NULL,
  `ExpiryDate` datetime NOT NULL,
  `EventVenue` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RegistrationLink` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `IsSendWhatsapp` tinyint(1) DEFAULT '0',
  `IsRepeatNotification` tinyint(1) DEFAULT '0',
  `Status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'Unpublished',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `PushNotificationSent` tinyint(1) DEFAULT '0',
  `PushNotificationSentAt` datetime DEFAULT NULL,
  `Scope` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'district',
  `RecipientTarget` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RecipientZoneIds` text COLLATE utf8mb4_unicode_ci,
  `RecipientDistrictIds` text COLLATE utf8mb4_unicode_ci,
  `RecipientSubgroupIds` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `WhatsAppSentDate` datetime DEFAULT NULL,
  `WhatsAppSentCount` int NOT NULL DEFAULT '0',
  `WhatsAppFailedCount` int NOT NULL DEFAULT '0',
  `IsSendEmail` tinyint(1) NOT NULL DEFAULT '0',
  `EmailSentDate` datetime DEFAULT NULL,
  `EmailSentCount` int NOT NULL DEFAULT '0',
  `EmailFailedCount` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_upcoming_event_id`),
  KEY `idx_evt_wa_pending` (`IsSendWhatsapp`,`WhatsAppSentDate`,`PublishDate`),
  KEY `idx_evt_email_pending` (`IsSendEmail`,`EmailSentDate`,`PublishDate`),
  KEY `idx_events_club_active_date` (`fk_club_id`,`IsActive`,`isdeleted`,`Status`,`EventDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wallet_topup_orders` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_district_id` int NOT NULL,
  `fk_club_id` int NOT NULL DEFAULT '0',
  `ScopeType` varchar(20) NOT NULL,
  `CreditType` varchar(20) NOT NULL,
  `BaseAmount` decimal(12,2) NOT NULL,
  `GstAmount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `TotalAmount` decimal(12,2) NOT NULL,
  `CreditCount` int NOT NULL,
  `RatePaise` int NOT NULL,
  `Currency` varchar(10) NOT NULL DEFAULT 'INR',
  `RazorpayOrderId` varchar(100) DEFAULT NULL,
  `RazorpayPaymentId` varchar(100) DEFAULT NULL,
  `RazorpaySignature` varchar(255) DEFAULT NULL,
  `PaymentStatus` varchar(30) NOT NULL DEFAULT 'CREATED',
  `IsCredited` tinyint(1) NOT NULL DEFAULT '0',
  `CreditedDate` datetime DEFAULT NULL,
  `FromDate` date DEFAULT NULL,
  `ToDate` date DEFAULT NULL,
  `IsWebhookReceived` tinyint(1) NOT NULL DEFAULT '0',
  `WebhookReceivedDate` datetime DEFAULT NULL,
  `fk_credit_id` int DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `ux_wallet_topup_rzp_order` (`RazorpayOrderId`),
  KEY `ix_wallet_topup_scope` (`fk_district_id`,`fk_club_id`,`CreditType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `weblinks` (
  `pk_weblink_id` int NOT NULL AUTO_INCREMENT,
  `fk_district_id` int DEFAULT NULL,
  `fk_club_id` int NOT NULL,
  `fk_parent_id` int DEFAULT NULL,
  `Level` int NOT NULL DEFAULT '1',
  `Title` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Writeup` text COLLATE utf8mb4_unicode_ci,
  `LogoPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `BannerPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LinkType` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'None',
  `LinkUrl` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PdfPath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `YoutubeUrl` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ButtonText` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `SortOrder` int DEFAULT '0',
  `IsActive` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  `Scope` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'district',
  `RecipientTarget` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `RecipientZoneIds` text COLLATE utf8mb4_unicode_ci,
  `RecipientDistrictIds` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`pk_weblink_id`),
  KEY `fk_club_id` (`fk_club_id`),
  KEY `fk_parent_id` (`fk_parent_id`),
  CONSTRAINT `weblinks_ibfk_2` FOREIGN KEY (`fk_parent_id`) REFERENCES `weblinks` (`pk_weblink_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `website_data_module_master` (
  `pk_website_data_module_id` int NOT NULL AUTO_INCREMENT,
  `module_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module_key` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `icon_class` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Globe',
  `sort_order` int DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_website_data_module_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `website_training_appointments` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `fk_club_id` int NOT NULL,
  `fk_district_id` int NOT NULL DEFAULT '0',
  `SlotStart` datetime NOT NULL,
  `DurationMinutes` int NOT NULL DEFAULT '30',
  `Status` varchar(20) NOT NULL DEFAULT 'Scheduled',
  `ZoomMeetingId` varchar(100) DEFAULT NULL,
  `ZoomJoinUrl` varchar(1000) DEFAULT NULL,
  `ZoomStartUrl` varchar(1000) DEFAULT NULL,
  `fk_booker_member_id` int NOT NULL,
  `RescheduleCount` int NOT NULL DEFAULT '0',
  `Notes` varchar(1000) DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL,
  `isdeleted` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  KEY `ix_wta_slot` (`SlotStart`,`isdeleted`),
  KEY `ix_wta_club` (`fk_club_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `whatsapp_log` (
  `pk_id` bigint NOT NULL AUTO_INCREMENT,
  `recipient_mobile` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipient_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `template_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `whatsapp_type` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_id` bigint DEFAULT NULL,
  `title` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fk_club_id` int DEFAULT NULL,
  `fk_district_id` int DEFAULT NULL,
  `fk_member_profile_id` int DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Sent',
  `interakt_message_id` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `http_status` int DEFAULT NULL,
  `error_message` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `body_preview` varchar(2000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `delivered_at` datetime DEFAULT NULL,
  `modified_at` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_id`),
  KEY `ix_wa_log_sent` (`sent_at`),
  KEY `ix_wa_log_mobile` (`recipient_mobile`),
  KEY `ix_wa_log_status` (`status`),
  KEY `ix_wa_log_source` (`whatsapp_type`,`source_id`),
  KEY `ix_wa_log_msgid` (`interakt_message_id`),
  KEY `ix_wa_log_club` (`fk_club_id`),
  KEY `ix_wa_log_district` (`fk_district_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `zonal_awards_district_entry` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_option_id` int NOT NULL,
  `fk_district_id` int NOT NULL,
  `fk_year_id` int NOT NULL,
  `month` int NOT NULL DEFAULT '0',
  `entered_counts` decimal(10,2) DEFAULT '0.00',
  `received_points` decimal(10,2) DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`),
  UNIQUE KEY `uk_za_entry` (`fk_option_id`,`fk_district_id`,`fk_year_id`,`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `zonal_awards_goal` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_year_id` int NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `max_points` int DEFAULT NULL,
  `max_remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `zonal_awards_import_log` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_year_id` int NOT NULL,
  `month` int NOT NULL,
  `file_name` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total_districts` int DEFAULT '0',
  `total_questions` int DEFAULT '0',
  `uploaded_by` int DEFAULT NULL,
  `uploaded_date` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `zonal_awards_question` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_goal_id` int NOT NULL,
  `auto_or_manual` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Auto',
  `question_level` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'District',
  `sr_no` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sub_title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `zonal_awards_question_option` (
  `pk_id` int NOT NULL AUTO_INCREMENT,
  `fk_question_id` int NOT NULL,
  `goal_requirement_label` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `points_label` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mini` int DEFAULT '0',
  `maxi` int DEFAULT '0',
  `points` int DEFAULT '0',
  `atleast` int DEFAULT '0',
  `subtype` int DEFAULT NULL,
  `input_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `question_type_for_import` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `report_use_title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `isdeleted` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`pk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `zone_master` (
  `pk_zone_id` int NOT NULL AUTO_INCREMENT,
  `ZoneName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `IsActive` tinyint(1) DEFAULT '1',
  `IsZonalAwardsEnabled` tinyint(1) DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `created_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `modified_by` int DEFAULT NULL,
  `modified_date` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `isdeleted` int DEFAULT '0',
  `deleted_by` int DEFAULT NULL,
  `deleted_date` datetime DEFAULT NULL,
  PRIMARY KEY (`pk_zone_id`),
  UNIQUE KEY `ZoneName` (`ZoneName`),
  KEY `idx_zone_active` (`isdeleted`,`IsActive`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_announcement_create`(
                IN p_ClubId INT,
                IN p_Title VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_ImagePath VARCHAR(500),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_IsDisplayOnBanner TINYINT,
                IN p_IsSendWhatsapp TINYINT,
                IN p_IsRepeatNotification TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO announcements (fk_club_id, Title, Description, ImagePath, PublishDateTime, ExpiryDateTime, IsDisplayOnBanner, IsSendWhatsapp, IsRepeatNotification, created_by)
                VALUES (p_ClubId, p_Title, p_Description, p_ImagePath, p_PublishDateTime, p_ExpiryDateTime, p_IsDisplayOnBanner, p_IsSendWhatsapp, p_IsRepeatNotification, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_announcement_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE announcements
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_announcement_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_announcement_get_all_paginated`(
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
                       a.IsSendWhatsapp,
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
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_announcement_get_by_id`(
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
                       a.IsSendWhatsapp,
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
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_announcement_get_years`(
                IN p_ClubId INT
            )
BEGIN
                SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent
                FROM rotary_year_master y
                INNER JOIN announcements a
                  ON a.PublishDateTime >= y.StartDate
                 AND a.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                WHERE a.fk_club_id = p_ClubId
                  AND a.isdeleted = 0
                ORDER BY y.pk_year_id DESC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_announcement_reminder_add`(
                IN p_AnnouncementId INT,
                IN p_ReminderDateTime DATETIME,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO announcement_reminders (fk_announcement_id, ReminderDateTime, created_by)
                VALUES (p_AnnouncementId, p_ReminderDateTime, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_announcement_reminder_delete`(
                IN p_Id INT
            )
BEGIN
                DELETE FROM announcement_reminders
                WHERE pk_reminder_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_announcement_update`(
                IN p_Id INT,
                IN p_Title VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_ImagePath VARCHAR(500),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_IsDisplayOnBanner TINYINT,
                IN p_IsSendWhatsapp TINYINT,
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
                    IsSendWhatsapp = p_IsSendWhatsapp,
                    IsRepeatNotification = p_IsRepeatNotification,
                    modified_by = p_ModifiedBy
                WHERE pk_announcement_id = p_Id
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_area_of_focus_create`(
                IN p_ModuleId INT,
                IN p_Name VARCHAR(200),
                IN p_ImagePath VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO area_of_focus_master (fk_module_id, name, image_path, sort_order, is_active, created_by)
                VALUES (p_ModuleId, p_Name, p_ImagePath, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_area_of_focus_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE area_of_focus_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_area_of_focus_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_area_of_focus_get_all`(IN p_ModuleId INT)
BEGIN
                SELECT a.pk_area_of_focus_id AS Id,
                       a.fk_module_id AS ModuleId,
                       m.ModuleName AS ModuleName,
                       a.name AS Name,
                       CASE
                           WHEN a.image_path IS NULL OR a.image_path = '' THEN NULL
                           WHEN a.image_path LIKE '/%' THEN a.image_path
                           ELSE CONCAT('/uploads/area-of-focus/', a.image_path)
                       END AS ImagePath,
                       a.sort_order AS SortOrder,
                       a.is_active AS IsActive
                FROM area_of_focus_master a
                LEFT JOIN module_master m ON m.pk_module_id = a.fk_module_id
                WHERE a.isdeleted = 0
                  AND (p_ModuleId IS NULL OR a.fk_module_id = p_ModuleId)
                ORDER BY a.sort_order, a.name;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_area_of_focus_get_by_id`(IN p_Id INT)
BEGIN
                SELECT a.pk_area_of_focus_id AS Id,
                       a.fk_module_id AS ModuleId,
                       m.ModuleName AS ModuleName,
                       a.name AS Name,
                       CASE
                           WHEN a.image_path IS NULL OR a.image_path = '' THEN NULL
                           WHEN a.image_path LIKE '/%' THEN a.image_path
                           ELSE CONCAT('/uploads/area-of-focus/', a.image_path)
                       END AS ImagePath,
                       a.sort_order AS SortOrder,
                       a.is_active AS IsActive
                FROM area_of_focus_master a
                LEFT JOIN module_master m ON m.pk_module_id = a.fk_module_id
                WHERE a.pk_area_of_focus_id = p_Id AND a.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_area_of_focus_update`(
                IN p_Id INT,
                IN p_ModuleId INT,
                IN p_Name VARCHAR(200),
                IN p_ImagePath VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE area_of_focus_master
                SET fk_module_id = p_ModuleId,
                    name = p_Name,
                    image_path = p_ImagePath,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_area_of_focus_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_attendance_create`(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_EventName VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_EventDateTime DATETIME,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO club_attendance (fk_club_id, fk_year_id, EventName, Description, EventDateTime, created_by, created_date)
                VALUES (p_ClubId, p_YearId, p_EventName, p_Description, p_EventDateTime, p_CreatedBy, NOW());
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_attendance_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE club_attendance SET
                    isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_attendance_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_attendance_update`(
                IN p_Id INT,
                IN p_EventName VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_EventDateTime DATETIME,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE club_attendance SET
                    EventName = p_EventName,
                    Description = p_Description,
                    EventDateTime = p_EventDateTime,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_attendance_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_change_password`(
                IN p_CredId INT,
                IN p_Hash VARCHAR(500)
            )
BEGIN
                UPDATE member_credentials
                SET PasswordHash = p_Hash,
                    IsTemporaryPassword = 0,
                    LastPasswordChangeDate = NOW()
                WHERE pk_member_credential_id = p_CredId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_check_admin_access`(
                IN p_MemberId INT
            )
BEGIN
                SELECT COUNT(*)
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = p_MemberId
                  AND mr.IsActive = 1
                  AND mr.isdeleted = 0
                  AND r.RoleName IN ('Admin', 'SuperAdmin', 'ZonalCoordinator');
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_create_reset_token`(
                IN p_MemberId INT,
                IN p_Token VARCHAR(500),
                IN p_Expiry DATETIME
            )
BEGIN
                INSERT INTO password_reset_tokens (
                    fk_member_master_profile_id, Token, ExpiryDate
                ) VALUES (
                    p_MemberId, p_Token, p_Expiry
                );
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_get_admin_roles`(
                IN p_MemberId INT
            )
BEGIN
                SELECT r.RoleName
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = p_MemberId
                  AND mr.IsActive = 1
                  AND mr.isdeleted = 0
                  AND r.RoleName IN ('Admin', 'SuperAdmin', 'ZonalCoordinator');
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_get_credentials`(
                IN p_MemberId INT
            )
BEGIN
                SELECT
                    pk_member_credential_id AS Id,
                    PasswordHash,
                    IsTemporaryPassword,
                    FailedLoginAttempts,
                    LockoutEndTime
                FROM member_credentials
                WHERE fk_member_master_profile_id = p_MemberId
                  AND IsActive = 1
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_get_credentials_for_change`(
                IN p_MemberId INT
            )
BEGIN
                SELECT
                    pk_member_credential_id AS Id,
                    PasswordHash
                FROM member_credentials
                WHERE fk_member_master_profile_id = p_MemberId
                  AND IsActive = 1
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_get_member_by_email`(
                IN p_Email VARCHAR(200)
            )
BEGIN
                SELECT
                    pk_member_master_profile_id AS Id,
                    MemberName,
                    EmailId
                FROM member_master_profile
                WHERE EmailId = p_Email
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_get_member_by_mobile`(
                IN p_CountryCode VARCHAR(10),
                IN p_MobileNumber VARCHAR(20)
            )
BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.MemberName,
                    m.EmailId
                FROM member_master_profile m
                JOIN country_master c ON c.pk_country_id = m.fk_primary_country_id
                WHERE c.PhoneCode = p_CountryCode
                  AND m.PrimaryMobileNumber = p_MobileNumber
                  AND m.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_get_valid_reset_token`(
                IN p_Token VARCHAR(500)
            )
BEGIN
                SELECT
                    pk_password_reset_token_id AS Id,
                    fk_member_master_profile_id AS MemberId
                FROM password_reset_tokens
                WHERE Token = p_Token
                  AND IsUsed = 0
                  AND ExpiryDate > NOW();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_mark_token_used`(
                IN p_TokenId INT
            )
BEGIN
                UPDATE password_reset_tokens
                SET IsUsed = 1,
                    UsedDate = NOW()
                WHERE pk_password_reset_token_id = p_TokenId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_reset_password`(
                IN p_MemberId INT,
                IN p_Hash VARCHAR(500)
            )
BEGIN
                UPDATE member_credentials
                SET PasswordHash = p_Hash,
                    IsTemporaryPassword = 0,
                    LastPasswordChangeDate = NOW(),
                    FailedLoginAttempts = 0,
                    LockoutEndTime = NULL
                WHERE fk_member_master_profile_id = p_MemberId
                  AND IsActive = 1
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_update_failed_login`(
                IN p_CredId INT,
                IN p_Attempts INT,
                IN p_Lockout DATETIME
            )
BEGIN
                UPDATE member_credentials
                SET FailedLoginAttempts = p_Attempts,
                    LockoutEndTime = p_Lockout
                WHERE pk_member_credential_id = p_CredId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_auth_update_success_login`(
                IN p_CredId INT
            )
BEGIN
                UPDATE member_credentials
                SET FailedLoginAttempts = 0,
                    LockoutEndTime = NULL,
                    LastLoginDate = NOW()
                WHERE pk_member_credential_id = p_CredId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_beneficiary_approval_approve`(
                IN p_Token VARCHAR(100),
                IN p_Remark VARCHAR(1000)
            )
BEGIN
                DECLARE v_ProjectId INT;
                DECLARE v_Requested INT;
                DECLARE v_Status VARCHAR(20);

                SELECT fk_project_id, requested_beneficiaries, status
                INTO v_ProjectId, v_Requested, v_Status
                FROM beneficiary_approval_requests
                WHERE approval_token = p_Token;

                IF v_Status != 'pending' THEN
                    SELECT v_Status AS Status, 'already_processed' AS Result;
                ELSE
                    UPDATE beneficiary_approval_requests
                    SET status = 'approved', remark = p_Remark, responded_date = NOW()
                    WHERE approval_token = p_Token;

                    UPDATE rotary_projects
                    SET direct_beneficiaries = v_Requested, modified_date = NOW()
                    WHERE pk_project_id = v_ProjectId;

                    SELECT 'approved' AS Status, 'success' AS Result;
                END IF;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_beneficiary_approval_create`(
                IN p_ProjectId INT,
                IN p_ZoneId INT,
                IN p_ClubId INT,
                IN p_RequestedBeneficiaries INT,
                IN p_CurrentLimit INT,
                IN p_Token VARCHAR(100),
                IN p_RequestedBy INT
            )
BEGIN
                INSERT INTO beneficiary_approval_requests
                    (fk_project_id, fk_zone_id, fk_club_id, requested_beneficiaries, current_limit, approval_token, status, requested_by)
                VALUES
                    (p_ProjectId, p_ZoneId, p_ClubId, p_RequestedBeneficiaries, p_CurrentLimit, p_Token, 'pending', p_RequestedBy);
                SELECT LAST_INSERT_ID() AS Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_beneficiary_approval_get_by_token`(
                IN p_Token VARCHAR(100)
            )
BEGIN
                SELECT
                    bar.pk_approval_id AS Id,
                    bar.fk_project_id AS ProjectId,
                    bar.fk_zone_id AS ZoneId,
                    bar.fk_club_id AS ClubId,
                    bar.requested_beneficiaries AS RequestedBeneficiaries,
                    bar.current_limit AS CurrentLimit,
                    bar.approval_token AS ApprovalToken,
                    bar.status AS Status,
                    bar.remark AS Remark,
                    bar.requested_by AS RequestedBy,
                    bar.responded_date AS RespondedDate,
                    bar.created_date AS CreatedDate,
                    p.title AS ProjectTitle,
                    p.description AS ProjectDescription,
                    p.project_date AS ProjectDate,
                    p.project_cost AS ProjectCost,
                    p.direct_beneficiaries AS CurrentBeneficiaries,
                    p.man_hours AS ManHours,
                    p.rotarians_involved AS RotariansInvolved,
                    p.rotaractors_involved AS RotaractorsInvolved,
                    c.ClubName,
                    d.DistrictNumber,
                    z.ZoneName,
                    m.MemberName AS RequestedByName,
                    m.EmailId AS RequestedByEmail,
                    m.PrimaryMobileNumber AS RequestedByMobile
                FROM beneficiary_approval_requests bar
                JOIN rotary_projects p ON p.pk_project_id = bar.fk_project_id
                JOIN club_master c ON c.pk_club_id = bar.fk_club_id
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                JOIN zone_master z ON z.pk_zone_id = bar.fk_zone_id
                JOIN member_master_profile m ON m.pk_member_master_profile_id = bar.requested_by
                WHERE bar.approval_token = p_Token;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_beneficiary_approval_reject`(
                IN p_Token VARCHAR(100),
                IN p_Remark VARCHAR(1000)
            )
BEGIN
                DECLARE v_Status VARCHAR(20);

                SELECT status INTO v_Status
                FROM beneficiary_approval_requests
                WHERE approval_token = p_Token;

                IF v_Status != 'pending' THEN
                    SELECT v_Status AS Status, 'already_processed' AS Result;
                ELSE
                    UPDATE beneficiary_approval_requests
                    SET status = 'rejected', remark = p_Remark, responded_date = NOW()
                    WHERE approval_token = p_Token;

                    SELECT 'rejected' AS Status, 'success' AS Result;
                END IF;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_board_director_create`(
                IN p_ClubId INT,
                IN p_MemberId INT,
                IN p_DesignationId INT,
                IN p_YearId INT,
                IN p_CreatedBy INT
            )
BEGIN
                DECLARE v_DesName VARCHAR(100);
                DECLARE v_OtherRole VARCHAR(100);
                DECLARE v_ErrMsg VARCHAR(200);
                SELECT designation_name INTO v_DesName FROM designation_master WHERE pk_designation_id = p_DesignationId AND isdeleted = 0;

                IF v_DesName IN ('Club President', 'Club Secretary') THEN
                    -- Only one President / one Secretary per club per year
                    IF EXISTS (
                        SELECT 1 FROM board_of_directors bd
                        INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                        WHERE bd.fk_club_id = p_ClubId
                        AND bd.fk_year_id = p_YearId
                        AND d.designation_name = v_DesName
                        AND bd.isdeleted = 0
                    ) THEN
                        SET v_ErrMsg = CONCAT('Only one ', v_DesName, ' is allowed per club per year.');
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_ErrMsg;
                    END IF;

                    -- Same member cannot be both President and Secretary for same club+year
                    SET v_OtherRole = IF(v_DesName = 'Club President', 'Club Secretary', 'Club President');
                    IF EXISTS (
                        SELECT 1 FROM board_of_directors bd
                        INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                        WHERE bd.fk_club_id = p_ClubId
                        AND bd.fk_year_id = p_YearId
                        AND bd.fk_member_master_profile_id = p_MemberId
                        AND d.designation_name = v_OtherRole
                        AND bd.isdeleted = 0
                    ) THEN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Same member cannot be both Club President and Club Secretary for the same year.';
                    END IF;
                END IF;

                INSERT INTO board_of_directors (fk_club_id, fk_member_master_profile_id, fk_designation_id, fk_year_id, created_by)
                VALUES (p_ClubId, p_MemberId, p_DesignationId, p_YearId, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_board_director_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE board_of_directors
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_board_director_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_board_director_get_by_club`(
                IN p_ClubId INT,
                IN p_YearId INT
            )
BEGIN
                SELECT
                    bd.pk_board_director_id AS Id,
                    bd.fk_club_id AS ClubId,
                    bd.fk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    bd.fk_designation_id AS DesignationId,
                    d.designation_name AS DesignationName,
                    bd.fk_year_id AS YearId,
                    y.YearLabel
                FROM board_of_directors bd
                INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
                INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                INNER JOIN rotary_year_master y ON y.pk_year_id = bd.fk_year_id
                WHERE bd.fk_club_id = p_ClubId AND bd.fk_year_id = p_YearId AND bd.isdeleted = 0
                ORDER BY d.sort_order;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_board_director_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT
                    bd.pk_board_director_id AS Id,
                    bd.fk_club_id AS ClubId,
                    bd.fk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    bd.fk_designation_id AS DesignationId,
                    d.designation_name AS DesignationName,
                    bd.fk_year_id AS YearId,
                    y.YearLabel
                FROM board_of_directors bd
                INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = bd.fk_member_master_profile_id
                INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                INNER JOIN rotary_year_master y ON y.pk_year_id = bd.fk_year_id
                WHERE bd.pk_board_director_id = p_Id AND bd.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_board_director_get_years_by_club`(
                IN p_ClubId INT
            )
BEGIN
                SELECT DISTINCT
                    y.pk_year_id AS Id,
                    y.YearLabel,
                    y.StartDate,
                    y.EndDate,
                    y.IsCurrent
                FROM board_of_directors bd
                INNER JOIN rotary_year_master y ON y.pk_year_id = bd.fk_year_id
                WHERE bd.fk_club_id = p_ClubId AND bd.isdeleted = 0
                ORDER BY y.StartDate DESC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_board_director_update`(
                IN p_Id INT,
                IN p_MemberId INT,
                IN p_DesignationId INT,
                IN p_YearId INT,
                IN p_ModifiedBy INT
            )
BEGIN
                DECLARE v_DesName VARCHAR(100);
                DECLARE v_OtherRole VARCHAR(100);
                DECLARE v_ErrMsg VARCHAR(200);
                DECLARE v_ClubId INT;
                SELECT fk_club_id INTO v_ClubId FROM board_of_directors WHERE pk_board_director_id = p_Id AND isdeleted = 0;
                SELECT designation_name INTO v_DesName FROM designation_master WHERE pk_designation_id = p_DesignationId AND isdeleted = 0;

                IF v_DesName IN ('Club President', 'Club Secretary') THEN
                    -- Only one President / one Secretary per club per year
                    IF EXISTS (
                        SELECT 1 FROM board_of_directors bd
                        INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                        WHERE bd.fk_club_id = v_ClubId
                        AND bd.fk_year_id = p_YearId
                        AND d.designation_name = v_DesName
                        AND bd.isdeleted = 0
                        AND bd.pk_board_director_id != p_Id
                    ) THEN
                        SET v_ErrMsg = CONCAT('Only one ', v_DesName, ' is allowed per club per year.');
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_ErrMsg;
                    END IF;

                    -- Same member cannot be both President and Secretary for same club+year
                    SET v_OtherRole = IF(v_DesName = 'Club President', 'Club Secretary', 'Club President');
                    IF EXISTS (
                        SELECT 1 FROM board_of_directors bd
                        INNER JOIN designation_master d ON d.pk_designation_id = bd.fk_designation_id
                        WHERE bd.fk_club_id = v_ClubId
                        AND bd.fk_year_id = p_YearId
                        AND bd.fk_member_master_profile_id = p_MemberId
                        AND d.designation_name = v_OtherRole
                        AND bd.isdeleted = 0
                        AND bd.pk_board_director_id != p_Id
                    ) THEN
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Same member cannot be both Club President and Club Secretary for the same year.';
                    END IF;
                END IF;

                UPDATE board_of_directors
                SET fk_member_master_profile_id = p_MemberId,
                    fk_designation_id = p_DesignationId,
                    fk_year_id = p_YearId,
                    modified_by = p_ModifiedBy
                WHERE pk_board_director_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_category_create`(
                IN p_AreaOfFocusId INT,
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO category_master (fk_area_of_focus_id, name, sort_order, is_active, created_by)
                VALUES (p_AreaOfFocusId, p_Name, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_category_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE category_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_category_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_category_get_by_area_of_focus`(IN p_AreaOfFocusId INT)
BEGIN
                SELECT pk_category_id AS Id,
                       fk_area_of_focus_id AS AreaOfFocusId,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM category_master
                WHERE fk_area_of_focus_id = p_AreaOfFocusId AND isdeleted = 0
                ORDER BY sort_order, name;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_category_get_by_id`(IN p_Id INT)
BEGIN
                SELECT pk_category_id AS Id,
                       fk_area_of_focus_id AS AreaOfFocusId,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM category_master
                WHERE pk_category_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_category_update`(
                IN p_Id INT,
                IN p_AreaOfFocusId INT,
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE category_master
                SET fk_area_of_focus_id = p_AreaOfFocusId,
                    name = p_Name,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_category_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_about_create`(
                IN p_ClubId INT,
                IN p_Content LONGTEXT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                DECLARE v_Existing INT DEFAULT 0;
                SELECT COUNT(*) INTO v_Existing
                FROM club_website_about
                WHERE fk_club_id = p_ClubId AND isdeleted = 0;

                IF v_Existing > 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'About content already exists for this club.';
                END IF;

                INSERT INTO club_website_about (fk_club_id, content, is_active, created_by)
                VALUES (p_ClubId, p_Content, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_about_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE club_website_about
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_about_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_about_get_by_club`(
                IN p_ClubId INT
            )
BEGIN
                SELECT a.pk_club_website_about_id AS Id,
                       a.fk_club_id AS ClubId,
                       a.content AS Content,
                       a.is_active AS IsActive
                FROM club_website_about a
                WHERE a.fk_club_id = p_ClubId AND a.isdeleted = 0
                ORDER BY a.modified_date DESC, a.created_date DESC, a.pk_club_website_about_id DESC
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_about_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT a.pk_club_website_about_id AS Id,
                       a.fk_club_id AS ClubId,
                       a.content AS Content,
                       a.is_active AS IsActive
                FROM club_website_about a
                WHERE a.pk_club_website_about_id = p_Id AND a.isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_about_update`(
                IN p_Id INT,
                IN p_Content LONGTEXT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE club_website_about
                SET content = p_Content,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_about_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_add_member`(
                IN p_ClubId INT,
                IN p_MemberId INT,
                IN p_JoinedDate DATE,
                IN p_CreatedBy INT
            )
BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM club_members
                    WHERE fk_club_id = p_ClubId
                      AND fk_member_master_profile_id = p_MemberId
                      AND isdeleted = 0
                ) THEN
                    INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, created_by, created_date)
                    VALUES (p_ClubId, p_MemberId, p_JoinedDate, 1, p_CreatedBy, NOW());
                    SELECT LAST_INSERT_ID() AS Id;
                ELSE
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Member is already in this club.';
                END IF;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_advertisement_create`(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_AdvertisementImagePath VARCHAR(500),
                IN p_DocumentPath VARCHAR(500),
                IN p_Description VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO club_website_advertisement (fk_club_id, fk_year_id, advertisement_image_path, document_path, description, sort_order, is_active, created_by)
                VALUES (p_ClubId, p_YearId, p_AdvertisementImagePath, p_DocumentPath, p_Description, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_advertisement_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE club_website_advertisement
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_advertisement_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_advertisement_get_by_club`(
                IN p_ClubId INT,
                IN p_YearId INT
            )
BEGIN
                SELECT a.pk_club_website_advertisement_id AS Id,
                       a.fk_club_id AS ClubId,
                       a.fk_year_id AS YearId,
                       y.YearLabel,
                       CASE
                           WHEN a.advertisement_image_path IS NULL OR a.advertisement_image_path = '' THEN NULL
                           WHEN a.advertisement_image_path LIKE '/%' THEN a.advertisement_image_path
                           ELSE CONCAT('/uploads/advertisement/', a.advertisement_image_path)
                       END AS AdvertisementImagePath,
                       CASE
                           WHEN a.document_path IS NULL OR a.document_path = '' THEN NULL
                           WHEN a.document_path LIKE '/%' THEN a.document_path
                           ELSE CONCAT('/uploads/advertisement/', a.document_path)
                       END AS DocumentPath,
                       a.description AS Description,
                       a.sort_order AS SortOrder,
                       a.is_active AS IsActive
                FROM club_website_advertisement a
                JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
                WHERE a.fk_club_id = p_ClubId AND a.fk_year_id = p_YearId AND a.isdeleted = 0
                ORDER BY a.sort_order ASC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_advertisement_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT a.pk_club_website_advertisement_id AS Id,
                       a.fk_club_id AS ClubId,
                       a.fk_year_id AS YearId,
                       y.YearLabel,
                       CASE
                           WHEN a.advertisement_image_path IS NULL OR a.advertisement_image_path = '' THEN NULL
                           WHEN a.advertisement_image_path LIKE '/%' THEN a.advertisement_image_path
                           ELSE CONCAT('/uploads/advertisement/', a.advertisement_image_path)
                       END AS AdvertisementImagePath,
                       CASE
                           WHEN a.document_path IS NULL OR a.document_path = '' THEN NULL
                           WHEN a.document_path LIKE '/%' THEN a.document_path
                           ELSE CONCAT('/uploads/advertisement/', a.document_path)
                       END AS DocumentPath,
                       a.description AS Description,
                       a.sort_order AS SortOrder,
                       a.is_active AS IsActive
                FROM club_website_advertisement a
                JOIN rotary_year_master y ON y.pk_year_id = a.fk_year_id
                WHERE a.pk_club_website_advertisement_id = p_Id AND a.isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_advertisement_reorder`(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM club_website_advertisement WHERE pk_club_website_advertisement_id = p_Id1;
                SELECT sort_order INTO v_Order2 FROM club_website_advertisement WHERE pk_club_website_advertisement_id = p_Id2;
                UPDATE club_website_advertisement SET sort_order = v_Order2 WHERE pk_club_website_advertisement_id = p_Id1;
                UPDATE club_website_advertisement SET sort_order = v_Order1 WHERE pk_club_website_advertisement_id = p_Id2;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_advertisement_update`(
                IN p_Id INT,
                IN p_AdvertisementImagePath VARCHAR(500),
                IN p_DocumentPath VARCHAR(500),
                IN p_Description VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE club_website_advertisement
                SET advertisement_image_path = p_AdvertisementImagePath,
                    document_path = p_DocumentPath,
                    description = p_Description,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_advertisement_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_banner_create`(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_BannerImagePath VARCHAR(500),
                IN p_Description VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO club_website_banner (fk_club_id, fk_year_id, banner_image_path, description, sort_order, is_active, created_by)
                VALUES (p_ClubId, p_YearId, p_BannerImagePath, p_Description, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_banner_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE club_website_banner
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_banner_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_banner_get_by_club`(
                IN p_ClubId INT,
                IN p_YearId INT
            )
BEGIN
                SELECT b.pk_club_website_banner_id AS Id,
                       b.fk_club_id AS ClubId,
                       b.fk_year_id AS YearId,
                       y.YearLabel,
                       CASE
                           WHEN b.banner_image_path IS NULL OR b.banner_image_path = '' THEN NULL
                           WHEN b.banner_image_path LIKE '/%' THEN b.banner_image_path
                           ELSE CONCAT('/uploads/banner/', b.banner_image_path)
                       END AS BannerImagePath,
                       b.description AS Description,
                       b.sort_order AS SortOrder,
                       b.is_active AS IsActive
                FROM club_website_banner b
                JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id
                WHERE b.fk_club_id = p_ClubId AND b.fk_year_id = p_YearId AND b.isdeleted = 0
                ORDER BY b.sort_order ASC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_banner_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT b.pk_club_website_banner_id AS Id,
                       b.fk_club_id AS ClubId,
                       b.fk_year_id AS YearId,
                       y.YearLabel,
                       CASE
                           WHEN b.banner_image_path IS NULL OR b.banner_image_path = '' THEN NULL
                           WHEN b.banner_image_path LIKE '/%' THEN b.banner_image_path
                           ELSE CONCAT('/uploads/banner/', b.banner_image_path)
                       END AS BannerImagePath,
                       b.description AS Description,
                       b.sort_order AS SortOrder,
                       b.is_active AS IsActive
                FROM club_website_banner b
                JOIN rotary_year_master y ON y.pk_year_id = b.fk_year_id
                WHERE b.pk_club_website_banner_id = p_Id AND b.isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_banner_reorder`(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM club_website_banner WHERE pk_club_website_banner_id = p_Id1;
                SELECT sort_order INTO v_Order2 FROM club_website_banner WHERE pk_club_website_banner_id = p_Id2;
                UPDATE club_website_banner SET sort_order = v_Order2 WHERE pk_club_website_banner_id = p_Id1;
                UPDATE club_website_banner SET sort_order = v_Order1 WHERE pk_club_website_banner_id = p_Id2;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_banner_update`(
                IN p_Id INT,
                IN p_BannerImagePath VARCHAR(500),
                IN p_Description VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE club_website_banner
                SET banner_image_path = p_BannerImagePath,
                    description = p_Description,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_banner_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_check_duplicate`(
                IN p_ClubName VARCHAR(300),
                IN p_ClubRotaryId VARCHAR(50),
                IN p_ExcludeId INT
            )
BEGIN
                SELECT
                    (SELECT COUNT(*) FROM club_master
                     WHERE isdeleted = 0
                       AND ClubName = p_ClubName
                       AND (p_ExcludeId IS NULL OR pk_club_id != p_ExcludeId)) AS NameDuplicate,
                    (SELECT COUNT(*) FROM club_master
                     WHERE isdeleted = 0
                       AND ClubRotaryId = p_ClubRotaryId
                       AND (p_ExcludeId IS NULL OR pk_club_id != p_ExcludeId)) AS RotaryIdDuplicate;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_contact_detail_create`(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_Email VARCHAR(200),
                IN p_Phone VARCHAR(20),
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                DECLARE v_Existing INT DEFAULT 0;
                SELECT COUNT(*) INTO v_Existing
                FROM club_website_contact_detail
                WHERE fk_club_id = p_ClubId AND fk_year_id = p_YearId AND isdeleted = 0;

                IF v_Existing > 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Contact detail already exists for this club and year.';
                END IF;

                INSERT INTO club_website_contact_detail (fk_club_id, fk_year_id, email, phone, is_active, created_by)
                VALUES (p_ClubId, p_YearId, p_Email, p_Phone, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_contact_detail_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE club_website_contact_detail
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_contact_detail_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_contact_detail_get_by_club`(
                IN p_ClubId INT,
                IN p_YearId INT
            )
BEGIN
                SELECT c.pk_club_website_contact_detail_id AS Id,
                       c.fk_club_id AS ClubId,
                       c.fk_year_id AS YearId,
                       y.YearLabel,
                       c.email AS Email,
                       c.phone AS Phone,
                       c.is_active AS IsActive
                FROM club_website_contact_detail c
                JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
                WHERE c.fk_club_id = p_ClubId AND c.fk_year_id = p_YearId AND c.isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_contact_detail_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT c.pk_club_website_contact_detail_id AS Id,
                       c.fk_club_id AS ClubId,
                       c.fk_year_id AS YearId,
                       y.YearLabel,
                       c.email AS Email,
                       c.phone AS Phone,
                       c.is_active AS IsActive
                FROM club_website_contact_detail c
                JOIN rotary_year_master y ON y.pk_year_id = c.fk_year_id
                WHERE c.pk_club_website_contact_detail_id = p_Id AND c.isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_contact_detail_update`(
                IN p_Id INT,
                IN p_Email VARCHAR(200),
                IN p_Phone VARCHAR(20),
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE club_website_contact_detail
                SET email = p_Email,
                    phone = p_Phone,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_contact_detail_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_create`(
                IN p_FkDistrictId INT,
                IN p_ClubRotaryId VARCHAR(50),
                IN p_ClubName VARCHAR(300),
                IN p_Timezone VARCHAR(100),
                IN p_ClubCharterDate DATE,
                IN p_ClubLogoPath VARCHAR(500),
                IN p_ClubWebsite VARCHAR(500),
                IN p_MeetingDay VARCHAR(20),
                IN p_MeetingFromTime TIME,
                IN p_MeetingToTime TIME,
                IN p_MeetingAddress TEXT,
                IN p_Country VARCHAR(100),
                IN p_State VARCHAR(100),
                IN p_City VARCHAR(100),
                IN p_Pincode VARCHAR(20),
                IN p_ActiveFromDate DATE,
                IN p_ActiveToDate DATE,
                IN p_IsAutomaticMeetingReminder TINYINT,
                IN p_IsFamilyLogin TINYINT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO club_master (
                    fk_district_id, ClubRotaryId, ClubName, Timezone, ClubCharterDate,
                    ClubLogoPath, ClubWebsite, MeetingDay, MeetingFromTime, MeetingToTime,
                    MeetingAddress, Country, State, City, Pincode,
                    ActiveFromDate, ActiveToDate, IsAutomaticMeetingReminder, IsFamilyLogin,
                    IsActive, created_by, created_date
                ) VALUES (
                    p_FkDistrictId, p_ClubRotaryId, p_ClubName, p_Timezone, p_ClubCharterDate,
                    p_ClubLogoPath, p_ClubWebsite, p_MeetingDay, p_MeetingFromTime, p_MeetingToTime,
                    p_MeetingAddress, p_Country, p_State, p_City, p_Pincode,
                    p_ActiveFromDate, p_ActiveToDate, p_IsAutomaticMeetingReminder, p_IsFamilyLogin,
                    p_IsActive, p_CreatedBy, NOW()
                );
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_dashboard_get`(
                IN p_ClubId INT
            )
BEGIN
                SELECT c.pk_club_id AS Id, c.ClubName,
                       CASE
                           WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                           WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                           ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                       END AS ClubLogoPath,
                       c.IsActive,
                       d.DistrictNumber
                FROM club_master c
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id = p_ClubId AND c.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_get_all_count`(
                IN p_Search VARCHAR(200),
                IN p_DistrictId INT,
                IN p_City VARCHAR(100),
                IN p_MeetingDay VARCHAR(20),
                IN p_IsActive INT,
                IN p_ZoneId INT
            )
BEGIN
                SELECT COUNT(*)
                FROM club_master c
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.isdeleted = 0
                  AND (p_Search IS NULL
                       OR c.ClubName LIKE CONCAT('%', p_Search, '%')
                       OR c.ClubRotaryId LIKE CONCAT('%', p_Search, '%')
                       OR d.DistrictNumber LIKE CONCAT('%', p_Search, '%'))
                  AND (p_DistrictId IS NULL OR c.fk_district_id = p_DistrictId)
                  AND (p_City IS NULL OR c.City = p_City)
                  AND (p_MeetingDay IS NULL OR c.MeetingDay = p_MeetingDay)
                  AND (p_IsActive IS NULL OR c.IsActive = p_IsActive)
                  AND (p_ZoneId IS NULL OR d.fk_zone_id = p_ZoneId);
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_get_all_paginated`(
                IN p_Search VARCHAR(200),
                IN p_DistrictId INT,
                IN p_City VARCHAR(100),
                IN p_MeetingDay VARCHAR(20),
                IN p_IsActive INT,
                IN p_PageSize INT,
                IN p_Offset INT,
                IN p_ZoneId INT
            )
BEGIN
                SELECT
                    c.pk_club_id AS Id,
                    c.fk_district_id AS FkDistrictId,
                    d.DistrictNumber,
                    c.ClubRotaryId,
                    c.ClubName,
                    CASE
                        WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                        WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                        ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                    END AS ClubLogoPath,
                    c.MeetingDay,
                    c.MeetingFromTime,
                    c.MeetingToTime,
                    c.City,
                    c.State,
                    c.IsActive,
                    c.created_date AS CreatedDate,
                    (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0) AS TotalMembers
                FROM club_master c
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.isdeleted = 0
                  AND (p_Search IS NULL
                       OR c.ClubName LIKE CONCAT('%', p_Search, '%')
                       OR c.ClubRotaryId LIKE CONCAT('%', p_Search, '%')
                       OR d.DistrictNumber LIKE CONCAT('%', p_Search, '%'))
                  AND (p_DistrictId IS NULL OR c.fk_district_id = p_DistrictId)
                  AND (p_City IS NULL OR c.City = p_City)
                  AND (p_MeetingDay IS NULL OR c.MeetingDay = p_MeetingDay)
                  AND (p_IsActive IS NULL OR c.IsActive = p_IsActive)
                  AND (p_ZoneId IS NULL OR d.fk_zone_id = p_ZoneId)
                ORDER BY c.pk_club_id DESC
                LIMIT p_PageSize OFFSET p_Offset;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT
                    c.pk_club_id AS Id,
                    c.fk_district_id AS FkDistrictId,
                    d.DistrictNumber,
                    c.ClubRotaryId,
                    c.ClubName,
                    c.Timezone,
                    c.ClubCharterDate,
                    CASE
                        WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                        WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                        ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                    END AS ClubLogoPath,
                    c.ClubWebsite,
                    c.MeetingDay,
                    c.MeetingFromTime,
                    c.MeetingToTime,
                    c.MeetingAddress,
                    c.Country,
                    c.State,
                    c.City,
                    c.Pincode,
                    c.ActiveFromDate,
                    c.ActiveToDate,
                    c.IsAutomaticMeetingReminder,
                    c.IsFamilyLogin,
                    c.IsActive,
                    c.created_by AS CreatedBy,
                    c.created_date AS CreatedDate,
                    c.modified_by AS ModifiedBy,
                    c.modified_date AS ModifiedDate,
                    (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0) AS TotalMembers
                FROM club_master c
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                WHERE c.pk_club_id = p_Id
                  AND c.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_get_members`(
                IN p_ClubId INT,
                IN p_Search VARCHAR(200),
                IN p_PageSize INT,
                IN p_Offset INT
            )
BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    m.EmailId,
                    m.PrimaryMobileNumber,
                    m.RotaryId,
                    cm.JoinedDate,
                    cm.pk_club_member_id AS ClubMemberId,
                    cm.IsActive AS MembershipActive,
                    GROUP_CONCAT(DISTINCT r.RoleName ORDER BY r.RoleName SEPARATOR ',') AS RoleNames,
                    MAX(CASE WHEN r.RoleName = 'Admin' AND mr.IsActive = 1 THEN 1 ELSE 0 END) AS HasAdminRole
                FROM member_master_profile m
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                LEFT JOIN member_roles mr
                    ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND mr.IsActive = 1
                    AND mr.isdeleted = 0
                    AND (
                        (mr.fk_role_id = 2 AND mr.fk_club_id = p_ClubId)
                        OR mr.fk_role_id != 2
                    )
                LEFT JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE cm.fk_club_id = p_ClubId
                  AND cm.isdeleted = 0
                  AND m.isdeleted = 0
                  AND (p_Search IS NULL
                       OR m.MemberName LIKE CONCAT('%', p_Search, '%')
                       OR m.EmailId LIKE CONCAT('%', p_Search, '%')
                       OR m.RotaryId LIKE CONCAT('%', p_Search, '%'))
                GROUP BY m.pk_member_master_profile_id, m.MemberName, m.ProfilePhotoPath,
                         m.EmailId, m.PrimaryMobileNumber, m.RotaryId,
                         cm.JoinedDate, cm.pk_club_member_id, cm.IsActive
                ORDER BY m.MemberName
                LIMIT p_PageSize OFFSET p_Offset;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_menu_create`(
                IN p_ClubId INT,
                IN p_MenuName VARCHAR(200),
                IN p_LinkType VARCHAR(20),
                IN p_LinkValue VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO club_website_menu (fk_club_id, menu_name, link_type, link_value, sort_order, is_active, created_by)
                VALUES (p_ClubId, p_MenuName, p_LinkType, p_LinkValue, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_menu_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE club_website_submenu
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE fk_menu_id = p_Id AND isdeleted = 0;

                UPDATE club_website_menu
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_menu_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_menu_get_by_club`(
                IN p_ClubId INT
            )
BEGIN
                SELECT m.pk_club_website_menu_id AS Id,
                       m.fk_club_id AS ClubId,
                       m.menu_name AS MenuName,
                       m.link_type AS LinkType,
                       CASE
                           WHEN m.link_value IS NULL OR m.link_value = '' THEN m.link_value
                           WHEN m.link_type = 'document'
                                AND m.link_value NOT LIKE '/%'
                                AND m.link_value NOT LIKE 'http%'
                                THEN CONCAT('/uploads/menu/', m.link_value)
                           ELSE m.link_value
                       END AS LinkValue,
                       m.sort_order AS SortOrder,
                       m.is_active AS IsActive,
                       (SELECT COUNT(*) FROM club_website_submenu s
                        WHERE s.fk_menu_id = m.pk_club_website_menu_id AND s.isdeleted = 0) AS SubMenuCount
                FROM club_website_menu m
                WHERE m.fk_club_id = p_ClubId AND m.isdeleted = 0
                ORDER BY m.sort_order ASC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_menu_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT m.pk_club_website_menu_id AS Id,
                       m.fk_club_id AS ClubId,
                       m.menu_name AS MenuName,
                       m.link_type AS LinkType,
                       CASE
                           WHEN m.link_value IS NULL OR m.link_value = '' THEN m.link_value
                           WHEN m.link_type = 'document'
                                AND m.link_value NOT LIKE '/%'
                                AND m.link_value NOT LIKE 'http%'
                                THEN CONCAT('/uploads/menu/', m.link_value)
                           ELSE m.link_value
                       END AS LinkValue,
                       m.sort_order AS SortOrder,
                       m.is_active AS IsActive,
                       (SELECT COUNT(*) FROM club_website_submenu s
                        WHERE s.fk_menu_id = m.pk_club_website_menu_id AND s.isdeleted = 0) AS SubMenuCount
                FROM club_website_menu m
                WHERE m.pk_club_website_menu_id = p_Id AND m.isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_menu_reorder`(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM club_website_menu WHERE pk_club_website_menu_id = p_Id1;
                SELECT sort_order INTO v_Order2 FROM club_website_menu WHERE pk_club_website_menu_id = p_Id2;
                UPDATE club_website_menu SET sort_order = v_Order2 WHERE pk_club_website_menu_id = p_Id1;
                UPDATE club_website_menu SET sort_order = v_Order1 WHERE pk_club_website_menu_id = p_Id2;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_menu_update`(
                IN p_Id INT,
                IN p_MenuName VARCHAR(200),
                IN p_LinkType VARCHAR(20),
                IN p_LinkValue VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE club_website_menu
                SET menu_name = p_MenuName,
                    link_type = p_LinkType,
                    link_value = p_LinkValue,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_menu_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_modules_assign`(
                IN p_ClubId INT,
                IN p_ModuleId INT,
                IN p_AssignedBy INT
            )
BEGIN
                INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy)
                VALUES (p_ClubId, p_ModuleId, 1, p_AssignedBy);
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_modules_assign_defaults`(
                IN p_ClubId INT,
                IN p_AssignedBy INT
            )
BEGIN
                INSERT IGNORE INTO club_modules (fk_club_id, fk_module_id, IsEnabled, AssignedBy)
                SELECT p_ClubId, pk_module_id, 1, p_AssignedBy
                FROM module_master
                WHERE IsDefaultForClub = 1 AND ModuleLevel IN ('Club', 'Both') AND IsActive = 1 AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_modules_get`(
                IN p_ClubId INT
            )
BEGIN
                SELECT cm.pk_club_module_id AS Id, cm.fk_module_id AS ModuleId,
                       m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                       cm.IsEnabled
                FROM club_modules cm
                JOIN module_master m ON m.pk_module_id = cm.fk_module_id AND m.isdeleted = 0 AND m.IsActive = 1
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
                WHERE cm.fk_club_id = p_ClubId
                ORDER BY c.SortOrder, m.SortOrder;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_modules_get_available`(
                IN p_ClubId INT
            )
BEGIN
                SELECT m.pk_module_id AS ModuleId, m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                       IF(cm.pk_club_module_id IS NOT NULL, 1, 0) AS IsAssigned
                FROM module_master m
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
                LEFT JOIN club_modules cm ON cm.fk_module_id = m.pk_module_id AND cm.fk_club_id = p_ClubId
                WHERE m.isdeleted = 0 AND m.IsActive = 1 AND m.ModuleLevel IN ('Club', 'Both')
                ORDER BY c.SortOrder, m.SortOrder;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_modules_unassign`(
                IN p_ClubId INT,
                IN p_ModuleId INT
            )
BEGIN
                DELETE FROM club_modules
                WHERE fk_club_id = p_ClubId AND fk_module_id = p_ModuleId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_remove_member`(
                IN p_ClubId INT,
                IN p_MemberId INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE club_members
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE fk_club_id = p_ClubId
                  AND fk_member_master_profile_id = p_MemberId
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_social_link_create`(
                IN p_ClubId INT,
                IN p_Platform VARCHAR(50),
                IN p_LinkUrl VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO club_website_social_link (fk_club_id, platform, link_url, sort_order, is_active, created_by)
                VALUES (p_ClubId, p_Platform, p_LinkUrl, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_social_link_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE club_website_social_link
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_social_link_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_social_link_get_by_club`(
                IN p_ClubId INT
            )
BEGIN
                SELECT s.pk_club_website_social_link_id AS Id,
                       s.fk_club_id AS ClubId,
                       s.platform AS Platform,
                       s.link_url AS LinkUrl,
                       s.sort_order AS SortOrder,
                       s.is_active AS IsActive
                FROM club_website_social_link s
                WHERE s.fk_club_id = p_ClubId AND s.isdeleted = 0
                ORDER BY s.sort_order ASC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_social_link_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT s.pk_club_website_social_link_id AS Id,
                       s.fk_club_id AS ClubId,
                       s.platform AS Platform,
                       s.link_url AS LinkUrl,
                       s.sort_order AS SortOrder,
                       s.is_active AS IsActive
                FROM club_website_social_link s
                WHERE s.pk_club_website_social_link_id = p_Id AND s.isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_social_link_update`(
                IN p_Id INT,
                IN p_Platform VARCHAR(50),
                IN p_LinkUrl VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE club_website_social_link
                SET platform = p_Platform,
                    link_url = p_LinkUrl,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_social_link_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_soft_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE club_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_club_id = p_Id;

                UPDATE club_members
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE fk_club_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_submenu_create`(
                IN p_MenuId INT,
                IN p_SubMenuName VARCHAR(200),
                IN p_LinkType VARCHAR(20),
                IN p_LinkValue VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO club_website_submenu (fk_menu_id, submenu_name, link_type, link_value, sort_order, is_active, created_by)
                VALUES (p_MenuId, p_SubMenuName, p_LinkType, p_LinkValue, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_submenu_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE club_website_submenu
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_club_website_submenu_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_submenu_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT pk_club_website_submenu_id AS Id,
                       fk_menu_id AS MenuId,
                       submenu_name AS SubMenuName,
                       link_type AS LinkType,
                       CASE
                           WHEN link_value IS NULL OR link_value = '' THEN link_value
                           WHEN link_type = 'document'
                                AND link_value NOT LIKE '/%'
                                AND link_value NOT LIKE 'http%'
                                THEN CONCAT('/uploads/menu/', link_value)
                           ELSE link_value
                       END AS LinkValue,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM club_website_submenu
                WHERE pk_club_website_submenu_id = p_Id AND isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_submenu_get_by_menu`(
                IN p_MenuId INT
            )
BEGIN
                SELECT pk_club_website_submenu_id AS Id,
                       fk_menu_id AS MenuId,
                       submenu_name AS SubMenuName,
                       link_type AS LinkType,
                       CASE
                           WHEN link_value IS NULL OR link_value = '' THEN link_value
                           WHEN link_type = 'document'
                                AND link_value NOT LIKE '/%'
                                AND link_value NOT LIKE 'http%'
                                THEN CONCAT('/uploads/menu/', link_value)
                           ELSE link_value
                       END AS LinkValue,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM club_website_submenu
                WHERE fk_menu_id = p_MenuId AND isdeleted = 0
                ORDER BY sort_order ASC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_submenu_reorder`(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM club_website_submenu WHERE pk_club_website_submenu_id = p_Id1;
                SELECT sort_order INTO v_Order2 FROM club_website_submenu WHERE pk_club_website_submenu_id = p_Id2;
                UPDATE club_website_submenu SET sort_order = v_Order2 WHERE pk_club_website_submenu_id = p_Id1;
                UPDATE club_website_submenu SET sort_order = v_Order1 WHERE pk_club_website_submenu_id = p_Id2;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_submenu_update`(
                IN p_Id INT,
                IN p_SubMenuName VARCHAR(200),
                IN p_LinkType VARCHAR(20),
                IN p_LinkValue VARCHAR(500),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE club_website_submenu
                SET submenu_name = p_SubMenuName,
                    link_type = p_LinkType,
                    link_value = p_LinkValue,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_club_website_submenu_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_terminated_members`(
                IN p_ClubId INT,
                IN p_Search VARCHAR(200),
                IN p_PageSize INT,
                IN p_Offset INT
            )
BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.RotaryId,
                    m.MemberName,
                    cm.JoinedDate,
                    cm.TerminationDate,
                    cm.TerminationReason
                FROM member_master_profile m
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                WHERE cm.fk_club_id = p_ClubId
                  AND cm.isdeleted = 1
                  AND cm.TerminationDate IS NOT NULL
                  AND (p_Search IS NULL OR p_Search = '' OR m.MemberName LIKE CONCAT('%', p_Search, '%') OR m.RotaryId LIKE CONCAT('%', p_Search, '%'))
                ORDER BY cm.TerminationDate DESC
                LIMIT p_PageSize OFFSET p_Offset;

                SELECT COUNT(*) AS TotalCount
                FROM member_master_profile m
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id
                WHERE cm.fk_club_id = p_ClubId
                  AND cm.isdeleted = 1
                  AND cm.TerminationDate IS NOT NULL
                  AND (p_Search IS NULL OR p_Search = '' OR m.MemberName LIKE CONCAT('%', p_Search, '%') OR m.RotaryId LIKE CONCAT('%', p_Search, '%'));
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_theme_get`(
                IN p_ClubId INT,
                IN p_YearId INT
            )
BEGIN
                SELECT cwt.pk_club_website_theme_id AS Id,
                       cwt.fk_club_id AS ClubId,
                       cwt.fk_year_id AS YearId,
                       y.YearLabel,
                       cwt.fk_theme_id AS ThemeId,
                       t.theme_name AS ThemeName,
                       CASE
                           WHEN t.theme_image_path IS NULL OR t.theme_image_path = '' THEN NULL
                           WHEN t.theme_image_path LIKE '/%' THEN t.theme_image_path
                           ELSE CONCAT('/uploads/theme/', t.theme_image_path)
                       END AS ThemeImagePath
                FROM club_website_theme cwt
                JOIN theme_master t ON t.pk_theme_id = cwt.fk_theme_id
                JOIN rotary_year_master y ON y.pk_year_id = cwt.fk_year_id
                WHERE cwt.fk_club_id = p_ClubId AND cwt.fk_year_id = p_YearId
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_theme_save`(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_ThemeId INT,
                IN p_UserId INT
            )
BEGIN
                INSERT INTO club_website_theme (fk_club_id, fk_year_id, fk_theme_id, created_by)
                VALUES (p_ClubId, p_YearId, p_ThemeId, p_UserId)
                ON DUPLICATE KEY UPDATE fk_theme_id = p_ThemeId, modified_by = p_UserId, modified_date = NOW();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_club_update`(
                IN p_Id INT,
                IN p_FkDistrictId INT,
                IN p_ClubRotaryId VARCHAR(50),
                IN p_ClubName VARCHAR(300),
                IN p_Timezone VARCHAR(100),
                IN p_ClubCharterDate DATE,
                IN p_ClubLogoPath VARCHAR(500),
                IN p_ClubWebsite VARCHAR(500),
                IN p_MeetingDay VARCHAR(20),
                IN p_MeetingFromTime TIME,
                IN p_MeetingToTime TIME,
                IN p_MeetingAddress TEXT,
                IN p_Country VARCHAR(100),
                IN p_State VARCHAR(100),
                IN p_City VARCHAR(100),
                IN p_Pincode VARCHAR(20),
                IN p_ActiveFromDate DATE,
                IN p_ActiveToDate DATE,
                IN p_IsAutomaticMeetingReminder TINYINT,
                IN p_IsFamilyLogin TINYINT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE club_master SET
                    fk_district_id = p_FkDistrictId,
                    ClubRotaryId = p_ClubRotaryId,
                    ClubName = p_ClubName,
                    Timezone = p_Timezone,
                    ClubCharterDate = p_ClubCharterDate,
                    ClubLogoPath = p_ClubLogoPath,
                    ClubWebsite = p_ClubWebsite,
                    MeetingDay = p_MeetingDay,
                    MeetingFromTime = p_MeetingFromTime,
                    MeetingToTime = p_MeetingToTime,
                    MeetingAddress = p_MeetingAddress,
                    Country = p_Country,
                    State = p_State,
                    City = p_City,
                    Pincode = p_Pincode,
                    ActiveFromDate = p_ActiveFromDate,
                    ActiveToDate = p_ActiveToDate,
                    IsAutomaticMeetingReminder = p_IsAutomaticMeetingReminder,
                    IsFamilyLogin = p_IsFamilyLogin,
                    IsActive = p_IsActive,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_club_id = p_Id
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_country_get_all`()
BEGIN
                SELECT
                    pk_country_id AS Id,
                    CountryName,
                    CountryCode,
                    PhoneCode,
                    GmtOpt,
                    GmtTime,
                    Ordering
                FROM country_master
                WHERE isdeleted = 0
                ORDER BY Ordering;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_designation_create`(
                IN p_DesignationName VARCHAR(100),
                IN p_SortOrder INT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO designation_master (designation_name, sort_order, created_by)
                VALUES (p_DesignationName, p_SortOrder, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_designation_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE designation_master
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_designation_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_designation_get_all`()
BEGIN
                SELECT
                    pk_designation_id AS Id,
                    designation_name AS DesignationName,
                    sort_order AS SortOrder
                FROM designation_master
                WHERE isdeleted = 0
                ORDER BY sort_order;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_designation_swap_order`(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM designation_master WHERE pk_designation_id = p_Id1 AND isdeleted = 0;
                SELECT sort_order INTO v_Order2 FROM designation_master WHERE pk_designation_id = p_Id2 AND isdeleted = 0;
                UPDATE designation_master SET sort_order = v_Order2 WHERE pk_designation_id = p_Id1;
                UPDATE designation_master SET sort_order = v_Order1 WHERE pk_designation_id = p_Id2;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_designation_update`(
                IN p_Id INT,
                IN p_DesignationName VARCHAR(100),
                IN p_SortOrder INT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE designation_master
                SET designation_name = p_DesignationName,
                    sort_order = p_SortOrder,
                    modified_by = p_ModifiedBy
                WHERE pk_designation_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_check_duplicate`(
                IN p_DistrictNumber VARCHAR(50),
                IN p_ExcludeId INT
            )
BEGIN
                SELECT COUNT(*)
                FROM district_master
                WHERE isdeleted = 0
                  AND DistrictNumber = p_DistrictNumber
                  AND (p_ExcludeId IS NULL OR pk_district_id != p_ExcludeId);
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_create`(
                IN p_DistrictNumber VARCHAR(50),
                IN p_DistrictLogoPath VARCHAR(500),
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT,
                IN p_FkZoneId INT
            )
BEGIN
                INSERT INTO district_master (DistrictNumber, DistrictLogoPath, IsActive, fk_zone_id, created_by, created_date)
                VALUES (p_DistrictNumber, p_DistrictLogoPath, p_IsActive, p_FkZoneId, p_CreatedBy, NOW());
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_dashboard_get`(
                IN p_DistrictId INT
            )
BEGIN
                SELECT pk_district_id AS Id, DistrictNumber,
                       CASE
                           WHEN DistrictLogoPath IS NULL OR DistrictLogoPath = '' THEN NULL
                           WHEN DistrictLogoPath LIKE '/%' THEN DistrictLogoPath
                           ELSE CONCAT('/uploads/district/', DistrictLogoPath)
                       END AS DistrictLogoPath,
                       IsActive
                FROM district_master
                WHERE pk_district_id = p_DistrictId AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_get_all_count`(
                IN p_Search VARCHAR(200),
                IN p_IsActive INT,
                IN p_ZoneId INT
            )
BEGIN
                SELECT COUNT(*)
                FROM district_master d
                WHERE d.isdeleted = 0
                  AND (p_Search IS NULL OR d.DistrictNumber LIKE CONCAT('%', p_Search, '%'))
                  AND (p_IsActive IS NULL OR d.IsActive = p_IsActive)
                  AND (p_ZoneId IS NULL OR d.fk_zone_id = p_ZoneId);
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_get_all_paginated`(
                IN p_Search VARCHAR(200),
                IN p_IsActive INT,
                IN p_PageSize INT,
                IN p_Offset INT,
                IN p_ZoneId INT
            )
BEGIN
                SELECT
                    d.pk_district_id AS Id,
                    d.DistrictNumber,
                    CASE
                        WHEN d.DistrictLogoPath IS NULL OR d.DistrictLogoPath = '' THEN NULL
                        WHEN d.DistrictLogoPath LIKE '/%' THEN d.DistrictLogoPath
                        ELSE CONCAT('/uploads/district/', d.DistrictLogoPath)
                    END AS DistrictLogoPath,
                    d.IsActive,
                    d.created_date AS CreatedDate,
                    d.fk_zone_id AS FkZoneId,
                    z.ZoneName,
                    (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0) AS TotalClubs,
                    (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                     FROM club_members cm
                     JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                     WHERE c2.fk_district_id = d.pk_district_id AND cm.isdeleted = 0) AS TotalMembers
                FROM district_master d
                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
                WHERE d.isdeleted = 0
                  AND (p_Search IS NULL OR d.DistrictNumber LIKE CONCAT('%', p_Search, '%'))
                  AND (p_IsActive IS NULL OR d.IsActive = p_IsActive)
                  AND (p_ZoneId IS NULL OR d.fk_zone_id = p_ZoneId)
                ORDER BY d.pk_district_id DESC
                LIMIT p_PageSize OFFSET p_Offset;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT
                    d.pk_district_id AS Id,
                    d.DistrictNumber,
                    CASE
                        WHEN d.DistrictLogoPath IS NULL OR d.DistrictLogoPath = '' THEN NULL
                        WHEN d.DistrictLogoPath LIKE '/%' THEN d.DistrictLogoPath
                        ELSE CONCAT('/uploads/district/', d.DistrictLogoPath)
                    END AS DistrictLogoPath,
                    d.IsActive,
                    d.created_by AS CreatedBy,
                    d.created_date AS CreatedDate,
                    d.modified_by AS ModifiedBy,
                    d.modified_date AS ModifiedDate,
                    d.fk_zone_id AS FkZoneId,
                    z.ZoneName,
                    (SELECT COUNT(*) FROM club_master c WHERE c.fk_district_id = d.pk_district_id AND c.isdeleted = 0) AS TotalClubs,
                    (SELECT COUNT(DISTINCT cm.fk_member_master_profile_id)
                     FROM club_members cm
                     JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id AND c2.isdeleted = 0
                     WHERE c2.fk_district_id = d.pk_district_id AND cm.isdeleted = 0) AS TotalMembers
                FROM district_master d
                LEFT JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0
                WHERE d.pk_district_id = p_Id
                  AND d.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_get_clubs`(
                IN p_DistrictId INT
            )
BEGIN
                SELECT
                    c.pk_club_id AS Id,
                    c.fk_district_id AS FkDistrictId,
                    c.ClubRotaryId,
                    c.ClubName,
                    CASE
                        WHEN c.ClubLogoPath IS NULL OR c.ClubLogoPath = '' THEN NULL
                        WHEN c.ClubLogoPath LIKE '/%' THEN c.ClubLogoPath
                        ELSE CONCAT('/uploads/club/', c.ClubLogoPath)
                    END AS ClubLogoPath,
                    c.MeetingDay,
                    c.City,
                    c.State,
                    c.IsActive,
                    (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id = c.pk_club_id AND cm.isdeleted = 0) AS TotalMembers
                FROM club_master c
                WHERE c.fk_district_id = p_DistrictId
                  AND c.isdeleted = 0
                ORDER BY c.ClubName;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_get_members`(
                IN p_DistrictId INT,
                IN p_Search VARCHAR(200),
                IN p_PageSize INT,
                IN p_Offset INT
            )
BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    m.EmailId,
                    m.PrimaryMobileNumber,
                    m.RotaryId,
                    GROUP_CONCAT(DISTINCT c.ClubName ORDER BY c.ClubName SEPARATOR ', ') AS ClubNames
                FROM member_master_profile m
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0
                WHERE c.fk_district_id = p_DistrictId
                  AND m.isdeleted = 0
                  AND (p_Search IS NULL
                       OR m.MemberName LIKE CONCAT('%', p_Search, '%')
                       OR m.EmailId LIKE CONCAT('%', p_Search, '%')
                       OR m.RotaryId LIKE CONCAT('%', p_Search, '%'))
                GROUP BY m.pk_member_master_profile_id, m.MemberName, m.ProfilePhotoPath, m.EmailId, m.PrimaryMobileNumber, m.RotaryId
                ORDER BY m.MemberName
                LIMIT p_PageSize OFFSET p_Offset;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_modules_assign`(
                IN p_DistrictId INT,
                IN p_ModuleId INT,
                IN p_AssignedBy INT
            )
BEGIN
                INSERT IGNORE INTO district_modules (fk_district_id, fk_module_id, IsEnabled, AssignedBy)
                VALUES (p_DistrictId, p_ModuleId, 1, p_AssignedBy);
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_modules_assign_defaults`(
                IN p_DistrictId INT,
                IN p_AssignedBy INT
            )
BEGIN
                INSERT IGNORE INTO district_modules (fk_district_id, fk_module_id, IsEnabled, AssignedBy)
                SELECT p_DistrictId, pk_module_id, 1, p_AssignedBy
                FROM module_master
                WHERE IsDefaultForDistrict = 1 AND ModuleLevel IN ('District', 'Both') AND IsActive = 1 AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_modules_get`(
                IN p_DistrictId INT
            )
BEGIN
                SELECT dm.pk_district_module_id AS Id, dm.fk_module_id AS ModuleId,
                       m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                       dm.IsEnabled
                FROM district_modules dm
                JOIN module_master m ON m.pk_module_id = dm.fk_module_id AND m.isdeleted = 0 AND m.IsActive = 1
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
                WHERE dm.fk_district_id = p_DistrictId
                ORDER BY c.SortOrder, m.SortOrder;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_modules_get_available`(
                IN p_DistrictId INT
            )
BEGIN
                SELECT m.pk_module_id AS ModuleId, m.ModuleName, m.ModuleKey, m.IconClass, m.IconPath,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       c.SortOrder AS CategorySortOrder, m.SortOrder AS ModuleSortOrder,
                       IF(dm.pk_district_module_id IS NOT NULL, 1, 0) AS IsAssigned
                FROM module_master m
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id AND c.isdeleted = 0
                LEFT JOIN district_modules dm ON dm.fk_module_id = m.pk_module_id AND dm.fk_district_id = p_DistrictId
                WHERE m.isdeleted = 0 AND m.IsActive = 1 AND m.ModuleLevel IN ('District', 'Both')
                ORDER BY c.SortOrder, m.SortOrder;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_modules_unassign`(
                IN p_DistrictId INT,
                IN p_ModuleId INT
            )
BEGIN
                DELETE FROM district_modules
                WHERE fk_district_id = p_DistrictId AND fk_module_id = p_ModuleId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_soft_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE district_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_district_id = p_Id;

                UPDATE club_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE fk_district_id = p_Id AND isdeleted = 0;

                UPDATE club_members cm
                JOIN club_master c ON c.pk_club_id = cm.fk_club_id
                SET cm.isdeleted = 1, cm.deleted_by = p_DeletedBy, cm.deleted_date = NOW()
                WHERE c.fk_district_id = p_Id AND cm.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_district_update`(
                IN p_Id INT,
                IN p_DistrictNumber VARCHAR(50),
                IN p_DistrictLogoPath VARCHAR(500),
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT,
                IN p_FkZoneId INT
            )
BEGIN
                UPDATE district_master SET
                    DistrictNumber = p_DistrictNumber,
                    DistrictLogoPath = p_DistrictLogoPath,
                    IsActive = p_IsActive,
                    fk_zone_id = p_FkZoneId,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_district_id = p_Id
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_document_create`(
                IN p_ClubId INT,
                IN p_YearId INT,
                IN p_Title VARCHAR(50),
                IN p_AccessType VARCHAR(20),
                IN p_FilePath VARCHAR(500),
                IN p_OriginalFileName VARCHAR(255),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO club_documents (fk_club_id, fk_year_id, Title, AccessType, FilePath, OriginalFileName, PublishDateTime, ExpiryDateTime, created_by)
                VALUES (p_ClubId, p_YearId, p_Title, p_AccessType, p_FilePath, p_OriginalFileName, p_PublishDateTime, p_ExpiryDateTime, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_document_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE club_documents
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_document_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_document_get_all_paginated`(
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
                           WHEN d.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', d.FilePath)
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
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_document_get_by_id`(
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
                           WHEN d.Scope = 'ri' THEN CONCAT('/Documents/documentsafe/ri/', d.FilePath)
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
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_document_get_years`(
                IN p_ClubId INT
            )
BEGIN
                SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent
                FROM rotary_year_master y
                INNER JOIN club_documents d ON d.fk_year_id = y.pk_year_id
                WHERE d.fk_club_id = p_ClubId
                  AND d.isdeleted = 0
                ORDER BY y.pk_year_id DESC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_document_update`(
                IN p_Id INT,
                IN p_Title VARCHAR(50),
                IN p_AccessType VARCHAR(20),
                IN p_FilePath VARCHAR(500),
                IN p_OriginalFileName VARCHAR(255),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE club_documents
                SET Title = p_Title,
                    AccessType = p_AccessType,
                    FilePath = p_FilePath,
                    OriginalFileName = p_OriginalFileName,
                    PublishDateTime = p_PublishDateTime,
                    ExpiryDateTime = p_ExpiryDateTime,
                    modified_by = p_ModifiedBy
                WHERE pk_document_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_funding_create`(
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO funding_master (name, sort_order, is_active, created_by)
                VALUES (p_Name, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_funding_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE funding_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_funding_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_funding_get_all`()
BEGIN
                SELECT pk_funding_id AS Id,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM funding_master
                WHERE isdeleted = 0
                ORDER BY sort_order, name;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_funding_get_by_id`(IN p_Id INT)
BEGIN
                SELECT pk_funding_id AS Id,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM funding_master
                WHERE pk_funding_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_funding_update`(
                IN p_Id INT,
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE funding_master
                SET name = p_Name,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_funding_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_greeting_get_settings`(IN p_ClubId INT)
BEGIN
                SELECT
                    BirthdayGreeting, IsEnableBirthdayNotification,
                    AnniversaryGreeting, IsEnableAnniversaryNotification,
                    IsGreetingSendWhatsapp, IsGreetingSendEmail,
                    IsEnableBirthdayEmail, BirthdayEmailFrom, BirthdayEmailSubject, BirthdayEmailMessage,
                    IsEnableAnniversaryEmail, AnniversaryEmailFrom, AnniversaryEmailSubject, AnniversaryEmailMessage
                FROM club_master
                WHERE pk_club_id = p_ClubId AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_greeting_update_settings`(
                IN p_ClubId INT,
                IN p_BirthdayGreeting VARCHAR(700),
                IN p_IsEnableBirthdayNotification TINYINT,
                IN p_AnniversaryGreeting VARCHAR(700),
                IN p_IsEnableAnniversaryNotification TINYINT,
                IN p_IsGreetingSendWhatsapp TINYINT,
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
                    IsGreetingSendWhatsapp = p_IsGreetingSendWhatsapp,
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
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_login_audit_create`(
                IN p_MemberId INT,
                IN p_MemberName VARCHAR(200),
                IN p_EmailOrMobile VARCHAR(200),
                IN p_IpAddress VARCHAR(50),
                IN p_UserAgent VARCHAR(500),
                IN p_Status VARCHAR(20),
                IN p_FailureReason VARCHAR(200)
            )
BEGIN
                INSERT INTO login_audit_logs (fk_member_id, member_name, email_or_mobile, ip_address, user_agent, login_status, failure_reason)
                VALUES (p_MemberId, p_MemberName, p_EmailOrMobile, p_IpAddress, p_UserAgent, p_Status, p_FailureReason);
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_login_audit_get_last_login`(
                IN p_MemberId INT
            )
BEGIN
                SELECT login_time AS LastLoginTime
                FROM login_audit_logs
                WHERE fk_member_id = p_MemberId AND login_status = 'success'
                ORDER BY login_time DESC
                LIMIT 1 OFFSET 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_login_audit_get_logs`(
                IN p_Search VARCHAR(200),
                IN p_Status VARCHAR(20),
                IN p_Page INT,
                IN p_PageSize INT
            )
BEGIN
                DECLARE v_Offset INT;
                SET v_Offset = (p_Page - 1) * p_PageSize;

                SELECT pk_log_id AS Id, fk_member_id AS MemberId, member_name AS MemberName,
                       email_or_mobile AS EmailOrMobile, login_time AS LoginTime,
                       ip_address AS IpAddress, user_agent AS UserAgent,
                       login_status AS LoginStatus, failure_reason AS FailureReason
                FROM login_audit_logs
                WHERE (p_Search = '' OR member_name LIKE CONCAT('%', p_Search, '%') OR email_or_mobile LIKE CONCAT('%', p_Search, '%'))
                  AND (p_Status = '' OR login_status = p_Status)
                ORDER BY login_time DESC
                LIMIT p_PageSize OFFSET v_Offset;

                SELECT COUNT(*)
                FROM login_audit_logs
                WHERE (p_Search = '' OR member_name LIKE CONCAT('%', p_Search, '%') OR email_or_mobile LIKE CONCAT('%', p_Search, '%'))
                  AND (p_Status = '' OR login_status = p_Status);
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_address_create`(
                IN p_FkMemberMasterProfileId INT,
                IN p_AddressType VARCHAR(20),
                IN p_FkCountryId INT,
                IN p_PhoneNumber VARCHAR(20),
                IN p_Address TEXT,
                IN p_State VARCHAR(100),
                IN p_City VARCHAR(100),
                IN p_PinCode VARCHAR(100),
                IN p_BusinessName VARCHAR(300),
                IN p_BusinessEmailId VARCHAR(200),
                IN p_Keywords VARCHAR(500)
            )
BEGIN
                INSERT INTO member_address_details (
                    fk_member_master_profile_id, AddressType, fk_country_id, PhoneNumber,
                    Address, State, City, PinCode,
                    BusinessName, BusinessEmailId, Keywords,
                    created_date
                ) VALUES (
                    p_FkMemberMasterProfileId, p_AddressType, p_FkCountryId, p_PhoneNumber,
                    p_Address, p_State, p_City, p_PinCode,
                    p_BusinessName, p_BusinessEmailId, p_Keywords,
                    NOW()
                );
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_address_get_by_member_id`(
                IN p_MemberId INT
            )
BEGIN
                SELECT
                    a.pk_member_address_details_id AS Id,
                    a.fk_member_master_profile_id AS FkMemberMasterProfileId,
                    a.AddressType,
                    a.fk_country_id AS FkCountryId,
                    c.CountryName AS Country,
                    c.PhoneCode AS CountryPhoneCode,
                    a.PhoneNumber,
                    a.Address,
                    a.State,
                    a.City,
                    a.PinCode,
                    a.BusinessName,
                    a.BusinessEmailId,
                    cmd.Designation AS Designation,
                    cmd.ClassificationProfession AS ClassificationProfession,
                    a.Keywords
                FROM member_address_details a
                LEFT JOIN country_master c ON c.pk_country_id = a.fk_country_id
                LEFT JOIN (
                    SELECT fk_member_master_profile_id,
                           MAX(Designation) AS Designation,
                           MAX(ClassificationProfession) AS ClassificationProfession
                    FROM club_members
                    WHERE COALESCE(isdeleted, 0) = 0
                    GROUP BY fk_member_master_profile_id
                ) cmd ON cmd.fk_member_master_profile_id = a.fk_member_master_profile_id
                WHERE a.fk_member_master_profile_id = p_MemberId
                  AND a.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_address_soft_delete_by_member`(
                IN p_MemberId INT
            )
BEGIN
                UPDATE member_address_details
                SET isdeleted = 1
                WHERE fk_member_master_profile_id = p_MemberId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_check_duplicates`(
                IN p_Mobile VARCHAR(20),
                IN p_Email VARCHAR(200),
                IN p_RotaryId VARCHAR(50),
                IN p_ExcludeId INT
            )
BEGIN
                SELECT
                    (SELECT COUNT(*) FROM member_master_profile
                     WHERE isdeleted = 0
                       AND (p_ExcludeId IS NULL OR pk_member_master_profile_id != p_ExcludeId)
                       AND p_Mobile != ''
                       AND PrimaryMobileNumber = p_Mobile) AS MobileDuplicate,
                    (SELECT COUNT(*) FROM member_master_profile
                     WHERE isdeleted = 0
                       AND (p_ExcludeId IS NULL OR pk_member_master_profile_id != p_ExcludeId)
                       AND p_Email != ''
                       AND EmailId = p_Email) AS EmailDuplicate,
                    (SELECT COUNT(*) FROM member_master_profile
                     WHERE isdeleted = 0
                       AND (p_ExcludeId IS NULL OR pk_member_master_profile_id != p_ExcludeId)
                       AND p_RotaryId != ''
                       AND RotaryId = p_RotaryId) AS RotaryIdDuplicate;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_create`(
                IN p_MemberName VARCHAR(200),
                IN p_ProfilePhotoPath VARCHAR(500),
                IN p_FkPrimaryCountryId INT,
                IN p_PrimaryMobileNumber VARCHAR(20),
                IN p_EmailId VARCHAR(200),
                IN p_BirthDate DATE,
                IN p_AnniversaryDate DATE,
                IN p_BloodGroup VARCHAR(10),
                IN p_FkSecondaryCountryId INT,
                IN p_SecondaryMobileNumber VARCHAR(20),
                IN p_IsPersonalDetailsVisible BIT,
                IN p_Gender VARCHAR(20),
                IN p_PrimaryLanguage VARCHAR(50),
                IN p_IsYouth BIT,
                IN p_MemberIntroduction TEXT,
                IN p_Facebook VARCHAR(300),
                IN p_Instagram VARCHAR(300),
                IN p_LinkedIn VARCHAR(300),
                IN p_Twitter VARCHAR(300),
                IN p_Youtube VARCHAR(300),
                IN p_Website VARCHAR(300),
                IN p_RotaryId VARCHAR(50),
                IN p_DonorRecognition VARCHAR(200),
                IN p_FamilyPhotoPath VARCHAR(500),
                IN p_IsFamilyDetailsVisible BIT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO member_master_profile (
                    MemberName, ProfilePhotoPath, fk_primary_country_id, PrimaryMobileNumber,
                    EmailId, BirthDate, AnniversaryDate, BloodGroup,
                    fk_secondary_country_id, SecondaryMobileNumber,
                    IsPersonalDetailsVisible, Gender, PrimaryLanguage,
                    IsYouth, MemberIntroduction,
                    Facebook, Instagram, LinkedIn, Twitter, Youtube, Website,
                    RotaryId, DonorRecognition, FamilyPhotoPath, IsFamilyDetailsVisible,
                    created_by, created_date
                ) VALUES (
                    p_MemberName, p_ProfilePhotoPath, p_FkPrimaryCountryId, p_PrimaryMobileNumber,
                    p_EmailId, p_BirthDate, p_AnniversaryDate, p_BloodGroup,
                    p_FkSecondaryCountryId, p_SecondaryMobileNumber,
                    p_IsPersonalDetailsVisible, p_Gender, p_PrimaryLanguage,
                    p_IsYouth, p_MemberIntroduction,
                    p_Facebook, p_Instagram, p_LinkedIn, p_Twitter, p_Youtube, p_Website,
                    p_RotaryId, p_DonorRecognition, p_FamilyPhotoPath, p_IsFamilyDetailsVisible,
                    p_CreatedBy, NOW()
                );
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_family_create`(
                IN p_FkMemberMasterProfileId INT,
                IN p_Name VARCHAR(200),
                IN p_Relation VARCHAR(100),
                IN p_BloodGroup VARCHAR(10),
                IN p_FkCountryId INT,
                IN p_PhoneNumber VARCHAR(20),
                IN p_EmailId VARCHAR(200),
                IN p_BirthDate DATE,
                IN p_AnniversaryDate DATE,
                IN p_PhotoPath VARCHAR(500)
            )
BEGIN
                INSERT INTO member_family_details (
                    fk_member_master_profile_id, Name, Relation, BloodGroup,
                    fk_country_id, PhoneNumber, EmailId,
                    BirthDate, AnniversaryDate, PhotoPath,
                    created_date
                ) VALUES (
                    p_FkMemberMasterProfileId, p_Name, p_Relation, p_BloodGroup,
                    p_FkCountryId, p_PhoneNumber, p_EmailId,
                    p_BirthDate, p_AnniversaryDate, p_PhotoPath,
                    NOW()
                );
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_family_get_by_member_id`(
                IN p_MemberId INT
            )
BEGIN
                SELECT
                    f.pk_member_family_details_id AS Id,
                    f.fk_member_master_profile_id AS FkMemberMasterProfileId,
                    f.Name,
                    f.Relation,
                    f.BloodGroup,
                    f.fk_country_id AS FkCountryId,
                    c.CountryName AS Country,
                    c.PhoneCode AS CountryPhoneCode,
                    f.PhoneNumber,
                    f.EmailId,
                    f.BirthDate,
                    f.AnniversaryDate,
                    f.PhotoPath
                FROM member_family_details f
                LEFT JOIN country_master c ON c.pk_country_id = f.fk_country_id
                WHERE f.fk_member_master_profile_id = p_MemberId
                  AND f.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_family_soft_delete_by_member`(
                IN p_MemberId INT
            )
BEGIN
                UPDATE member_family_details
                SET isdeleted = 1
                WHERE fk_member_master_profile_id = p_MemberId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_get_all_count`(
                IN p_Search VARCHAR(200),
                IN p_BloodGroup VARCHAR(10),
                IN p_Gender VARCHAR(20)
            )
BEGIN
                SELECT COUNT(*)
                FROM member_master_profile
                WHERE isdeleted = 0
                  AND (p_Search IS NULL
                       OR MemberName LIKE CONCAT('%', p_Search, '%')
                       OR EmailId LIKE CONCAT('%', p_Search, '%')
                       OR PrimaryMobileNumber LIKE CONCAT('%', p_Search, '%')
                       OR RotaryId LIKE CONCAT('%', p_Search, '%'))
                  AND (p_BloodGroup IS NULL OR BloodGroup = p_BloodGroup)
                  AND (p_Gender IS NULL OR Gender = p_Gender);
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_get_all_paginated`(
                IN p_Search VARCHAR(200),
                IN p_BloodGroup VARCHAR(10),
                IN p_Gender VARCHAR(20),
                IN p_PageSize INT,
                IN p_Offset INT
            )
BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    m.EmailId,
                    m.PrimaryMobileNumber,
                    pc.PhoneCode AS PrimaryCountryPhoneCode,
                    m.BloodGroup,
                    m.Gender,
                    m.RotaryId,
                    ba.BusinessName,
                    cmd.Designation,
                    ra.City AS ResCity,
                    ra.State AS ResState
                FROM member_master_profile m
                JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
                LEFT JOIN member_address_details ba
                    ON ba.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND ba.AddressType = 'Business'
                    AND ba.isdeleted = 0
                LEFT JOIN member_address_details ra
                    ON ra.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND ra.AddressType IN ('Residential','Residence')
                    AND ra.isdeleted = 0
                LEFT JOIN (
                    SELECT fk_member_master_profile_id,
                           MAX(Designation) AS Designation
                    FROM club_members
                    WHERE COALESCE(isdeleted, 0) = 0
                    GROUP BY fk_member_master_profile_id
                ) cmd ON cmd.fk_member_master_profile_id = m.pk_member_master_profile_id
                WHERE m.isdeleted = 0
                  AND (p_Search IS NULL
                       OR m.MemberName LIKE CONCAT('%', p_Search, '%')
                       OR m.EmailId LIKE CONCAT('%', p_Search, '%')
                       OR m.PrimaryMobileNumber LIKE CONCAT('%', p_Search, '%')
                       OR m.RotaryId LIKE CONCAT('%', p_Search, '%'))
                  AND (p_BloodGroup IS NULL OR m.BloodGroup = p_BloodGroup)
                  AND (p_Gender IS NULL OR m.Gender = p_Gender)
                ORDER BY m.pk_member_master_profile_id DESC
                LIMIT p_PageSize OFFSET p_Offset;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    m.fk_primary_country_id AS FkPrimaryCountryId,
                    pc.CountryName AS PrimaryCountry,
                    pc.PhoneCode AS PrimaryCountryPhoneCode,
                    m.PrimaryMobileNumber,
                    m.EmailId,
                    m.BirthDate,
                    m.AnniversaryDate,
                    m.BloodGroup,
                    m.fk_secondary_country_id AS FkSecondaryCountryId,
                    sc.CountryName AS SecondaryCountry,
                    sc.PhoneCode AS SecondaryCountryPhoneCode,
                    m.SecondaryMobileNumber,
                    m.IsPersonalDetailsVisible,
                    m.Gender,
                    m.PrimaryLanguage,
                    m.IsYouth,
                    m.MemberIntroduction,
                    m.Facebook,
                    m.Instagram,
                    m.LinkedIn,
                    m.Twitter,
                    m.Youtube,
                    m.Website,
                    m.RotaryId,
                    m.DonorRecognition,
                    m.FamilyPhotoPath,
                    m.IsFamilyDetailsVisible,
                    m.created_by AS CreatedBy,
                    m.created_date AS CreatedDate,
                    m.modified_by AS ModifiedBy,
                    m.modified_date AS ModifiedDate
                FROM member_master_profile m
                LEFT JOIN country_master pc ON pc.pk_country_id = m.fk_primary_country_id
                LEFT JOIN country_master sc ON sc.pk_country_id = m.fk_secondary_country_id
                WHERE m.pk_member_master_profile_id = p_Id
                  AND m.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_soft_delete`(
                IN p_Id INT
            )
BEGIN
                UPDATE member_master_profile
                SET isdeleted = 1, deleted_date = NOW(), deleted_by = p_Id
                WHERE pk_member_master_profile_id = p_Id;

                UPDATE member_address_details
                SET isdeleted = 1, deleted_date = NOW()
                WHERE fk_member_master_profile_id = p_Id;

                UPDATE member_family_details
                SET isdeleted = 1, deleted_date = NOW()
                WHERE fk_member_master_profile_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_member_update`(
                IN p_Id INT,
                IN p_MemberName VARCHAR(200),
                IN p_ProfilePhotoPath VARCHAR(500),
                IN p_FkPrimaryCountryId INT,
                IN p_PrimaryMobileNumber VARCHAR(20),
                IN p_EmailId VARCHAR(200),
                IN p_BirthDate DATE,
                IN p_AnniversaryDate DATE,
                IN p_BloodGroup VARCHAR(10),
                IN p_FkSecondaryCountryId INT,
                IN p_SecondaryMobileNumber VARCHAR(20),
                IN p_IsPersonalDetailsVisible BIT,
                IN p_Gender VARCHAR(20),
                IN p_PrimaryLanguage VARCHAR(50),
                IN p_IsYouth BIT,
                IN p_MemberIntroduction TEXT,
                IN p_Facebook VARCHAR(300),
                IN p_Instagram VARCHAR(300),
                IN p_LinkedIn VARCHAR(300),
                IN p_Twitter VARCHAR(300),
                IN p_Youtube VARCHAR(300),
                IN p_Website VARCHAR(300),
                IN p_RotaryId VARCHAR(50),
                IN p_DonorRecognition VARCHAR(200),
                IN p_FamilyPhotoPath VARCHAR(500),
                IN p_IsFamilyDetailsVisible BIT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE member_master_profile SET
                    MemberName = p_MemberName,
                    ProfilePhotoPath = p_ProfilePhotoPath,
                    fk_primary_country_id = p_FkPrimaryCountryId,
                    PrimaryMobileNumber = p_PrimaryMobileNumber,
                    EmailId = p_EmailId,
                    BirthDate = p_BirthDate,
                    AnniversaryDate = p_AnniversaryDate,
                    BloodGroup = p_BloodGroup,
                    fk_secondary_country_id = p_FkSecondaryCountryId,
                    SecondaryMobileNumber = p_SecondaryMobileNumber,
                    IsPersonalDetailsVisible = p_IsPersonalDetailsVisible,
                    Gender = p_Gender,
                    PrimaryLanguage = p_PrimaryLanguage,
                    IsYouth = p_IsYouth,
                    MemberIntroduction = p_MemberIntroduction,
                    Facebook = p_Facebook,
                    Instagram = p_Instagram,
                    LinkedIn = p_LinkedIn,
                    Twitter = p_Twitter,
                    Youtube = p_Youtube,
                    Website = p_Website,
                    RotaryId = p_RotaryId,
                    DonorRecognition = p_DonorRecognition,
                    FamilyPhotoPath = p_FamilyPhotoPath,
                    IsFamilyDetailsVisible = p_IsFamilyDetailsVisible,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_member_master_profile_id = p_Id
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_module_category_create`(
                IN p_CategoryName VARCHAR(100),
                IN p_SortOrder INT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO module_categories (CategoryName, SortOrder, IsActive, created_by, created_date)
                VALUES (p_CategoryName, p_SortOrder, 1, p_CreatedBy, NOW());
                SELECT LAST_INSERT_ID() AS Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_module_category_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE module_categories
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_category_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_module_category_get_all`()
BEGIN
                SELECT pk_category_id AS Id, CategoryName, SortOrder, IsActive
                FROM module_categories
                WHERE isdeleted = 0
                ORDER BY SortOrder;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_module_category_update`(
                IN p_Id INT,
                IN p_CategoryName VARCHAR(100),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE module_categories
                SET CategoryName = p_CategoryName,
                    SortOrder = p_SortOrder,
                    IsActive = p_IsActive,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_category_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_module_create`(
                IN p_ModuleName VARCHAR(100),
                IN p_ModuleKey VARCHAR(100),
                IN p_CategoryId INT,
                IN p_ModuleLevel ENUM('District','Club','Both'),
                IN p_IconClass VARCHAR(100),
                IN p_IconPath VARCHAR(200),
                IN p_Description VARCHAR(500),
                IN p_RouteUrl VARCHAR(200),
                IN p_IsDefaultForDistrict TINYINT,
                IN p_IsDefaultForClub TINYINT,
                IN p_SortOrder INT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO module_master (ModuleName, ModuleKey, fk_category_id, ModuleLevel, IconClass, IconPath, Description, RouteUrl, IsDefaultForDistrict, IsDefaultForClub, SortOrder, IsActive, created_by, created_date)
                VALUES (p_ModuleName, p_ModuleKey, p_CategoryId, p_ModuleLevel, p_IconClass, p_IconPath, p_Description, p_RouteUrl, p_IsDefaultForDistrict, p_IsDefaultForClub, p_SortOrder, 1, p_CreatedBy, NOW());
                SELECT LAST_INSERT_ID() AS Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_module_delete`(
                IN p_Id INT
            )
BEGIN
                DELETE FROM module_master WHERE pk_module_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_module_get_all`()
BEGIN
                SELECT m.pk_module_id AS Id, m.ModuleName, m.ModuleKey,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       m.ModuleLevel, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                       m.IsDefaultForDistrict, m.IsDefaultForClub,
                       m.SortOrder, m.IsActive
                FROM module_master m
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id
                WHERE m.isdeleted = 0
                ORDER BY c.SortOrder, m.SortOrder;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_module_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT m.pk_module_id AS Id, m.ModuleName, m.ModuleKey,
                       m.fk_category_id AS CategoryId, c.CategoryName,
                       m.ModuleLevel, m.IconClass, m.IconPath, m.Description, m.RouteUrl,
                       m.IsDefaultForDistrict, m.IsDefaultForClub,
                       m.SortOrder, m.IsActive
                FROM module_master m
                JOIN module_categories c ON c.pk_category_id = m.fk_category_id
                WHERE m.pk_module_id = p_Id AND m.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_module_get_usage_count`(
                IN p_ModuleId INT
            )
BEGIN
                SELECT
                    (SELECT COUNT(*) FROM district_modules WHERE fk_module_id = p_ModuleId) AS DistrictCount,
                    (SELECT COUNT(*) FROM club_modules WHERE fk_module_id = p_ModuleId) AS ClubCount;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_module_update`(
                IN p_Id INT,
                IN p_ModuleName VARCHAR(100),
                IN p_ModuleKey VARCHAR(100),
                IN p_CategoryId INT,
                IN p_ModuleLevel ENUM('District','Club','Both'),
                IN p_IconClass VARCHAR(100),
                IN p_IconPath VARCHAR(200),
                IN p_Description VARCHAR(500),
                IN p_RouteUrl VARCHAR(200),
                IN p_IsDefaultForDistrict TINYINT,
                IN p_IsDefaultForClub TINYINT,
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE module_master
                SET ModuleName = p_ModuleName,
                    ModuleKey = p_ModuleKey,
                    fk_category_id = p_CategoryId,
                    ModuleLevel = p_ModuleLevel,
                    IconClass = p_IconClass,
                    IconPath = p_IconPath,
                    Description = p_Description,
                    RouteUrl = p_RouteUrl,
                    IsDefaultForDistrict = p_IsDefaultForDistrict,
                    IsDefaultForClub = p_IsDefaultForClub,
                    SortOrder = p_SortOrder,
                    IsActive = p_IsActive,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_module_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_newsletter_create`(
                IN p_ClubId INT,
                IN p_Title VARCHAR(50),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_AttachmentType VARCHAR(10),
                IN p_LinkUrl VARCHAR(500),
                IN p_FilePath VARCHAR(500),
                IN p_IsSendWhatsapp TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO newsletters (fk_club_id, Title, PublishDateTime, ExpiryDateTime, AttachmentType, LinkUrl, FilePath, IsSendWhatsapp, created_by)
                VALUES (p_ClubId, p_Title, p_PublishDateTime, p_ExpiryDateTime, p_AttachmentType, p_LinkUrl, p_FilePath, p_IsSendWhatsapp, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_newsletter_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE newsletters
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_newsletter_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_newsletter_get_all_paginated`(
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
                       n.IsSendWhatsapp,
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
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_newsletter_get_by_id`(
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
                       n.IsSendWhatsapp,
                       CASE
                           WHEN n.ExpiryDateTime < NOW() THEN 'Expired'
                           WHEN n.PublishDateTime <= NOW() AND n.ExpiryDateTime >= NOW() THEN 'Published'
                           ELSE 'Unpublished'
                       END AS Status
                FROM newsletters n
                WHERE n.pk_newsletter_id = p_Id
                  AND n.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_newsletter_get_years`(
                IN p_ClubId INT
            )
BEGIN
                SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent
                FROM rotary_year_master y
                INNER JOIN newsletters n
                  ON n.PublishDateTime >= y.StartDate
                 AND n.PublishDateTime < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                WHERE n.fk_club_id = p_ClubId
                  AND n.isdeleted = 0
                ORDER BY y.pk_year_id DESC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_newsletter_update`(
                IN p_Id INT,
                IN p_Title VARCHAR(50),
                IN p_PublishDateTime DATETIME,
                IN p_ExpiryDateTime DATETIME,
                IN p_AttachmentType VARCHAR(10),
                IN p_LinkUrl VARCHAR(500),
                IN p_FilePath VARCHAR(500),
                IN p_IsSendWhatsapp TINYINT,
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
                    IsSendWhatsapp = p_IsSendWhatsapp,
                    modified_by = p_ModifiedBy
                WHERE pk_newsletter_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_past_president_create`(
                IN p_ClubId INT,
                IN p_MemberId INT,
                IN p_YearId INT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO past_presidents (fk_club_id, fk_member_master_profile_id, fk_year_id, created_by)
                VALUES (p_ClubId, p_MemberId, p_YearId, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_past_president_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE past_presidents
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_past_president_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_past_president_get_by_club`(
                IN p_ClubId INT
            )
BEGIN
                SELECT
                    pp.pk_past_president_id AS Id,
                    pp.fk_club_id AS ClubId,
                    pp.fk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    pp.fk_year_id AS YearId,
                    y.YearLabel
                FROM past_presidents pp
                INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
                INNER JOIN rotary_year_master y ON y.pk_year_id = pp.fk_year_id
                WHERE pp.fk_club_id = p_ClubId AND pp.isdeleted = 0
                ORDER BY y.StartDate DESC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_past_president_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT
                    pp.pk_past_president_id AS Id,
                    pp.fk_club_id AS ClubId,
                    pp.fk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath,
                    pp.fk_year_id AS YearId,
                    y.YearLabel
                FROM past_presidents pp
                INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = pp.fk_member_master_profile_id
                INNER JOIN rotary_year_master y ON y.pk_year_id = pp.fk_year_id
                WHERE pp.pk_past_president_id = p_Id AND pp.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_past_president_search_club_members`(
                IN p_ClubId INT,
                IN p_Search VARCHAR(200)
            )
BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.MemberName,
                    CASE
                        WHEN m.ProfilePhotoPath IS NULL OR m.ProfilePhotoPath = '' THEN NULL
                        WHEN m.ProfilePhotoPath LIKE '/Documents/directory/%' THEN m.ProfilePhotoPath
                        ELSE CONCAT('/Documents/directory/', SUBSTRING_INDEX(m.ProfilePhotoPath, '/', -1))
                    END AS ProfilePhotoPath
                FROM club_members cm
                INNER JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
                WHERE cm.fk_club_id = p_ClubId
                  AND cm.isdeleted = 0
                  AND m.isdeleted = 0
                  AND (p_Search = '' OR m.MemberName LIKE CONCAT('%', p_Search, '%'))
                ORDER BY m.MemberName
                LIMIT 20;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_past_president_update`(
                IN p_Id INT,
                IN p_MemberId INT,
                IN p_YearId INT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE past_presidents
                SET fk_member_master_profile_id = p_MemberId,
                    fk_year_id = p_YearId,
                    modified_by = p_ModifiedBy
                WHERE pk_past_president_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_potential_member_create`(
                IN p_ClubId INT,
                IN p_Name VARCHAR(200),
                IN p_Email VARCHAR(200),
                IN p_MobileNumber VARCHAR(20),
                IN p_ReferenceDetails VARCHAR(500),
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO potential_members (fk_club_id, name, email, mobile_number, reference_details, created_by)
                VALUES (p_ClubId, p_Name, p_Email, p_MobileNumber, p_ReferenceDetails, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_potential_member_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE potential_members
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_potential_member_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_potential_member_get_by_club`(
                IN p_ClubId INT,
                IN p_Search VARCHAR(200),
                IN p_PageSize INT,
                IN p_Offset INT
            )
BEGIN
                SELECT pk_potential_member_id AS Id,
                       fk_club_id AS ClubId,
                       name AS Name,
                       email AS Email,
                       mobile_number AS MobileNumber,
                       reference_details AS ReferenceDetails
                FROM potential_members
                WHERE fk_club_id = p_ClubId AND isdeleted = 0
                  AND (p_Search IS NULL OR p_Search = '' OR name LIKE CONCAT('%', p_Search, '%') OR email LIKE CONCAT('%', p_Search, '%') OR mobile_number LIKE CONCAT('%', p_Search, '%'))
                ORDER BY created_date DESC
                LIMIT p_PageSize OFFSET p_Offset;

                SELECT COUNT(*) AS TotalCount
                FROM potential_members
                WHERE fk_club_id = p_ClubId AND isdeleted = 0
                  AND (p_Search IS NULL OR p_Search = '' OR name LIKE CONCAT('%', p_Search, '%') OR email LIKE CONCAT('%', p_Search, '%') OR mobile_number LIKE CONCAT('%', p_Search, '%'));
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_potential_member_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT pk_potential_member_id AS Id,
                       fk_club_id AS ClubId,
                       name AS Name,
                       email AS Email,
                       mobile_number AS MobileNumber,
                       reference_details AS ReferenceDetails
                FROM potential_members
                WHERE pk_potential_member_id = p_Id AND isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_potential_member_update`(
                IN p_Id INT,
                IN p_Name VARCHAR(200),
                IN p_Email VARCHAR(200),
                IN p_MobileNumber VARCHAR(20),
                IN p_ReferenceDetails VARCHAR(500),
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE potential_members
                SET name = p_Name,
                    email = p_Email,
                    mobile_number = p_MobileNumber,
                    reference_details = p_ReferenceDetails,
                    modified_by = p_ModifiedBy
                WHERE pk_potential_member_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_project_create`(
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
                IN p_CategoryId INT,
                IN p_OtherCategory VARCHAR(100),
                IN p_SubCategoryId INT,
                IN p_OtherSubCategory VARCHAR(100),
                IN p_ProjectDate DATE,
                IN p_ProjectCost DECIMAL(15,2),
                IN p_FundingId INT,
                IN p_DirectBeneficiaries INT,
                IN p_ManHours INT,
                IN p_RotariansInvolved INT,
                IN p_RotaractorsInvolved INT,
                IN p_SendWhatsapp TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO rotary_projects (
                    fk_club_id, fk_module_id, fk_year_id, project_type, parent_project_id,
                    ongoing_group_title, is_joint_project, co_host_name, club_role,
                    title, description, location,
                    fk_area_of_focus_id, other_area_of_focus,
                    fk_category_id, other_category,
                    fk_sub_category_id, other_sub_category,
                    project_date, project_cost, fk_funding_id,
                    direct_beneficiaries, man_hours, rotarians_involved, rotaractors_involved,
                    send_whatsapp, created_by
                ) VALUES (
                    p_ClubId, p_ModuleId, p_YearId, p_ProjectType, p_ParentProjectId,
                    p_OngoingGroupTitle, p_IsJointProject, p_CoHostName, p_ClubRole,
                    p_Title, p_Description, p_Location,
                    p_AreaOfFocusId, p_OtherAreaOfFocus,
                    p_CategoryId, p_OtherCategory,
                    p_SubCategoryId, p_OtherSubCategory,
                    p_ProjectDate, p_ProjectCost, p_FundingId,
                    p_DirectBeneficiaries, p_ManHours, p_RotariansInvolved, p_RotaractorsInvolved,
                    p_SendWhatsapp, p_CreatedBy
                );
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_project_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE rotary_projects
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_project_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_project_get_by_club`(
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
                       cat.name AS CategoryName,
                       p.other_category AS OtherCategory,
                       scat.name AS SubCategoryName,
                       p.other_sub_category AS OtherSubCategory,
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
                LEFT JOIN category_master cat ON p.fk_category_id = cat.pk_category_id
                LEFT JOIN sub_category_master scat ON p.fk_sub_category_id = scat.pk_sub_category_id
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
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_project_get_by_id`(IN p_Id INT)
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
                       p.fk_category_id AS CategoryId,
                       cat.name AS CategoryName,
                       p.other_category AS OtherCategory,
                       p.fk_sub_category_id AS SubCategoryId,
                       scat.name AS SubCategoryName,
                       p.other_sub_category AS OtherSubCategory,
                       p.project_date AS ProjectDate,
                       p.project_cost AS ProjectCost,
                       p.fk_funding_id AS FundingId,
                       f.name AS FundingName,
                       p.direct_beneficiaries AS DirectBeneficiaries,
                       p.man_hours AS ManHours,
                       p.rotarians_involved AS RotariansInvolved,
                       p.rotaractors_involved AS RotaractorsInvolved,
                       p.send_whatsapp AS SendWhatsapp,
                       p.is_active AS IsActive
                FROM rotary_projects p
                LEFT JOIN rotary_year_master y ON p.fk_year_id = y.pk_year_id
                LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
                LEFT JOIN category_master cat ON p.fk_category_id = cat.pk_category_id
                LEFT JOIN sub_category_master scat ON p.fk_sub_category_id = scat.pk_sub_category_id
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
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_project_get_ongoing`(
                IN p_ClubId INT,
                IN p_ModuleId INT,
                IN p_Search VARCHAR(100)
            )
BEGIN
                SELECT DISTINCT
                    COALESCE(p.parent_project_id, p.pk_project_id) AS Id,
                    COALESCE(p.ongoing_group_title, p.title) AS Title
                FROM rotary_projects p
                WHERE p.fk_club_id = p_ClubId
                  AND p.fk_module_id = p_ModuleId
                  AND p.project_type = 'ongoing_repeat'
                  AND p.isdeleted = 0
                  AND (p_Search IS NULL OR p_Search = ''
                       OR p.ongoing_group_title LIKE CONCAT('%', p_Search, '%')
                       OR p.title LIKE CONCAT('%', p_Search, '%'))
                ORDER BY Title
                LIMIT 50;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_project_get_public`(
                IN p_ClubId INT,
                IN p_ModuleId INT,
                IN p_YearId INT,
                IN p_Page INT,
                IN p_PageSize INT
            )
BEGIN
                DECLARE v_Offset INT DEFAULT (p_Page - 1) * p_PageSize;

                SELECT p.pk_project_id AS Id,
                       p.title AS Title,
                       p.description AS Description,
                       p.location AS Location,
                       aof.name AS AreaOfFocusName,
                       p.other_area_of_focus AS OtherAreaOfFocus,
                       p.project_date AS ProjectDate,
                       p.project_cost AS ProjectCost,
                       p.direct_beneficiaries AS DirectBeneficiaries,
                       (SELECT image_path FROM rotary_project_photos
                        WHERE fk_project_id = p.pk_project_id AND is_primary = 1 LIMIT 1) AS PrimaryPhotoPath
                FROM rotary_projects p
                LEFT JOIN area_of_focus_master aof ON p.fk_area_of_focus_id = aof.pk_area_of_focus_id
                WHERE p.fk_club_id = p_ClubId
                  AND p.fk_module_id = p_ModuleId
                  AND p.fk_year_id = p_YearId
                  AND p.isdeleted = 0
                  AND p.is_active = 1
                ORDER BY p.project_date DESC
                LIMIT v_Offset, p_PageSize;

                SELECT COUNT(*) AS TotalCount
                FROM rotary_projects
                WHERE fk_club_id = p_ClubId
                  AND fk_module_id = p_ModuleId
                  AND fk_year_id = p_YearId
                  AND isdeleted = 0
                  AND is_active = 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_project_get_years`(
                IN p_ClubId INT,
                IN p_ModuleId INT
            )
BEGIN
                SELECT DISTINCT y.pk_year_id AS Id,
                       y.YearLabel,
                       y.StartDate,
                       y.EndDate,
                       y.IsCurrent
                FROM rotary_year_master y
                WHERE y.isdeleted = 0
                  AND (
                    y.IsCurrent = 1
                    OR y.pk_year_id IN (
                      SELECT DISTINCT fk_year_id FROM rotary_projects
                      WHERE fk_club_id = p_ClubId AND fk_module_id = p_ModuleId AND isdeleted = 0
                    )
                  )
                ORDER BY y.StartDate DESC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_project_photo_add`(
                IN p_ProjectId INT,
                IN p_ImagePath VARCHAR(500),
                IN p_Description VARCHAR(500),
                IN p_IsPrimary TINYINT,
                IN p_SortOrder INT
            )
BEGIN
                IF p_IsPrimary = 1 THEN
                    UPDATE rotary_project_photos SET is_primary = 0 WHERE fk_project_id = p_ProjectId;
                END IF;
                INSERT INTO rotary_project_photos (fk_project_id, image_path, description, is_primary, sort_order)
                VALUES (p_ProjectId, p_ImagePath, p_Description, p_IsPrimary, p_SortOrder);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_project_photo_delete`(IN p_PhotoId INT)
BEGIN
                DELETE FROM rotary_project_photos WHERE pk_photo_id = p_PhotoId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_project_photo_set_primary`(
                IN p_ProjectId INT,
                IN p_PhotoId INT
            )
BEGIN
                UPDATE rotary_project_photos SET is_primary = 0 WHERE fk_project_id = p_ProjectId;
                UPDATE rotary_project_photos SET is_primary = 1 WHERE pk_photo_id = p_PhotoId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_project_update`(
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
                IN p_CategoryId INT,
                IN p_OtherCategory VARCHAR(100),
                IN p_SubCategoryId INT,
                IN p_OtherSubCategory VARCHAR(100),
                IN p_ProjectDate DATE,
                IN p_ProjectCost DECIMAL(15,2),
                IN p_FundingId INT,
                IN p_DirectBeneficiaries INT,
                IN p_ManHours INT,
                IN p_RotariansInvolved INT,
                IN p_RotaractorsInvolved INT,
                IN p_SendWhatsapp TINYINT,
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
                    fk_category_id = p_CategoryId,
                    other_category = p_OtherCategory,
                    fk_sub_category_id = p_SubCategoryId,
                    other_sub_category = p_OtherSubCategory,
                    project_date = p_ProjectDate,
                    project_cost = p_ProjectCost,
                    fk_funding_id = p_FundingId,
                    direct_beneficiaries = p_DirectBeneficiaries,
                    man_hours = p_ManHours,
                    rotarians_involved = p_RotariansInvolved,
                    rotaractors_involved = p_RotaractorsInvolved,
                    send_whatsapp = p_SendWhatsapp,
                    modified_by = p_ModifiedBy
                WHERE pk_project_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_assign_admin`(
                IN p_MemberId INT,
                IN p_ClubId INT,
                IN p_AssignedBy INT
            )
BEGIN
                DECLARE v_HasConflict INT DEFAULT 0;

                -- Check if member has ZonalCoordinator or SuperAdmin role
                SELECT COUNT(*) INTO v_HasConflict
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = p_MemberId
                  AND mr.IsActive = 1 AND mr.isdeleted = 0
                  AND r.RoleName IN ('SuperAdmin', 'ZonalCoordinator');

                IF v_HasConflict > 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Member already has SuperAdmin or Zonal Coordinator role. Cannot assign as Admin.';
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
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_assign_default`(
                IN p_MemberId INT
            )
BEGIN
                INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, AssignedBy)
                SELECT p_MemberId, 1, p_MemberId FROM DUAL
                WHERE NOT EXISTS (
                    SELECT 1 FROM member_roles
                    WHERE fk_member_master_profile_id = p_MemberId
                      AND fk_role_id = 1
                      AND IsActive = 1
                      AND isdeleted = 0
                );
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_check_credentials_exist`(
                IN p_MemberId INT
            )
BEGIN
                SELECT COUNT(*)
                FROM member_credentials
                WHERE fk_member_master_profile_id = p_MemberId
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_check_has_admin`(
                IN p_MemberId INT,
                IN p_ClubId INT
            )
BEGIN
                SELECT COUNT(*)
                FROM member_roles
                WHERE fk_member_master_profile_id = p_MemberId
                  AND fk_role_id = 2
                  AND fk_club_id = p_ClubId
                  AND IsActive = 1
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_check_has_any_admin`(
                IN p_MemberId INT
            )
BEGIN
                SELECT COUNT(*)
                FROM member_roles
                WHERE fk_member_master_profile_id = p_MemberId
                  AND fk_role_id = 2
                  AND IsActive = 1
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_check_has_superadmin`(
                IN p_MemberId INT
            )
BEGIN
                SELECT COUNT(*)
                FROM member_roles
                WHERE fk_member_master_profile_id = p_MemberId
                  AND fk_role_id = 3
                  AND IsActive = 1
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_check_member_exists`(
                IN p_MemberId INT
            )
BEGIN
                SELECT COUNT(*)
                FROM member_master_profile
                WHERE pk_member_master_profile_id = p_MemberId
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_create_credentials`(
                IN p_MemberId INT,
                IN p_Hash VARCHAR(500),
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO member_credentials (
                    fk_member_master_profile_id, PasswordHash, IsTemporaryPassword, IsActive, created_by
                ) VALUES (
                    p_MemberId, p_Hash, 1, 1, p_CreatedBy
                );
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_deactivate_admin`(
                IN p_MemberId INT,
                IN p_ClubId INT,
                IN p_RevokedBy INT
            )
BEGIN
                UPDATE member_roles
                SET IsActive = 0,
                    RevokedDate = NOW(),
                    RevokedBy = p_RevokedBy
                WHERE fk_member_master_profile_id = p_MemberId
                  AND fk_role_id = 2
                  AND fk_club_id = p_ClubId
                  AND IsActive = 1
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_deactivate_credentials`(
                IN p_MemberId INT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE member_credentials
                SET IsActive = 0,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE fk_member_master_profile_id = p_MemberId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_get_active_roles`(
                IN p_MemberId INT
            )
BEGIN
                SELECT r.RoleName
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = p_MemberId
                  AND mr.IsActive = 1
                  AND mr.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_get_members_count`(
                IN p_Search VARCHAR(200)
            )
BEGIN
                SELECT COUNT(*)
                FROM member_master_profile
                WHERE isdeleted = 0
                  AND (p_Search IS NULL
                       OR MemberName LIKE CONCAT('%', p_Search, '%')
                       OR EmailId LIKE CONCAT('%', p_Search, '%')
                       OR PrimaryMobileNumber LIKE CONCAT('%', p_Search, '%'));
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_get_members_paginated`(
                IN p_Search VARCHAR(200),
                IN p_PageSize INT,
                IN p_Offset INT
            )
BEGIN
                SELECT
                    m.pk_member_master_profile_id AS Id,
                    m.MemberName,
                    IFNULL(m.EmailId, '') AS EmailId,
                    IFNULL(m.PrimaryMobileNumber, '') AS PrimaryMobileNumber,
                    GROUP_CONCAT(DISTINCT r.RoleName) AS RoleNames,
                    MAX(CASE WHEN r.RoleName = 'Admin' AND mr.IsActive = 1 THEN 1 ELSE 0 END) AS HasAdminRole,
                    (SELECT COUNT(*) FROM member_credentials mc
                     WHERE mc.fk_member_master_profile_id = m.pk_member_master_profile_id
                       AND mc.IsActive = 1
                       AND mc.isdeleted = 0) AS HasCredentials
                FROM member_master_profile m
                LEFT JOIN member_roles mr
                    ON mr.fk_member_master_profile_id = m.pk_member_master_profile_id
                    AND mr.IsActive = 1
                    AND mr.isdeleted = 0
                LEFT JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE m.isdeleted = 0
                  AND (p_Search IS NULL
                       OR m.MemberName LIKE CONCAT('%', p_Search, '%')
                       OR m.EmailId LIKE CONCAT('%', p_Search, '%')
                       OR m.PrimaryMobileNumber LIKE CONCAT('%', p_Search, '%'))
                GROUP BY m.pk_member_master_profile_id, m.MemberName, m.EmailId, m.PrimaryMobileNumber
                ORDER BY m.pk_member_master_profile_id DESC
                LIMIT p_PageSize OFFSET p_Offset;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_get_member_email`(
                IN p_MemberId INT
            )
BEGIN
                SELECT EmailId, MemberName, PrimaryMobileNumber
                FROM member_master_profile
                WHERE pk_member_master_profile_id = p_MemberId
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_role_update_credentials_for_admin`(
                IN p_MemberId INT,
                IN p_Hash VARCHAR(500),
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE member_credentials
                SET PasswordHash = p_Hash,
                    IsTemporaryPassword = 1,
                    IsActive = 1,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE fk_member_master_profile_id = p_MemberId;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_rotary_year_get_all`()
BEGIN
                SELECT pk_year_id AS Id, YearLabel, StartDate, EndDate, IsCurrent
                FROM rotary_year_master
                WHERE isdeleted = 0
                ORDER BY StartDate DESC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_rotary_year_get_current`()
BEGIN
                SELECT pk_year_id AS Id, YearLabel, StartDate, EndDate, IsCurrent
                FROM rotary_year_master
                WHERE IsCurrent = 1 AND isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_setting_get_all`()
BEGIN
                SELECT pk_setting_id AS Id, SettingKey, SettingValue, Description, modified_by AS ModifiedBy, modified_date AS ModifiedDate
                FROM system_settings
                ORDER BY SettingKey;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_setting_get_by_key`(
                IN p_Key VARCHAR(100)
            )
BEGIN
                SELECT pk_setting_id AS Id, SettingKey, SettingValue, Description, modified_by AS ModifiedBy, modified_date AS ModifiedDate
                FROM system_settings
                WHERE SettingKey = p_Key;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_setting_upsert`(
                IN p_Key VARCHAR(100),
                IN p_Value VARCHAR(500),
                IN p_Description VARCHAR(200),
                IN p_ModifiedBy INT
            )
BEGIN
                INSERT INTO system_settings (SettingKey, SettingValue, Description, modified_by, modified_date)
                VALUES (p_Key, p_Value, p_Description, p_ModifiedBy, NOW())
                ON DUPLICATE KEY UPDATE
                    SettingValue = p_Value,
                    Description = p_Description,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_sub_category_create`(
                IN p_CategoryId INT,
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO sub_category_master (fk_category_id, name, sort_order, is_active, created_by)
                VALUES (p_CategoryId, p_Name, p_SortOrder, p_IsActive, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_sub_category_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE sub_category_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_sub_category_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_sub_category_get_by_category`(IN p_CategoryId INT)
BEGIN
                SELECT pk_sub_category_id AS Id,
                       fk_category_id AS CategoryId,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM sub_category_master
                WHERE fk_category_id = p_CategoryId AND isdeleted = 0
                ORDER BY sort_order, name;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_sub_category_get_by_id`(IN p_Id INT)
BEGIN
                SELECT pk_sub_category_id AS Id,
                       fk_category_id AS CategoryId,
                       name AS Name,
                       sort_order AS SortOrder,
                       is_active AS IsActive
                FROM sub_category_master
                WHERE pk_sub_category_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_sub_category_update`(
                IN p_Id INT,
                IN p_CategoryId INT,
                IN p_Name VARCHAR(200),
                IN p_SortOrder INT,
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE sub_category_master
                SET fk_category_id = p_CategoryId,
                    name = p_Name,
                    sort_order = p_SortOrder,
                    is_active = p_IsActive,
                    modified_by = p_ModifiedBy
                WHERE pk_sub_category_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_theme_create`(
                IN p_ThemeName VARCHAR(100),
                IN p_ThemeImagePath VARCHAR(500),
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO theme_master (theme_name, theme_image_path, created_by)
                VALUES (p_ThemeName, p_ThemeImagePath, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_theme_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE theme_master
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_theme_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_theme_get_all`()
BEGIN
                SELECT pk_theme_id AS Id,
                       theme_name AS ThemeName,
                       CASE
                           WHEN theme_image_path IS NULL OR theme_image_path = '' THEN NULL
                           WHEN theme_image_path LIKE '/%' THEN theme_image_path
                           ELSE CONCAT('/uploads/theme/', theme_image_path)
                       END AS ThemeImagePath
                FROM theme_master
                WHERE isdeleted = 0
                ORDER BY theme_name;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_theme_update`(
                IN p_Id INT,
                IN p_ThemeName VARCHAR(100),
                IN p_ThemeImagePath VARCHAR(500),
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE theme_master
                SET theme_name = p_ThemeName,
                    theme_image_path = p_ThemeImagePath,
                    modified_by = p_ModifiedBy
                WHERE pk_theme_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_upcoming_event_create`(
                IN p_ClubId INT,
                IN p_Title VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_ImagePath VARCHAR(500),
                IN p_EventDate DATE,
                IN p_PublishDate DATE,
                IN p_ExpiryDate DATE,
                IN p_EventVenue VARCHAR(255),
                IN p_RegistrationLink VARCHAR(500),
                IN p_IsSendWhatsapp TINYINT,
                IN p_IsRepeatNotification TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO upcoming_events (fk_club_id, Title, Description, ImagePath, EventDate, PublishDate, ExpiryDate, EventVenue, RegistrationLink, IsSendWhatsapp, IsRepeatNotification, created_by)
                VALUES (p_ClubId, p_Title, p_Description, p_ImagePath, p_EventDate, p_PublishDate, p_ExpiryDate, p_EventVenue, p_RegistrationLink, p_IsSendWhatsapp, p_IsRepeatNotification, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_upcoming_event_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE upcoming_events
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_upcoming_event_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_upcoming_event_get_all_paginated`(
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
                       e.IsSendWhatsapp,
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
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_upcoming_event_get_by_id`(
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
                       e.IsSendWhatsapp,
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
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_upcoming_event_get_years`(
                IN p_ClubId INT
            )
BEGIN
                SELECT DISTINCT y.pk_year_id AS Id, y.YearLabel, y.IsCurrent
                FROM rotary_year_master y
                INNER JOIN upcoming_events e
                  ON e.PublishDate >= y.StartDate
                 AND e.PublishDate < DATE_ADD(y.EndDate, INTERVAL 1 DAY)
                WHERE e.fk_club_id = p_ClubId
                  AND e.isdeleted = 0
                ORDER BY y.pk_year_id DESC;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_upcoming_event_reminder_add`(
                IN p_EventId INT,
                IN p_ReminderDateTime DATETIME,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO upcoming_event_reminders (fk_upcoming_event_id, ReminderDateTime, created_by)
                VALUES (p_EventId, p_ReminderDateTime, p_CreatedBy);

                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_upcoming_event_reminder_delete`(
                IN p_Id INT
            )
BEGIN
                DELETE FROM upcoming_event_reminders
                WHERE pk_reminder_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_upcoming_event_update`(
                IN p_Id INT,
                IN p_Title VARCHAR(50),
                IN p_Description VARCHAR(1000),
                IN p_ImagePath VARCHAR(500),
                IN p_EventDate DATE,
                IN p_PublishDate DATE,
                IN p_ExpiryDate DATE,
                IN p_EventVenue VARCHAR(255),
                IN p_RegistrationLink VARCHAR(500),
                IN p_IsSendWhatsapp TINYINT,
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
                    IsSendWhatsapp = p_IsSendWhatsapp,
                    IsRepeatNotification = p_IsRepeatNotification,
                    modified_by = p_ModifiedBy
                WHERE pk_upcoming_event_id = p_Id
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_website_data_module_create`(
                IN p_ModuleName VARCHAR(100),
                IN p_ModuleKey VARCHAR(50),
                IN p_IconClass VARCHAR(50),
                IN p_CreatedBy INT
            )
BEGIN
                DECLARE v_MaxSort INT;
                SELECT COALESCE(MAX(sort_order), 0) INTO v_MaxSort FROM website_data_module_master WHERE isdeleted = 0;
                INSERT INTO website_data_module_master (module_name, module_key, icon_class, sort_order, created_by)
                VALUES (p_ModuleName, p_ModuleKey, p_IconClass, v_MaxSort + 1, p_CreatedBy);
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_website_data_module_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE website_data_module_master
                SET isdeleted = 1,
                    deleted_by = p_DeletedBy,
                    deleted_date = NOW()
                WHERE pk_website_data_module_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_website_data_module_get_all`()
BEGIN
                SELECT
                    pk_website_data_module_id AS Id,
                    module_name AS ModuleName,
                    module_key AS ModuleKey,
                    icon_class AS IconClass,
                    sort_order AS SortOrder
                FROM website_data_module_master
                WHERE isdeleted = 0
                ORDER BY sort_order;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_website_data_module_swap_order`(
                IN p_Id1 INT,
                IN p_Id2 INT
            )
BEGIN
                DECLARE v_Order1 INT;
                DECLARE v_Order2 INT;
                SELECT sort_order INTO v_Order1 FROM website_data_module_master WHERE pk_website_data_module_id = p_Id1 AND isdeleted = 0;
                SELECT sort_order INTO v_Order2 FROM website_data_module_master WHERE pk_website_data_module_id = p_Id2 AND isdeleted = 0;
                UPDATE website_data_module_master SET sort_order = v_Order2 WHERE pk_website_data_module_id = p_Id1;
                UPDATE website_data_module_master SET sort_order = v_Order1 WHERE pk_website_data_module_id = p_Id2;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_website_data_module_update`(
                IN p_Id INT,
                IN p_ModuleName VARCHAR(100),
                IN p_ModuleKey VARCHAR(50),
                IN p_IconClass VARCHAR(50),
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE website_data_module_master
                SET module_name = p_ModuleName,
                    module_key = p_ModuleKey,
                    icon_class = p_IconClass,
                    modified_by = p_ModifiedBy
                WHERE pk_website_data_module_id = p_Id AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zonal_approve_request`(
                IN p_ApprovalId INT,
                IN p_ZoneId INT,
                IN p_MemberId INT,
                IN p_Remark VARCHAR(1000)
            )
BEGIN
                DECLARE v_ProjectId INT;
                DECLARE v_Requested INT;
                DECLARE v_Status VARCHAR(20);
                DECLARE v_Token VARCHAR(100);

                SELECT fk_project_id, requested_beneficiaries, status, approval_token
                INTO v_ProjectId, v_Requested, v_Status, v_Token
                FROM beneficiary_approval_requests
                WHERE pk_approval_id = p_ApprovalId AND fk_zone_id = p_ZoneId;

                IF v_Status IS NULL THEN
                    SELECT 'not_found' AS Status, 'error' AS Result;
                ELSEIF v_Status != 'pending' THEN
                    SELECT v_Status AS Status, 'already_processed' AS Result;
                ELSE
                    UPDATE beneficiary_approval_requests
                    SET status = 'approved', remark = p_Remark, responded_by = p_MemberId, responded_date = NOW()
                    WHERE pk_approval_id = p_ApprovalId;

                    UPDATE rotary_projects
                    SET direct_beneficiaries = v_Requested, modified_date = NOW()
                    WHERE pk_project_id = v_ProjectId;

                    SELECT 'approved' AS Status, 'success' AS Result, v_Token AS Token;
                END IF;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zonal_coordinator_assign`(
                IN p_MemberId INT,
                IN p_ZoneId INT,
                IN p_AssignedBy INT
            )
BEGIN
                DECLARE v_HasConflict INT DEFAULT 0;

                -- Check if member has SuperAdmin or Admin role
                SELECT COUNT(*) INTO v_HasConflict
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                WHERE mr.fk_member_master_profile_id = p_MemberId
                  AND mr.IsActive = 1 AND mr.isdeleted = 0
                  AND r.RoleName IN ('SuperAdmin', 'Admin');

                IF v_HasConflict > 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Member already has SuperAdmin or Admin role. Cannot assign as Zonal Coordinator.';
                END IF;

                -- Deactivate any existing coordinator for this zone
                UPDATE member_roles
                SET IsActive = 0, RevokedDate = NOW(), RevokedBy = p_AssignedBy
                WHERE fk_role_id = 4 AND fk_zone_id = p_ZoneId AND IsActive = 1 AND isdeleted = 0;

                -- Insert new coordinator role
                INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_zone_id, AssignedBy, AssignedDate, IsActive, isdeleted)
                VALUES (p_MemberId, 4, p_ZoneId, p_AssignedBy, NOW(), 1, 0);
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zonal_coordinator_get_by_zone`(
                IN p_ZoneId INT
            )
BEGIN
                SELECT
                    mr.fk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    m.EmailId AS Email,
                    mr.AssignedDate
                FROM member_roles mr
                JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
                WHERE mr.fk_role_id = 4
                  AND mr.fk_zone_id = p_ZoneId
                  AND mr.IsActive = 1
                  AND mr.isdeleted = 0
                  AND m.isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zonal_coordinator_remove`(
                IN p_ZoneId INT,
                IN p_RevokedBy INT
            )
BEGIN
                UPDATE member_roles
                SET IsActive = 0, RevokedDate = NOW(), RevokedBy = p_RevokedBy
                WHERE fk_role_id = 4 AND fk_zone_id = p_ZoneId AND IsActive = 1 AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zonal_coordinator_search_members`(
                IN p_ZoneId INT,
                IN p_Search VARCHAR(200)
            )
BEGIN
                SELECT DISTINCT
                    m.pk_member_master_profile_id AS MemberId,
                    m.MemberName,
                    m.EmailId AS Email,
                    cl.ClubName,
                    d.DistrictNumber
                FROM member_master_profile m
                JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.isdeleted = 0
                JOIN club_master cl ON cl.pk_club_id = cm.fk_club_id AND cl.isdeleted = 0
                JOIN district_master d ON d.pk_district_id = cl.fk_district_id AND d.isdeleted = 0
                WHERE d.fk_zone_id = p_ZoneId
                  AND m.isdeleted = 0
                  AND (m.MemberName LIKE CONCAT('%', p_Search, '%')
                       OR m.EmailId LIKE CONCAT('%', p_Search, '%'))
                  AND m.pk_member_master_profile_id NOT IN (
                      SELECT mr2.fk_member_master_profile_id FROM member_roles mr2
                      JOIN roles r2 ON r2.pk_role_id = mr2.fk_role_id
                      WHERE mr2.IsActive = 1 AND mr2.isdeleted = 0
                        AND r2.RoleName IN ('SuperAdmin', 'Admin')
                  )
                ORDER BY m.MemberName
                LIMIT 20;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zonal_get_approval_requests`(
                IN p_ZoneId INT,
                IN p_DistrictId INT,
                IN p_Status VARCHAR(20),
                IN p_Page INT,
                IN p_PageSize INT
            )
BEGIN
                DECLARE v_Offset INT;
                SET v_Offset = (p_Page - 1) * p_PageSize;

                SELECT SQL_CALC_FOUND_ROWS
                    bar.pk_approval_id AS Id,
                    bar.fk_project_id AS ProjectId,
                    bar.requested_beneficiaries AS RequestedBeneficiaries,
                    bar.current_limit AS CurrentLimit,
                    bar.approval_token AS ApprovalToken,
                    bar.status AS Status,
                    bar.remark AS Remark,
                    bar.responded_date AS RespondedDate,
                    bar.created_date AS CreatedDate,
                    p.title AS ProjectTitle,
                    p.project_date AS ProjectDate,
                    c.ClubName,
                    d.DistrictNumber,
                    m.MemberName AS RequestedByName
                FROM beneficiary_approval_requests bar
                JOIN rotary_projects p ON p.pk_project_id = bar.fk_project_id
                JOIN club_master c ON c.pk_club_id = bar.fk_club_id
                JOIN district_master d ON d.pk_district_id = c.fk_district_id
                LEFT JOIN member_master m ON m.pk_member_id = bar.requested_by
                WHERE bar.fk_zone_id = p_ZoneId
                  AND (p_DistrictId = 0 OR d.pk_district_id = p_DistrictId)
                  AND (p_Status IS NULL OR p_Status = '' OR bar.status = p_Status)
                ORDER BY
                    CASE bar.status WHEN 'pending' THEN 0 ELSE 1 END,
                    bar.created_date DESC
                LIMIT v_Offset, p_PageSize;

                SELECT FOUND_ROWS() AS TotalCount;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zonal_get_district_clubs`(
                IN p_DistrictId INT
            )
BEGIN
                SELECT pk_club_id AS Id, ClubName, ClubCode
                FROM club_master
                WHERE fk_district_id = p_DistrictId AND isdeleted = 0
                ORDER BY ClubName;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zonal_get_zone_districts`(
                IN p_ZoneId INT
            )
BEGIN
                SELECT pk_district_id AS Id, DistrictNumber, DistrictName
                FROM district_master
                WHERE fk_zone_id = p_ZoneId AND isdeleted = 0
                ORDER BY CAST(DistrictNumber AS UNSIGNED), DistrictNumber;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zonal_get_zone_for_member`(
                IN p_MemberId INT
            )
BEGIN
                SELECT mr.fk_zone_id AS ZoneId, z.ZoneName, z.ZoneCode
                FROM member_roles mr
                JOIN roles r ON r.pk_role_id = mr.fk_role_id
                JOIN zone_master z ON z.pk_zone_id = mr.fk_zone_id
                WHERE mr.fk_member_id = p_MemberId
                  AND r.RoleName = 'ZonalCoordinator'
                  AND mr.is_active = 1
                  AND z.isdeleted = 0
                LIMIT 1;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zonal_reject_request`(
                IN p_ApprovalId INT,
                IN p_ZoneId INT,
                IN p_MemberId INT,
                IN p_Remark VARCHAR(1000)
            )
BEGIN
                DECLARE v_Status VARCHAR(20);
                DECLARE v_Token VARCHAR(100);

                SELECT status, approval_token INTO v_Status, v_Token
                FROM beneficiary_approval_requests
                WHERE pk_approval_id = p_ApprovalId AND fk_zone_id = p_ZoneId;

                IF v_Status IS NULL THEN
                    SELECT 'not_found' AS Status, 'error' AS Result;
                ELSEIF v_Status != 'pending' THEN
                    SELECT v_Status AS Status, 'already_processed' AS Result;
                ELSE
                    UPDATE beneficiary_approval_requests
                    SET status = 'rejected', remark = p_Remark, responded_by = p_MemberId, responded_date = NOW()
                    WHERE pk_approval_id = p_ApprovalId;

                    SELECT 'rejected' AS Status, 'success' AS Result, v_Token AS Token;
                END IF;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zone_check_duplicate`(
                IN p_ZoneName VARCHAR(100),
                IN p_ExcludeId INT
            )
BEGIN
                SELECT COUNT(*)
                FROM zone_master
                WHERE isdeleted = 0
                  AND ZoneName = p_ZoneName
                  AND (p_ExcludeId IS NULL OR pk_zone_id != p_ExcludeId);
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zone_create`(
                IN p_ZoneName VARCHAR(100),
                IN p_IsActive TINYINT,
                IN p_CreatedBy INT
            )
BEGIN
                INSERT INTO zone_master (ZoneName, IsActive, created_by, created_date)
                VALUES (p_ZoneName, p_IsActive, p_CreatedBy, NOW());
                SELECT LAST_INSERT_ID();
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zone_get_all_count`(
                IN p_Search VARCHAR(200),
                IN p_IsActive INT
            )
BEGIN
                SELECT COUNT(*)
                FROM zone_master
                WHERE isdeleted = 0
                  AND (p_Search IS NULL OR ZoneName LIKE CONCAT('%', p_Search, '%'))
                  AND (p_IsActive IS NULL OR IsActive = p_IsActive);
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zone_get_all_paginated`(
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
                     WHERE d3.fk_zone_id = z.pk_zone_id AND cm.isdeleted = 0) AS TotalMembers,
                    coord.MemberName AS CoordinatorName,
                    coord.EmailId AS CoordinatorEmail
                FROM zone_master z
                LEFT JOIN (
                    SELECT mr.fk_zone_id, m.MemberName, m.EmailId
                    FROM member_roles mr
                    JOIN member_master_profile m ON m.pk_member_master_profile_id = mr.fk_member_master_profile_id
                    WHERE mr.fk_role_id = 4 AND mr.IsActive = 1 AND mr.isdeleted = 0 AND m.isdeleted = 0
                ) coord ON coord.fk_zone_id = z.pk_zone_id
                WHERE z.isdeleted = 0
                  AND (p_Search IS NULL OR z.ZoneName LIKE CONCAT('%', p_Search, '%'))
                  AND (p_IsActive IS NULL OR z.IsActive = p_IsActive)
                ORDER BY z.pk_zone_id DESC
                LIMIT p_PageSize OFFSET p_Offset;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zone_get_by_id`(
                IN p_Id INT
            )
BEGIN
                SELECT
                    z.pk_zone_id AS Id,
                    z.ZoneName,
                    z.IsActive,
                    z.created_by AS CreatedBy,
                    z.created_date AS CreatedDate,
                    z.modified_by AS ModifiedBy,
                    z.modified_date AS ModifiedDate,
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
                WHERE z.pk_zone_id = p_Id
                  AND z.isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zone_soft_delete`(
                IN p_Id INT,
                IN p_DeletedBy INT
            )
BEGIN
                UPDATE zone_master
                SET isdeleted = 1, deleted_by = p_DeletedBy, deleted_date = NOW()
                WHERE pk_zone_id = p_Id;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
CREATE PROCEDURE `sp_zone_update`(
                IN p_Id INT,
                IN p_ZoneName VARCHAR(100),
                IN p_IsActive TINYINT,
                IN p_ModifiedBy INT
            )
BEGIN
                UPDATE zone_master SET
                    ZoneName = p_ZoneName,
                    IsActive = p_IsActive,
                    modified_by = p_ModifiedBy,
                    modified_date = NOW()
                WHERE pk_zone_id = p_Id
                  AND isdeleted = 0;
            END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

