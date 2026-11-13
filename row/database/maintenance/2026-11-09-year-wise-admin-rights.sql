-- Year-wise Admin Rights (RIZones pull 2026-11-06). Owner decision 2026-11-09: every current admin keeps
-- ALL years, so nothing changes for anyone on day one. Run AFTER the API has started once (start-up creates
-- member_admin_years, year_rule_scope_settings and year_rule_messages) and BEFORE switching the rule on.
-- Back up member_roles and member_admin_years first. Re-runnable: a second run inserts 0 rows.
-- GrantedBy = 0 marks rows made by this script (the rollback deletes only those, and only untouched ones).

START TRANSACTION;

-- Club Admins: one All-Years grant per member + club.
INSERT INTO member_admin_years
    (fk_member_master_profile_id, fk_club_id, fk_district_id, fk_year_id,
     AllYears, GrantedBy, GrantedDate, IsActive, isdeleted, created_by)
SELECT DISTINCT mr.fk_member_master_profile_id, mr.fk_club_id, 0, 0, 1, 0, NOW(), 1, 0, 0
FROM member_roles mr
WHERE mr.fk_role_id = 2 AND mr.IsActive = 1 AND COALESCE(mr.isdeleted, 0) = 0
  AND COALESCE(mr.fk_club_id, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM member_admin_years g
                  WHERE g.fk_member_master_profile_id = mr.fk_member_master_profile_id
                    AND g.fk_club_id = mr.fk_club_id AND g.fk_district_id = 0 AND g.fk_year_id = 0);

-- District Admins: one All-Years grant per member + district.
INSERT INTO member_admin_years
    (fk_member_master_profile_id, fk_club_id, fk_district_id, fk_year_id,
     AllYears, GrantedBy, GrantedDate, IsActive, isdeleted, created_by)
SELECT DISTINCT mr.fk_member_master_profile_id, 0, mr.fk_district_id, 0, 1, 0, NOW(), 1, 0, 0
FROM member_roles mr
WHERE mr.fk_role_id = 2 AND mr.IsActive = 1 AND COALESCE(mr.isdeleted, 0) = 0
  AND COALESCE(mr.fk_club_id, 0) = 0 AND COALESCE(mr.fk_district_id, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM member_admin_years g
                  WHERE g.fk_member_master_profile_id = mr.fk_member_master_profile_id
                    AND g.fk_club_id = 0 AND g.fk_district_id = mr.fk_district_id AND g.fk_year_id = 0);

COMMIT;

-- Check: must read 0 (an active admin with no grant).
SELECT COUNT(*) AS admins_without_grant
FROM member_roles mr
WHERE mr.fk_role_id = 2 AND mr.IsActive = 1 AND COALESCE(mr.isdeleted, 0) = 0
  AND (COALESCE(mr.fk_club_id, 0) > 0 OR COALESCE(mr.fk_district_id, 0) > 0)
  AND NOT EXISTS (SELECT 1 FROM member_admin_years g
                  WHERE g.fk_member_master_profile_id = mr.fk_member_master_profile_id
                    AND g.IsActive = 1 AND g.isdeleted = 0 AND g.AllYears = 1
                    AND ((COALESCE(mr.fk_club_id, 0) > 0 AND g.fk_club_id = mr.fk_club_id)
                      OR (COALESCE(mr.fk_club_id, 0) = 0 AND g.fk_club_id = 0 AND g.fk_district_id = mr.fk_district_id)));

-- The rule itself stays OFF (start-up seeds the platform default as 0). SuperAdmin switches it on per
-- district or club on Settings > Year-wise Admin Rights.
