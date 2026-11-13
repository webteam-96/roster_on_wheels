-- Member T-shirt size (RIZones pull 2026-11-06): optional, never public. The API adds it on start-up too
-- (DatabaseInitializer); run this only if start-up schema updates are off. Back up first.
ALTER TABLE member_master_profile ADD COLUMN fk_tshirt_size_id INT NULL AFTER BloodGroup;
