-- QR Attendance roll-out switch (Settings > QR Attendance, SuperAdmin). Safe to run more than once.
-- No rows = QR attendance OFF for every club, so this script switches nothing on.
-- The API also creates this table on first use (AttendanceQrSwitch.EnsureTableAsync); same DDL.
-- Undo: DROP TABLE IF EXISTS attendance_qr_settings;

CREATE TABLE IF NOT EXISTS attendance_qr_settings (
    pk_id INT AUTO_INCREMENT PRIMARY KEY,
    fk_club_id INT NOT NULL,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    modified_by INT NULL,
    modified_date DATETIME NOT NULL COMMENT 'UTC',
    UNIQUE KEY uq_attendance_qr_club (fk_club_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
