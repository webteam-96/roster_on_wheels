-- The club list sorts 31,000+ clubs by name; this index lets it read the first page directly instead of sorting all of them.
-- Additive. Undo: 2026-11-04-club-list-index-down.sql
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'club_master' AND INDEX_NAME = 'idx_club_list_name');
SET @ddl := IF(@exists = 0, 'CREATE INDEX idx_club_list_name ON club_master (isdeleted, ClubName)', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
