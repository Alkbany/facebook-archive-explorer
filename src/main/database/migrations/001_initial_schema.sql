PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS archive_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('directory', 'zip')),
  source_path TEXT NOT NULL,
  source_fingerprint TEXT,
  export_created_at_raw TEXT,
  imported_at TEXT,
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered', 'importing', 'partial', 'completed', 'failed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_account
  ON archive_snapshots(account_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_fingerprint
  ON archive_snapshots(account_id, source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS source_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  section_key TEXT NOT NULL,
  detected_format TEXT NOT NULL DEFAULT 'unknown'
    CHECK (detected_format IN ('html', 'json', 'text', 'image', 'video', 'audio', 'other', 'unknown')),
  file_size_bytes INTEGER,
  sha256 TEXT,
  parser_key TEXT,
  status TEXT NOT NULL DEFAULT 'discovered'
    CHECK (status IN ('discovered', 'queued', 'processing', 'completed', 'empty', 'unsupported', 'failed', 'skipped')),
  record_count INTEGER NOT NULL DEFAULT 0,
  safe_error_code TEXT,
  discovered_at TEXT NOT NULL,
  processed_at TEXT,
  UNIQUE (snapshot_id, relative_path),
  FOREIGN KEY (snapshot_id) REFERENCES archive_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_files_snapshot_status
  ON source_files(snapshot_id, status);

CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  run_type TEXT NOT NULL DEFAULT 'import'
    CHECK (run_type IN ('discovery', 'import')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  last_completed_source_file_id INTEGER,
  files_discovered INTEGER NOT NULL DEFAULT 0,
  files_processed INTEGER NOT NULL DEFAULT 0,
  records_imported INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  resume_state_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (snapshot_id) REFERENCES archive_snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (last_completed_source_file_id) REFERENCES source_files(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_import_runs_snapshot
  ON import_runs(snapshot_id, started_at);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id TEXT NOT NULL,
  source_file_id INTEGER NOT NULL,
  source_record_index INTEGER NOT NULL,
  section_key TEXT NOT NULL,
  record_type TEXT NOT NULL,
  title TEXT,
  body_text TEXT,
  normalized_text TEXT,
  event_time_raw TEXT,
  event_time_utc TEXT,
  sensitivity TEXT NOT NULL DEFAULT 'personal'
    CHECK (sensitivity IN ('standard', 'personal', 'sensitive')),
  search_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (search_enabled IN (0, 1)),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (source_file_id, source_record_index),
  CHECK (search_enabled = 0 OR sensitivity <> 'sensitive'),
  FOREIGN KEY (snapshot_id) REFERENCES archive_snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_records_snapshot_section
  ON records(snapshot_id, section_key);

CREATE INDEX IF NOT EXISTS idx_records_source
  ON records(source_file_id, source_record_index);

CREATE INDEX IF NOT EXISTS idx_records_event_time
  ON records(snapshot_id, event_time_utc);

CREATE VIRTUAL TABLE IF NOT EXISTS record_search USING fts5(
  record_id UNINDEXED,
  title,
  body_text,
  normalized_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS records_search_insert
AFTER INSERT ON records
WHEN NEW.search_enabled = 1
BEGIN
  INSERT INTO record_search (record_id, title, body_text, normalized_text)
  VALUES (
    NEW.id,
    COALESCE(NEW.title, ''),
    COALESCE(NEW.body_text, ''),
    COALESCE(NEW.normalized_text, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS records_search_delete
AFTER DELETE ON records
BEGIN
  DELETE FROM record_search WHERE record_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS records_search_update
AFTER UPDATE ON records
BEGIN
  DELETE FROM record_search WHERE record_id = OLD.id;
  INSERT INTO record_search (record_id, title, body_text, normalized_text)
  SELECT
    NEW.id,
    COALESCE(NEW.title, ''),
    COALESCE(NEW.body_text, ''),
    COALESCE(NEW.normalized_text, '')
  WHERE NEW.search_enabled = 1;
END;

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id TEXT NOT NULL,
  source_file_id INTEGER,
  relative_path TEXT NOT NULL,
  media_kind TEXT NOT NULL
    CHECK (media_kind IN ('image', 'video', 'audio', 'sticker', 'document', 'unknown')),
  mime_type TEXT,
  file_size_bytes INTEGER,
  sha256 TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (snapshot_id, relative_path),
  FOREIGN KEY (snapshot_id) REFERENCES archive_snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_media_snapshot_kind
  ON media_assets(snapshot_id, media_kind);

CREATE TABLE IF NOT EXISTS record_media (
  record_id INTEGER NOT NULL,
  media_asset_id INTEGER NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  role TEXT,
  PRIMARY KEY (record_id, media_asset_id),
  FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE,
  FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_run_id TEXT NOT NULL,
  source_file_id INTEGER,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  issue_code TEXT NOT NULL,
  safe_message TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (import_run_id) REFERENCES import_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (source_file_id) REFERENCES source_files(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_import_issues_run
  ON import_issues(import_run_id, severity);
