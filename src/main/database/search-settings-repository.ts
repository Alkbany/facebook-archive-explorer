import type { DatabaseSync } from 'node:sqlite';
import type { ArchiveSearchSettings } from '../../shared/archive/search';

const MESSAGE_SEARCH_SETTING = 'include_messages_in_global_search';

export function getArchiveSearchSettings(database: DatabaseSync): ArchiveSearchSettings {
  const row = database.prepare(
    'SELECT setting_value AS value FROM app_settings WHERE setting_key = ?'
  ).get(MESSAGE_SEARCH_SETTING) as { value: string } | undefined;

  const semantic = database.prepare(
    'SELECT setting_value AS value FROM app_settings WHERE setting_key = ?'
  ).get('semantic_search_enabled') as { value: string } | undefined;
  return {
    includeMessagesInGlobalSearch: row?.value === 'true',
    semanticSearchEnabled: semantic?.value === 'true'
  };
}

/**
 * Message content is sensitive and lives in a separate FTS index. This setting
 * explicitly rebuilds or clears that index so disabling it removes all message
 * text from the global-search index immediately.
 */
export function setIncludeMessagesInGlobalSearch(
  database: DatabaseSync,
  enabled: boolean
): ArchiveSearchSettings {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('The message-search setting must be a boolean.');
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(`
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = excluded.updated_at
    `).run(MESSAGE_SEARCH_SETTING, enabled ? 'true' : 'false', new Date().toISOString());

    database.exec('DELETE FROM message_search');
    if (enabled) {
      database.exec(`
        INSERT INTO message_search (record_id, title, body_text, normalized_text)
        SELECT CAST(id AS TEXT), COALESCE(title, ''), COALESCE(body_text, ''),
          COALESCE(normalized_text, '')
        FROM records
        WHERE section_key = 'messages' AND sensitivity = 'sensitive'
      `);
      database.exec(`
        INSERT INTO semantic_index_jobs (
          record_id, snapshot_id, model_id, model_version, status, attempts, updated_at
        )
        SELECT id, snapshot_id, 'Xenova/multilingual-e5-small', 'multilingual-e5-small-v1',
          'pending', 0, CURRENT_TIMESTAMP
        FROM records
        WHERE section_key = 'messages' AND sensitivity = 'sensitive'
          AND (SELECT setting_value FROM app_settings WHERE setting_key = 'semantic_search_enabled') = 'true'
          AND NOT EXISTS (SELECT 1 FROM semantic_embeddings
            WHERE semantic_embeddings.record_id = records.id
              AND semantic_embeddings.model_id = 'Xenova/multilingual-e5-small'
              AND semantic_embeddings.model_version = 'multilingual-e5-small-v1')
        ON CONFLICT(record_id, model_id, model_version) DO UPDATE SET
          status = 'pending', attempts = 0, safe_error_code = NULL, updated_at = excluded.updated_at
      `);
    } else {
      database.exec(`
        DELETE FROM semantic_embeddings WHERE record_id IN (
          SELECT id FROM records WHERE section_key = 'messages' AND sensitivity = 'sensitive'
        )
      `);
      database.exec(`
        DELETE FROM semantic_index_jobs WHERE record_id IN (
          SELECT id FROM records WHERE section_key = 'messages' AND sensitivity = 'sensitive'
        )
      `);
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return getArchiveSearchSettings(database);
}


const SEMANTIC_MODEL_ID = 'Xenova/multilingual-e5-small';
const SEMANTIC_MODEL_VERSION = 'multilingual-e5-small-v1';

export function setSemanticSearchEnabled(
  database: DatabaseSync,
  enabled: boolean
): ArchiveSearchSettings {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('The Semantic Search setting must be a boolean.');
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(`
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES ('semantic_search_enabled', ?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = excluded.updated_at
    `).run(enabled ? 'true' : 'false', new Date().toISOString());

    if (enabled) {
      database.prepare(`
        INSERT INTO semantic_index_jobs (
          record_id, snapshot_id, model_id, model_version, status, attempts, updated_at
        )
        SELECT id, snapshot_id, ?, ?, 'pending', 0, CURRENT_TIMESTAMP
        FROM records
        WHERE search_enabled = 1 AND sensitivity <> 'sensitive'
          AND NOT EXISTS (SELECT 1 FROM semantic_embeddings
            WHERE semantic_embeddings.record_id = records.id
              AND semantic_embeddings.model_id = ? AND semantic_embeddings.model_version = ?)
        ON CONFLICT(record_id, model_id, model_version) DO UPDATE SET
          snapshot_id = excluded.snapshot_id,
          status = 'pending',
          attempts = 0,
          safe_error_code = NULL,
          updated_at = excluded.updated_at
      `).run(SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION, SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION);

      const messagesEnabled = (database.prepare(
        "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'include_messages_in_global_search'"
      ).get() as { value: string } | undefined)?.value === 'true';

      if (messagesEnabled) {
        database.prepare(`
          INSERT INTO semantic_index_jobs (
            record_id, snapshot_id, model_id, model_version, status, attempts, updated_at
          )
          SELECT id, snapshot_id, ?, ?, 'pending', 0, CURRENT_TIMESTAMP
          FROM records
          WHERE section_key = 'messages' AND sensitivity = 'sensitive'
            AND NOT EXISTS (SELECT 1 FROM semantic_embeddings
              WHERE semantic_embeddings.record_id = records.id
                AND semantic_embeddings.model_id = ? AND semantic_embeddings.model_version = ?)
          ON CONFLICT(record_id, model_id, model_version) DO UPDATE SET
            snapshot_id = excluded.snapshot_id,
            status = 'pending',
            attempts = 0,
            safe_error_code = NULL,
            updated_at = excluded.updated_at
        `).run(SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION, SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION);
      }
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return getArchiveSearchSettings(database);
}
