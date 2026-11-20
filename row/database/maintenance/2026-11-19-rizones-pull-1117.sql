-- RIZones pull 9-17 Nov 2026, ROW form. The API applies this at start (DatabaseInitializer.RizonesPull1117.cs);
-- this file is for running by hand on a server before uploading the API. Additive only. Down: *-down.sql.
-- Dues: NotifyEmail (1 = email members), Currency (ISO code, NULL = instance default). No WhatsApp column (ROW).
ALTER TABLE membership_dues ADD COLUMN NotifyEmail TINYINT(1) NOT NULL DEFAULT 1, ADD COLUMN Currency VARCHAR(3) NULL;
ALTER TABLE club_dues ADD COLUMN NotifyEmail TINYINT(1) NOT NULL DEFAULT 1, ADD COLUMN Currency VARCHAR(3) NULL;
-- Club "Sync from Rotary.org": fk_club_id 0 = district row (every existing row), > 0 = that club.
ALTER TABLE rotary_org_sync_logins ADD COLUMN fk_club_id INT NOT NULL DEFAULT 0 AFTER fk_district_id, ADD KEY ix_rosl_club (fk_club_id, isdeleted);
ALTER TABLE rotary_org_sync_requests ADD COLUMN fk_club_id INT NOT NULL DEFAULT 0 AFTER fk_district_id, ADD KEY ix_rosr_club (fk_club_id, pk_id);

-- RIZones goal module restored 2026-11-20 (owner): per-category goal locks, one-to-one and group goal messages.
-- goal_locks and the goal_role_* tables were on the 2026-10-23 drop list but never dropped; IF NOT EXISTS keeps
-- them as they are. ROW has no Goal Setting Roles screen, so goal_role_assignments stays empty. The API also
-- creates the three message tables on first use; they are here so production does not need CREATE rights.
CREATE TABLE IF NOT EXISTS goal_locks (
    pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    EntityType VARCHAR(10) NOT NULL,
    fk_club_id INT NOT NULL DEFAULT 0,
    fk_district_id INT NOT NULL DEFAULT 0,
    fk_category_id INT NOT NULL,
    fk_year_id INT NOT NULL,
    IsLocked TINYINT(1) NOT NULL DEFAULT 0,
    LockedBy INT NULL,
    LockedDate DATETIME NULL,
    UnlockedBy INT NULL,
    UnlockedDate DATETIME NULL,
    UNIQUE KEY uk_goal_lock (EntityType, fk_club_id, fk_district_id, fk_category_id, fk_year_id),
    FOREIGN KEY (fk_category_id) REFERENCES goal_categories(pk_category_id),
    FOREIGN KEY (fk_year_id) REFERENCES rotary_year_master(pk_year_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS goal_role_assignments (
    pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    fk_member_id INT NOT NULL,
    MemberNameText VARCHAR(200) NULL,
    RoleType VARCHAR(50) NOT NULL,
    AssignmentName VARCHAR(200) NOT NULL,
    RoleTitle VARCHAR(150) NULL,
    Avenue VARCHAR(100) NULL,
    fk_category_id INT NULL,
    fk_zone_id INT NULL,
    HomeDistrictId INT NULL,
    DgYear VARCHAR(40) NULL,
    SupportingText VARCHAR(255) NULL,
    IsActive TINYINT(1) NOT NULL DEFAULT 1,
    AssignedBy INT NULL,
    AssignedDate DATETIME DEFAULT CURRENT_TIMESTAMP,
    RoleEmailSentDate DATETIME NULL,
    RevokedBy INT NULL,
    RevokedDate DATETIME NULL,
    isdeleted TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_goal_role_member (fk_member_id, IsActive),
    FOREIGN KEY (fk_category_id) REFERENCES goal_categories(pk_category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS goal_role_assignment_districts (
    pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    fk_assignment_id INT NOT NULL,
    fk_district_id INT NOT NULL,
    UNIQUE KEY uk_goal_role_assignment_district (fk_assignment_id, fk_district_id),
    FOREIGN KEY (fk_assignment_id) REFERENCES goal_role_assignments(pk_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS goal_role_assignment_zones (
    pk_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    fk_assignment_id INT NOT NULL,
    fk_zone_id INT NOT NULL,
    UNIQUE KEY uk_goal_role_assignment_zone (fk_assignment_id, fk_zone_id),
    FOREIGN KEY (fk_assignment_id) REFERENCES goal_role_assignments(pk_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS goal_direct_messages (
    pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    fk_year_id INT NOT NULL,
    fk_zone_id INT NOT NULL DEFAULT 0,
    SenderMemberId INT NOT NULL,
    SenderKind VARCHAR(30) NOT NULL,
    SenderTitle VARCHAR(200) NULL,
    ReceiverMemberId INT NOT NULL,
    fk_category_id INT NOT NULL,
    fk_district_id INT NOT NULL DEFAULT 0,
    CommentText TEXT NOT NULL,
    created_date DATETIME NOT NULL,
    read_date DATETIME NULL,
    isdeleted TINYINT(1) NOT NULL DEFAULT 0,
    KEY ix_gdm_pair (SenderMemberId, ReceiverMemberId, fk_year_id),
    KEY ix_gdm_recv (ReceiverMemberId, fk_year_id, read_date)
);
CREATE TABLE IF NOT EXISTS goal_group_messages (
    pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    fk_year_id INT NOT NULL,
    fk_zone_id INT NOT NULL,
    GroupKey VARCHAR(60) NOT NULL,
    fk_category_id INT NOT NULL DEFAULT 0,
    fk_district_id INT NOT NULL DEFAULT 0,
    SenderMemberId INT NOT NULL,
    SenderKind VARCHAR(30) NOT NULL,
    SenderTitle VARCHAR(200) NULL,
    BatchId BIGINT NOT NULL DEFAULT 0,
    CommentText TEXT NOT NULL,
    created_date DATETIME NOT NULL,
    isdeleted TINYINT(1) NOT NULL DEFAULT 0,
    KEY ix_ggm_group (fk_zone_id, fk_year_id, GroupKey),
    KEY ix_ggm_sender (SenderMemberId, fk_year_id)
);
CREATE TABLE IF NOT EXISTS goal_group_message_reads (
    fk_member_id INT NOT NULL,
    fk_zone_id INT NOT NULL,
    fk_year_id INT NOT NULL,
    GroupKey VARCHAR(60) NOT NULL,
    LastReadId BIGINT NOT NULL DEFAULT 0,
    modified_date DATETIME NULL,
    PRIMARY KEY (fk_member_id, fk_zone_id, fk_year_id, GroupKey)
);
