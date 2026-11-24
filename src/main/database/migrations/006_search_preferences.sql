CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('include_messages_in_global_search', 'false', CURRENT_TIMESTAMP);

-- FTS5 vocabularies expose normalized tokens for typo-tolerant candidate lookup.
CREATE VIRTUAL TABLE IF NOT EXISTS record_search_vocab
USING fts5vocab(record_search, 'row');

-- Messages have their own opt-in index. They never enter the general FTS index.
CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
  record_id UNINDEXED,
  title,
  body_text,
  normalized_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS message_search_vocab
USING fts5vocab(message_search, 'row');

CREATE TRIGGER IF NOT EXISTS records_message_search_insert
AFTER INSERT ON records
WHEN NEW.section_key = 'messages'
  AND NEW.sensitivity = 'sensitive'
  AND (SELECT setting_value FROM app_settings
       WHERE setting_key = 'include_messages_in_global_search') = 'true'
BEGIN
  INSERT INTO message_search (record_id, title, body_text, normalized_text)
  VALUES (
    NEW.id,
    COALESCE(NEW.title, ''),
    COALESCE(NEW.body_text, ''),
    COALESCE(NEW.normalized_text, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS records_message_search_delete
AFTER DELETE ON records
WHEN OLD.section_key = 'messages'
BEGIN
  DELETE FROM message_search WHERE record_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS records_message_search_update
AFTER UPDATE ON records
WHEN OLD.section_key = 'messages' OR NEW.section_key = 'messages'
BEGIN
  DELETE FROM message_search WHERE record_id = OLD.id;
  INSERT INTO message_search (record_id, title, body_text, normalized_text)
  SELECT
    NEW.id,
    COALESCE(NEW.title, ''),
    COALESCE(NEW.body_text, ''),
    COALESCE(NEW.normalized_text, '')
  WHERE NEW.section_key = 'messages'
    AND NEW.sensitivity = 'sensitive'
    AND (SELECT setting_value FROM app_settings
         WHERE setting_key = 'include_messages_in_global_search') = 'true';
END;
