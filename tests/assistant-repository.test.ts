import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { retrieveArchiveAssistantEvidence } from '../src/main/database/assistant-repository';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { openAppDatabase } from '../src/main/database/connection';
import { setIncludeMessagesInGlobalSearch } from '../src/main/database/search-settings-repository';

const migrationFiles = [
  '001_initial_schema.sql',
  '002_account_names.sql',
  '003_backfill_verified_event_times.sql',
  '004_backfill_fallback_parser_keys.sql',
  '005_media_metadata_scan_state.sql',
  '006_search_preferences.sql',
  '007_semantic_search.sql',
  '008_ai_assistant.sql'
];

const migrations = migrationFiles.map((fileName, index) => ({
  version: index + 1,
  name: fileName.replace(/^\\d+_/u, '').replace(/\\.sql$/u, ''),
  sql: readFileSync(join(process.cwd(), 'src/main/database/migrations', fileName), 'utf8')
}));

describe('archive assistant evidence retrieval', () => {
  let database: DatabaseSync;
  let snapshotId: string;
  let postsSourceId: number;
  let messagesSourceId: number;

  beforeEach(() => {
    database = openAppDatabase(':memory:', migrations);
    const accountId = getOrCreateAccount(database, 'Synthetic assistant account');
    snapshotId = 'assistant-evidence-snapshot';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, 'Synthetic backup', 'directory', '/tmp/assistant-evidence', 'completed', ?, ?)
    `).run(snapshotId, accountId, now, now);

    postsSourceId = Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, 'posts/your_posts.html', 'your_posts.html', 'posts', 'html', 'completed', ?)
    `).run(snapshotId, now).lastInsertRowid);
    messagesSourceId = Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, 'messages/inbox/thread.html', 'thread.html', 'messages', 'html', 'completed', ?)
    `).run(snapshotId, now).lastInsertRowid);
  });

  afterEach(() => database.close());

  function addPost(index: number, title: string, body: string, year: number): number {
    const now = new Date().toISOString();
    const date = `${year}-11-24T10:00:00.000Z`;
    return Number(database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, event_time_raw, event_time_utc,
        sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, ?, 'posts', 'post', ?, ?, ?, ?, ?, 'personal', 1, '{}', ?)
    `).run(
      snapshotId, postsSourceId, index, title, body,
      (title + ' ' + body).toLocaleLowerCase(), date, date, now
    ).lastInsertRowid);
  }

  function addMessage(index: number): number {
    const now = new Date().toISOString();
    return Number(database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, event_time_raw, sensitivity, search_enabled,
        payload_json, created_at
      ) VALUES (?, ?, ?, 'messages', 'message', 'Private plans',
        'A private conversation about software interviews', 'private plans software interviews',
        '2022-11-24', 'sensitive', 0, '{}', ?)
    `).run(snapshotId, messagesSourceId, index, now).lastInsertRowid);
  }

  it('retrieves lexical evidence with the exact source path, card number, and record id', () => {
    const id = addPost(2, 'Software interview', 'We discussed a backend engineering role', 2022);
    const results = retrieveArchiveAssistantEvidence(
      database, snapshotId, 'What did I discuss about software engineering in 2022?'
    );

    expect(results).toEqual([
      expect.objectContaining({
        citation: expect.objectContaining({
          sourceId: 'S1',
          recordId: id,
          sectionKey: 'posts',
          sourcePath: 'posts/your_posts.html',
          sourceCardIndex: 2,
          dateRaw: '2022-11-24T10:00:00.000Z',
          title: 'Software interview'
        })
      })
    ]);
  });

  it('treats a standalone four-digit year as a date filter instead of a text term', () => {
    const inYear = addPost(0, 'Family visit', 'A weekend in Alexandria', 2022);
    addPost(1, 'Family visit', 'A weekend in Alexandria', 2023);

    const results = retrieveArchiveAssistantEvidence(database, snapshotId, '2022');
    expect(results.map((item) => item.citation.recordId)).toEqual([inYear]);
  });

  it('keeps sensitive messages excluded until the independent message-search setting is enabled', () => {
    const messageId = addMessage(0);
    addPost(0, 'Software work', 'We discussed a new engineering role', 2022);

    const beforeOptIn = retrieveArchiveAssistantEvidence(
      database, snapshotId, 'software interview discussion'
    );
    expect(beforeOptIn.map((item) => item.citation.recordId)).not.toContain(messageId);

    setIncludeMessagesInGlobalSearch(database, true);
    const afterOptIn = retrieveArchiveAssistantEvidence(
      database, snapshotId, 'software interview discussion'
    );
    expect(afterOptIn.map((item) => item.citation.recordId)).toContain(messageId);

    setIncludeMessagesInGlobalSearch(database, false);
    const afterOptOut = retrieveArchiveAssistantEvidence(
      database, snapshotId, 'software interview discussion'
    );
    expect(afterOptOut.map((item) => item.citation.recordId)).not.toContain(messageId);
  });

  it('respects the requested archive section and returns no evidence for an empty match', () => {
    addPost(0, 'Software work', 'An engineering project', 2022);
    expect(retrieveArchiveAssistantEvidence(database, snapshotId, 'software project', 'comments')).toEqual([]);
    expect(retrieveArchiveAssistantEvidence(database, snapshotId, 'unrelated phrase not present')).toEqual([]);
  });

  it('rejects invalid or oversized assistant questions before database lookup', () => {
    expect(() => retrieveArchiveAssistantEvidence(database, snapshotId, ' ')).toThrow();
    expect(() => retrieveArchiveAssistantEvidence(database, snapshotId, 'x'.repeat(2_001))).toThrow();
  });
});
