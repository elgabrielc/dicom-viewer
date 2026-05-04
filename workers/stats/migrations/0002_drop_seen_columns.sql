-- Remove legacy timestamp storage from the stats worker table.
-- The worker still accepts firstSeen/lastSeen in old client payloads, but
-- validates and strips them before persistence.
DROP INDEX IF EXISTS idx_installs_last_seen;

ALTER TABLE installs DROP COLUMN first_seen;
ALTER TABLE installs DROP COLUMN last_seen;
