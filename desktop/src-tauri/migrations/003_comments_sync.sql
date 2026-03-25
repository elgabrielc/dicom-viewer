-- Add sync columns to comments table for cloud sync support.
-- record_uuid becomes the canonical identifier; deleted_at enables soft delete.

ALTER TABLE comments ADD COLUMN record_uuid TEXT;
ALTER TABLE comments ADD COLUMN created_at INTEGER;
ALTER TABLE comments ADD COLUMN updated_at INTEGER;
ALTER TABLE comments ADD COLUMN deleted_at INTEGER;
ALTER TABLE comments ADD COLUMN device_id TEXT;
ALTER TABLE comments ADD COLUMN sync_version INTEGER DEFAULT 0;

UPDATE comments SET
    record_uuid = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || '4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
    created_at = time,
    updated_at = time
WHERE record_uuid IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_record_uuid
    ON comments(record_uuid) WHERE record_uuid IS NOT NULL;
