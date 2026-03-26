-- Add sync columns to reports table for cloud sync support.
-- content_hash: SHA-256 hex digest of report file bytes (dedup/integrity).
-- deleted_at: soft-delete timestamp (ms epoch); NULL = active.
-- device_id: originating device identifier from sync_state.
-- sync_version: monotonic version counter for conflict resolution.

ALTER TABLE reports ADD COLUMN content_hash TEXT;
ALTER TABLE reports ADD COLUMN deleted_at INTEGER;
ALTER TABLE reports ADD COLUMN device_id TEXT;
ALTER TABLE reports ADD COLUMN sync_version INTEGER DEFAULT 0;
