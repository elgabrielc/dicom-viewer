-- Remove legacy timestamp storage from the stats worker table.
-- The worker still accepts firstSeen/lastSeen in old client payloads, but
-- validates and strips them before persistence.
--
-- Destructive D1 migration. Deploy the stats worker and dashboard worker from
-- this PR before applying it: the new stats worker stops INSERTing seen columns,
-- and the new dashboard stops SELECTing them. Do not roll back either worker to
-- a build that references first_seen/last_seen after this migration lands.
--
-- Cloudflare D1's SQLite baseline supports native ALTER TABLE ... DROP COLUMN.
DROP INDEX IF EXISTS idx_installs_last_seen;

ALTER TABLE installs DROP COLUMN first_seen;
ALTER TABLE installs DROP COLUMN last_seen;
