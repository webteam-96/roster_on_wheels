-- ROW demo data — Monrovia (non-production, illustrative only).
-- Creates an active zone -> district -> club chain, a few members, and a demo
-- SuperAdmin (naren@kaizeninfotech.com). The SuperAdmin role + password are set by
-- the API's DatabaseInitializer on startup when Brand:SuperAdminEmail matches that email
-- (default bootstrap password: Admin@123, flagged temporary).
-- Rerunnable: clears its own rows first. Load with:
--   mysql -u root -P 3306 `row` < row/database/seed-monrovia-demo.sql
SET @now = NOW();

-- Clean prior demo rows (by the markers below) so this is rerunnable.
DELETE cm FROM club_members cm
  JOIN club_master c ON c.pk_club_id = cm.fk_club_id
  JOIN district_master d ON d.pk_district_id = c.fk_district_id
  WHERE d.DistrictNumber = '9101';
DELETE FROM member_credentials WHERE fk_member_master_profile_id IN
  (SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId LIKE '%@monrovia.demo' OR EmailId = 'naren@kaizeninfotech.com');
DELETE FROM member_roles WHERE fk_member_master_profile_id IN
  (SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId LIKE '%@monrovia.demo' OR EmailId = 'naren@kaizeninfotech.com');
DELETE FROM member_master_profile WHERE EmailId LIKE '%@monrovia.demo' OR EmailId = 'naren@kaizeninfotech.com';
DELETE c FROM club_master c JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE d.DistrictNumber = '9101';
DELETE FROM district_master WHERE DistrictNumber = '9101';
DELETE FROM zone_master WHERE ZoneName = 'Zone 22 - Africa (demo)';

-- Zone
INSERT INTO zone_master (ZoneName, IsActive, isdeleted, created_date)
VALUES ('Zone 22 - Africa (demo)', 1, 0, @now);
SET @zone = LAST_INSERT_ID();

-- District (Monrovia, Liberia — illustrative district number)
INSERT INTO district_master (DistrictNumber, IsActive, isdeleted, fk_zone_id, created_date)
VALUES ('9101', 1, 0, @zone, @now);
SET @district = LAST_INSERT_ID();

-- Clubs
INSERT INTO club_master (fk_district_id, ClubRotaryId, ClubName, City, State, IsActive, isdeleted, created_date)
VALUES (@district, 'RC-MONROVIA-01', 'Rotary Club of Monrovia', 'Monrovia', 'Montserrado', 1, 0, @now);
SET @club1 = LAST_INSERT_ID();
INSERT INTO club_master (fk_district_id, ClubRotaryId, ClubName, City, State, IsActive, isdeleted, created_date)
VALUES (@district, 'RC-MONROVIA-02', 'Rotary Club of Monrovia Sinkor', 'Monrovia', 'Montserrado', 1, 0, @now);
SET @club2 = LAST_INSERT_ID();
INSERT INTO club_master (fk_district_id, ClubRotaryId, ClubName, City, State, IsActive, isdeleted, created_date)
VALUES (@district, 'RC-MONROVIA-03', 'Rotary Club of Monrovia Central', 'Monrovia', 'Montserrado', 1, 0, @now);
SET @club3 = LAST_INSERT_ID();

-- Demo SuperAdmin (role + Admin@123 credential are set by the API on startup).
INSERT INTO member_master_profile (MemberName, EmailId, PrimaryMobileNumber, isdeleted, created_date)
VALUES ('Naren (Demo SuperAdmin)', 'naren@kaizeninfotech.com', '770000001', 0, @now);
SET @admin = LAST_INSERT_ID();

-- A few ordinary members to make the clubs non-empty.
INSERT INTO member_master_profile (MemberName, EmailId, PrimaryMobileNumber, isdeleted, created_date) VALUES
 ('Grace Johnson', 'grace.johnson@monrovia.demo', '770000002', 0, @now),
 ('Emmanuel Kollie', 'emmanuel.kollie@monrovia.demo', '770000003', 0, @now),
 ('Fatima Sesay', 'fatima.sesay@monrovia.demo', '770000004', 0, @now),
 ('Joseph Weah', 'joseph.weah@monrovia.demo', '770000005', 0, @now),
 ('Miatta Doe', 'miatta.doe@monrovia.demo', '770000006', 0, @now),
 ('Samuel Tubman', 'samuel.tubman@monrovia.demo', '770000007', 0, @now);

-- Club memberships (all active).
INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, JoinedDate, IsActive, isdeleted, created_date)
SELECT @club1, @admin, @now, 1, 0, @now
UNION ALL SELECT @club1, pk_member_master_profile_id, @now, 1, 0, @now FROM member_master_profile WHERE EmailId IN ('grace.johnson@monrovia.demo','emmanuel.kollie@monrovia.demo')
UNION ALL SELECT @club2, pk_member_master_profile_id, @now, 1, 0, @now FROM member_master_profile WHERE EmailId IN ('fatima.sesay@monrovia.demo','joseph.weah@monrovia.demo')
UNION ALL SELECT @club3, pk_member_master_profile_id, @now, 1, 0, @now FROM member_master_profile WHERE EmailId IN ('miatta.doe@monrovia.demo','samuel.tubman@monrovia.demo');

SELECT 'Monrovia demo seeded' AS status,
  (SELECT COUNT(*) FROM district_master WHERE DistrictNumber='9101') AS districts,
  (SELECT COUNT(*) FROM club_master c JOIN district_master d ON d.pk_district_id=c.fk_district_id WHERE d.DistrictNumber='9101') AS clubs,
  (SELECT COUNT(*) FROM member_master_profile WHERE EmailId LIKE '%@monrovia.demo' OR EmailId='naren@kaizeninfotech.com') AS members;
