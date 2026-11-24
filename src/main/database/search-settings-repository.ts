import type { DatabaseSync } from 'node:sqlite';
import type { ArchiveSearchSettings } from '../../shared/archive/search';

const MESSAGE_SEARCH_SETTING = 'include_messages_in_global_search';

export function getArchiveSearchSettings(database: DatabaseSync): ArchiveSearchSettings {
  const row = database.prepare(
    'SELECT setting_value AS value FROM app_settings WHERE setting_key = ?'
  ).get(MESSAGE_SEARCH_SETTING) as { value: string } | undefined;

  return { includeMessagesInGlobalSearch: row?.value === 'true' };
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
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return { includeMessagesInGlobalSearch: enabled };
}
