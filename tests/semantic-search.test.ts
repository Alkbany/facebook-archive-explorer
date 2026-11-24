import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { getArchiveSearchSettings, setIncludeMessagesInGlobalSearch, setSemanticSearchEnabled } from '../src/main/database/search-settings-repository';
import { getSemanticSearchStatus, searchSemanticArchiveRecords } from '../src/main/database/semantic-search-service';

const migrationFiles = [
  '001_initial_schema.sql',
  '002_account_names.sql',
  '003_backfill_verified_event_times.sql',
  '004_backfill_fallback_parser_keys.sql',
  '005_media_metadata_scan_state.sql',
  '006_search_preferences.sql',
  '007_semantic_search.sql'
];

const migrations = migrationFiles.map((fileName, index) => ({
  version: index + 1,
  name: fileName.replace(/^\\d+_/u, '').replace(/\\.sql$/u, ''),
  sql: readFileSync(join(process.cwd(), 'src/main/database/migrations', fileName), 'utf8')
}));

describe('local semantic search indexing', () => {
  let database: DatabaseSync;
  let snapshotId: string;
  let postSourceId: number;
  let messageSourceId: number;

  beforeEach(() => {
    database = openAppDatabase(':memory:', migrations);
    const accountId = getOrCreateAccount(database, 'Semantic Search synthetic account');
    snapshotId = 'semantic-search-snapshot';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, 'Synthetic export', 'directory', '/tmp/semantic-search', 'completed', ?, ?)
    `).run(snapshotId, accountId, now, now);
    postSourceId = Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, 'posts/posts.html', 'posts.html', 'posts', 'html', 'completed', ?)
    `).run(snapshotId, now).lastInsertRowid);
    messageSourceId = Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, 'messages/inbox/thread.html', 'thread.html', 'messages', 'html', 'completed', ?)
    `).run(snapshotId, now).lastInsertRowid);
  });

  afterEach(() => database.close());

  function addPost(index: number, title: string, body: string): number {
    const now = new Date().toISOString();
    return Number(database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, ?, 'posts', 'post', ?, ?, ?, 'personal', 1, '{}', ?)
    `).run(snapshotId, postSourceId, index, title, body, title + ' ' + body, now).lastInsertRowid);
  }

  function addMessage(index: number): number {
    const now = new Date().toISOString();
    return Number(database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, ?, 'messages', 'message', 'Private conversation', 'A private journey discussion',
        'private conversation journey discussion', 'sensitive', 0, '{}', ?)
    `).run(snapshotId, messageSourceId, index, now).lastInsertRowid);
  }

  it('backfills already-imported eligible records when Semantic Search is enabled', () => {
    const first = addPost(0, 'Travel planning', 'We discussed a trip to Alexandria');
    const second = addPost(1, 'Reading list', 'A note about books');
    expect(getArchiveSearchSettings(database).semanticSearchEnabled).toBe(false);

    setSemanticSearchEnabled(database, true);
    const jobs = database.prepare(`
      SELECT record_id AS recordId, status FROM semantic_index_jobs
      WHERE snapshot_id = ? ORDER BY record_id
    `).all(snapshotId);

    expect(jobs).toEqual([
      { recordId: first, status: 'pending' },
      { recordId: second, status: 'pending' }
    ]);
    expect(getSemanticSearchStatus(database)).toMatchObject({
      enabled: true, total: 2, pending: 2, completed: 0
    });
  });

  it('queues newly imported records automatically while semantic indexing is enabled', () => {
    setSemanticSearchEnabled(database, true);
    const postId = addPost(0, 'Career discussion', 'A discussion about software work');
    expect(database.prepare(`
      SELECT status FROM semantic_index_jobs WHERE record_id = ?
    `).get(postId)).toMatchObject({ status: 'pending' });
  });

  it('filters semantic results by reliable UTC event dates', () => {
    const first = addPost(0, 'Alexandria travel', 'Planning a dated trip');
    const second = addPost(1, 'Alexandria travel', 'Planning a dated trip');
    const ambiguous = addPost(2, 'Alexandria travel', 'Date not reliable');
    database.prepare("UPDATE records SET event_time_utc = '2022-01-01T00:00:00.000Z' WHERE id = ?").run(first);
    database.prepare("UPDATE records SET event_time_utc = '2023-01-01T00:00:00.000Z' WHERE id = ?").run(second);

    setSemanticSearchEnabled(database, true);
    const now = new Date().toISOString();
    const vector = new Float32Array(384);
    vector[0] = 1;
    const insert = database.prepare(`
      INSERT INTO semantic_embeddings (
        record_id, snapshot_id, model_id, model_version, dimensions, embedding, created_at
      ) VALUES (?, ?, 'Xenova/multilingual-e5-small', 'multilingual-e5-small-v1', 384, ?, ?)
    `);
    for (const id of [first, second, ambiguous]) {
      insert.run(id, snapshotId, Buffer.from(vector.buffer), now);
    }

    const results = searchSemanticArchiveRecords(
      database, snapshotId, vector, null, 0.35, '2022-01-01', '2022-12-31'
    );
    expect(results.map((record) => record.id)).toEqual([first]);
  });

  it('returns stable, non-overlapping semantic pages ordered by similarity and record ID', () => {
    setSemanticSearchEnabled(database, true);
    const now = new Date().toISOString();
    const insert = database.prepare(`
      INSERT INTO semantic_embeddings (
        record_id, snapshot_id, model_id, model_version, dimensions, embedding, created_at
      ) VALUES (?, ?, 'Xenova/multilingual-e5-small', 'multilingual-e5-small-v1', 384, ?, ?)
    `);
    const ids: number[] = [];
    database.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 300; index += 1) {
        const id = addPost(index, `Semantic candidate ${index}`, 'Synthetic ranking fixture');
        ids.push(id);
        const vector = new Float32Array(384);
        vector[0] = 0.5 + (Math.floor(index / 3) / 1_000);
        vector[1] = Math.sqrt(1 - (vector[0] * vector[0]));
        insert.run(id, snapshotId, Buffer.from(vector.buffer), now);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }

    const query = new Float32Array(384);
    query[0] = 1;
    const firstPage = searchSemanticArchiveRecords(database, snapshotId, query, null, 0.35);
    const secondPage = searchSemanticArchiveRecords(database, snapshotId, query, null, 0.35, null, null, 250);
    const expectedOrder: number[] = [];
    for (let group = 99; group >= 0; group -= 1) {
      expectedOrder.push(ids[group * 3], ids[(group * 3) + 1], ids[(group * 3) + 2]);
    }

    expect(firstPage).toHaveLength(250);
    expect(secondPage).toHaveLength(50);
    expect([...firstPage, ...secondPage].map((record) => record.id)).toEqual(expectedOrder);
    expect(new Set([...firstPage, ...secondPage].map((record) => record.id)).size).toBe(300);
  });

  it('rejects semantic result offsets outside the supported paging window', () => {
    setSemanticSearchEnabled(database, true);
    const query = new Float32Array(384);
    query[0] = 1;
    expect(() => searchSemanticArchiveRecords(database, snapshotId, query, null, 0.35, null, null, -1))
      .toThrow(/offset/i);
    expect(() => searchSemanticArchiveRecords(database, snapshotId, query, null, 0.35, null, null, 50_001))
      .toThrow(/offset/i);
  });

  it('keeps sensitive message embeddings out unless global message search is opted in', () => {
    const messageId = addMessage(0);
    setSemanticSearchEnabled(database, true);
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM semantic_index_jobs WHERE record_id = ?'
    ).get(messageId)).toMatchObject({ count: 0 });

    setIncludeMessagesInGlobalSearch(database, true);
    expect(database.prepare(
      'SELECT status FROM semantic_index_jobs WHERE record_id = ?'
    ).get(messageId)).toMatchObject({ status: 'pending' });

    setIncludeMessagesInGlobalSearch(database, false);
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM semantic_index_jobs WHERE record_id = ?'
    ).get(messageId)).toMatchObject({ count: 0 });
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM semantic_embeddings WHERE record_id = ?'
    ).get(messageId)).toMatchObject({ count: 0 });
  });

  it('ranks stored semantic vectors and keeps source provenance', () => {
    const relevantId = addPost(0, 'Weekend trip', 'Planning a journey abroad');
    const unrelatedId = addPost(1, 'Cooking notes', 'A recipe for dinner');
    setSemanticSearchEnabled(database, true);
    const now = new Date().toISOString();
    const relevant = new Float32Array(384);
    relevant[0] = 1;
    const unrelated = new Float32Array(384);
    unrelated[1] = 1;
    const insert = database.prepare(`
      INSERT INTO semantic_embeddings (
        record_id, snapshot_id, model_id, model_version, dimensions, embedding, created_at
      ) VALUES (?, ?, 'Xenova/multilingual-e5-small', 'multilingual-e5-small-v1', 384, ?, ?)
    `);
    insert.run(relevantId, snapshotId, Buffer.from(relevant.buffer), now);
    insert.run(unrelatedId, snapshotId, Buffer.from(unrelated.buffer), now);

    const query = new Float32Array(384);
    query[0] = 1;
    const results = searchSemanticArchiveRecords(database, snapshotId, query);

    expect(results).toEqual([
      expect.objectContaining({
        id: relevantId,
        title: 'Weekend trip',
        sourcePath: 'posts/posts.html',
        matchType: 'semantic',
        similarity: 1
      })
    ]);
  });
});
