-- Reverts 2026-11-09-member-tshirt-size.sql. Deletes every saved member T-shirt size.
ALTER TABLE member_master_profile DROP COLUMN fk_tshirt_size_id;
