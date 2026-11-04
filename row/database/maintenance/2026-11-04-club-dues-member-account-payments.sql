-- Which accounts have settled each member's club dues. Settlement writes here; the table was never created.
-- Additive and safe to run twice. Undo: 2026-11-04-club-dues-member-account-payments-down.sql

CREATE TABLE IF NOT EXISTS club_dues_member_account_payments (
    pk_id BIGINT NOT NULL AUTO_INCREMENT,
    fk_club_dues_member_id INT NOT NULL,
    fk_route_account_id INT NOT NULL DEFAULT 0,
    fk_payment_id INT NULL,
    IsPaid TINYINT(1) NOT NULL DEFAULT 0,
    PaidDate DATETIME NULL,
    created_date DATETIME NOT NULL,
    modified_date DATETIME NULL,
    isdeleted TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (pk_id),
    UNIQUE KEY uq_club_dues_member_account (fk_club_dues_member_id, fk_route_account_id),
    KEY ix_club_dues_member_account_payment (fk_payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
