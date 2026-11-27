-- Undoes 2026-11-25-member-modules.sql: no module shows to plain members.

SET SQL_SAFE_UPDATES = 0;
UPDATE module_master SET IsDefaultForMember = 0 WHERE IsDefaultForMember = 1;
SET SQL_SAFE_UPDATES = 1;
