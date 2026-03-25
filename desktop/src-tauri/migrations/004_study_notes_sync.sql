ALTER TABLE study_notes ADD COLUMN deleted_at INTEGER;
ALTER TABLE study_notes ADD COLUMN device_id TEXT;
ALTER TABLE study_notes ADD COLUMN sync_version INTEGER DEFAULT 0;

ALTER TABLE series_notes ADD COLUMN deleted_at INTEGER;
ALTER TABLE series_notes ADD COLUMN device_id TEXT;
ALTER TABLE series_notes ADD COLUMN sync_version INTEGER DEFAULT 0;
