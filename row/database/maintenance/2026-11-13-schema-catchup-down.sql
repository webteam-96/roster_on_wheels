-- Undo 2026-11-13-schema-catchup.sql: drops the 15 tables (and everything in them). Back up first.
DROP TABLE IF EXISTS assistant_answer_cache;
DROP TABLE IF EXISTS assistant_budget_monthly;
DROP TABLE IF EXISTS assistant_conversations;
DROP TABLE IF EXISTS assistant_index_items;
DROP TABLE IF EXISTS assistant_messages;
DROP TABLE IF EXISTS assistant_security_events;
DROP TABLE IF EXISTS assistant_usage_daily;
DROP TABLE IF EXISTS assistant_users;
DROP TABLE IF EXISTS goal_rotary_org_values;
DROP TABLE IF EXISTS member_admin_years;
DROP TABLE IF EXISTS rotary_org_club_member_sync_status;
DROP TABLE IF EXISTS rotary_org_sync_logins;
DROP TABLE IF EXISTS rotary_org_sync_requests;
DROP TABLE IF EXISTS year_rule_messages;
DROP TABLE IF EXISTS year_rule_scope_settings;
