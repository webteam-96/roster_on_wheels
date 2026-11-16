-- District and Club subscriptions (document KIS/ROW/SUB/01).
-- tenant_subscriptions already holds one row per district (fk_club_id = 0) and per club; these tables add
-- the purchase orders, the prices a Super Admin sets, and the RI officer data that decides who may buy and sign in.
-- Undo: 2026-11-13-subscriptions-down.sql

CREATE TABLE IF NOT EXISTS subscription_prices (
    kind ENUM('district','club') NOT NULL PRIMARY KEY,
    amount DECIMAL(10,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    modified_by INT NULL,
    modified_date DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_orders (
    pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    kind ENUM('district','club') NOT NULL,
    fk_district_id INT NOT NULL,
    fk_club_id INT NOT NULL DEFAULT 0,
    fk_buyer_member_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    status ENUM('created','paid','failed') NOT NULL DEFAULT 'created',
    is_renewal TINYINT(1) NOT NULL DEFAULT 0,
    merchant_order_id VARCHAR(40) NULL,
    gateway_payment_id VARCHAR(100) NULL,
    paid_via ENUM('online','offline') NULL,
    term_start DATE NULL,
    term_end DATE NULL,
    paid_date DATETIME NULL,
    created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_sub_order_merchant (merchant_order_id),
    KEY ix_sub_order_scope (fk_district_id, fk_club_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- RI club officers (GET clubs/{type}/{id}/officers), current, previous and next Rotary year.
CREATE TABLE IF NOT EXISTS ri_club_officers (
    pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    fk_club_id INT NOT NULL,
    ri_member_id BIGINT NOT NULL,
    officer_role VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    first_name VARCHAR(100) NULL,
    last_name VARCHAR(100) NULL,
    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ri_officer (fk_club_id, ri_member_id, officer_role, start_date),
    KEY ix_ri_officer_member (ri_member_id),
    KEY ix_ri_officer_club_dates (fk_club_id, start_date, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- When a club's officers were last read, and whether RI had none (section 5: flag to the district).
CREATE TABLE IF NOT EXISTS ri_club_officer_sync (
    fk_club_id INT NOT NULL PRIMARY KEY,
    synced_at DATETIME NOT NULL,
    officer_count INT NOT NULL DEFAULT 0,
    status ENUM('ok','no_officers','not_synced','error') NOT NULL,
    message VARCHAR(500) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email sign-in codes for club executives (sections 4.1 step 4, 4.2 step 1). Only a hash of the code is kept.
CREATE TABLE IF NOT EXISTS exec_signin_codes (
    pk_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    fk_member_id INT NOT NULL,
    code_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts TINYINT NOT NULL DEFAULT 0,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY ix_exec_code_member (fk_member_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Club admin roles that come from being an executive under a subscription (revoked when the office or access ends).
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'member_roles' AND COLUMN_NAME = 'via_subscription');
SET @s := IF(@c = 0, 'ALTER TABLE member_roles ADD COLUMN via_subscription TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
