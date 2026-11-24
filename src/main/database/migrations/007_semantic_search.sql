INSERT OR IGNORE INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('semantic_search_enabled', 'false', CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS semantic_index_jobs (
  record_id INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  safe_error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (record_id, model_id, model_version),
  FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES archive_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_semantic_jobs_snapshot_status
  ON semantic_index_jobs(snapshot_id, status, updated_at);

CREATE TABLE IF NOT EXISTS semantic_embeddings (
  record_id INTEGER NOT NULL,
  snapshot_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  embedding BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (record_id, model_id, model_version),
  FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES archive_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_semantic_embeddings_snapshot_model
  ON semantic_embeddings(snapshot_id, model_id, model_version, record_id);

CREATE TRIGGER IF NOT EXISTS records_semantic_insert
AFTER INSERT ON records
WHEN (SELECT setting_value FROM app_settings WHERE setting_key = 'semantic_search_enabled') = 'true'
  AND NEW.search_enabled = 1
  AND NEW.sensitivity <> 'sensitive'
  AND (NEW.section_key <> 'messages'
    OR (SELECT setting_value FROM app_settings WHERE setting_key = 'include_messages_in_global_search') = 'true')
BEGIN
  INSERT INTO semantic_index_jobs (
    record_id, snapshot_id, model_id, model_version, status, attempts, updated_at
  ) VALUES (
    NEW.id, NEW.snapshot_id, 'Xenova/multilingual-e5-small', 'multilingual-e5-small-v1',
    'pending', 0, CURRENT_TIMESTAMP
  )
  ON CONFLICT(record_id, model_id, model_version) DO UPDATE SET
    snapshot_id = excluded.snapshot_id,
    status = 'pending',
    attempts = 0,
    safe_error_code = NULL,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS records_semantic_update
AFTER UPDATE OF title, body_text, normalized_text, search_enabled, sensitivity, section_key ON records
BEGIN
  DELETE FROM semantic_embeddings
  WHERE record_id = OLD.id
    AND model_id = 'Xenova/multilingual-e5-small'
    AND model_version = 'multilingual-e5-small-v1';

  DELETE FROM semantic_index_jobs
  WHERE record_id = OLD.id
    AND model_id = 'Xenova/multilingual-e5-small'
    AND model_version = 'multilingual-e5-small-v1';

  INSERT INTO semantic_index_jobs (
    record_id, snapshot_id, model_id, model_version, status, attempts, updated_at
  )
  SELECT
    NEW.id, NEW.snapshot_id, 'Xenova/multilingual-e5-small', 'multilingual-e5-small-v1',
    'pending', 0, CURRENT_TIMESTAMP
  WHERE (SELECT setting_value FROM app_settings WHERE setting_key = 'semantic_search_enabled') = 'true'
    AND NEW.search_enabled = 1
    AND NEW.sensitivity <> 'sensitive'
    AND (NEW.section_key <> 'messages'
      OR (SELECT setting_value FROM app_settings WHERE setting_key = 'include_messages_in_global_search') = 'true')
  ON CONFLICT(record_id, model_id, model_version) DO UPDATE SET
    snapshot_id = excluded.snapshot_id,
    status = 'pending',
    attempts = 0,
    safe_error_code = NULL,
    updated_at = excluded.updated_at;
END;
