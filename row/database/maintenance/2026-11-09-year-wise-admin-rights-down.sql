-- Reverts 2026-11-09-year-wise-admin-rights.sql: deletes the All-Years grants that script made (GrantedBy = 0),
-- leaving any row a person has edited since (modified_by set). Before this, switch the rule OFF everywhere on
-- Settings > Year-wise Admin Rights: that alone stops enforcement without touching data.
DELETE FROM member_admin_years
WHERE GrantedBy = 0 AND created_by = 0 AND modified_by IS NULL AND AllYears = 1 AND fk_year_id = 0;
