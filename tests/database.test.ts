import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, openAppDatabase } from '../src/main/database/connection';
import {
  beginDiscoverySession,
  getOrCreateAccount,
  completeDiscoverySession,
  insertDiscoveredFiles
} from '../src/main/database/archive-repository';

const initialSchema = readFileSync(
  resolve(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'),
  'utf8'
);

describe('local SQLite storage', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openAppDatabase(':memory:', [
      { version: 1, name: 'initial_schema', sql: initialSchema }
    ]);
  });

  afterEach(() => {
    database.close();
  });

  it('applies migrations exactly once and enables foreign keys', () => {
    const initialCount = database.prepare(
      'SELECT COUNT(*) AS count FROM schema_migrations'
    ).get() as { count: number };

    expect(initialCount.count).toBe(1);
    expect(database.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 });

    applyMigrations(database, [{ version: 1, name: 'initial_schema', sql: initialSchema }]);

    const finalCount = database.prepare(
      'SELECT COUNT(*) AS count FROM schema_migrations'
    ).get() as { count: number };

    expect(finalCount.count).toBe(1);
  });

  it('indexes eligible text in FTS5 and blocks sensitive records from the index', () => {
    const timestamp = new Date().toISOString();
    database.prepare(
      'INSERT INTO accounts (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run('account-1', 'Test account', timestamp, timestamp);

    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)
    `).run('snapshot-1', 'account-1', 'Synthetic export', '/tmp/synthetic-export', timestamp, timestamp);

    const sourceFileId = database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('snapshot-1', 'posts/your_posts.html', 'your_posts.html', 'posts', 'html', timestamp).lastInsertRowid;

    database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        body_text, normalized_text, sensitivity, search_enabled, created_at
      ) VALUES (?, ?, 0, 'posts', 'post', ?, ?, 'personal', 1, ?)
    `).run('snapshot-1', sourceFileId, 'synthetic phrase searchable', 'synthetic phrase searchable', timestamp);

    const indexed = database.prepare(
      "SELECT record_id FROM record_search WHERE record_search MATCH 'searchable'"
    ).get() as { record_id: number } | undefined;
    expect(indexed).toBeDefined();

    expect(() => database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        body_text, normalized_text, sensitivity, search_enabled, created_at
      ) VALUES (?, ?, 1, 'posts', 'private', ?, ?, 'sensitive', 1, ?)
    `).run('snapshot-1', sourceFileId, 'sensitive synthetic value', 'sensitive synthetic value', timestamp)).toThrow();
  });

  it('creates separate accounts by label and reuses an existing label', () => {
    const personalId = getOrCreateAccount(database, 'Personal');
    const samePersonalId = getOrCreateAccount(database, ' personal  ');
    const secondId = getOrCreateAccount(database, 'Family account');

    expect(samePersonalId).toBe(personalId);
    expect(secondId).not.toBe(personalId);
  });

  it('persists a discovery session and every discovered source file', () => {
    const accountId = getOrCreateAccount(database, 'Test Facebook account');
    const session = beginDiscoverySession(database, accountId, 'Synthetic export', '/tmp/synthetic-export');

    insertDiscoveredFiles(database, session.snapshotId, [
      {
        relativePath: 'friends/friends.html',
        fileName: 'friends.html',
        sectionKey: 'friends',
        detectedFormat: 'html'
      },
      {
        relativePath: 'location/no-data.txt',
        fileName: 'no-data.txt',
        sectionKey: 'location',
        detectedFormat: 'text'
      }
    ]);

    completeDiscoverySession(database, session, 2);

    const snapshot = database.prepare(
      'SELECT status FROM archive_snapshots WHERE id = ?'
    ).get(session.snapshotId) as { status: string };
    const run = database.prepare(
      'SELECT run_type, status, files_discovered FROM import_runs WHERE id = ?'
    ).get(session.importRunId) as { run_type: string; status: string; files_discovered: number };
    const files = database.prepare(
      'SELECT relative_path, status FROM source_files WHERE snapshot_id = ? ORDER BY relative_path'
    ).all(session.snapshotId) as Array<{ relative_path: string; status: string }>;

    expect(snapshot.status).toBe('discovered');
    expect(run).toMatchObject({ run_type: 'discovery', status: 'completed', files_discovered: 2 });
    expect(files).toEqual([
      { relative_path: 'friends/friends.html', status: 'discovered' },
      { relative_path: 'location/no-data.txt', status: 'empty' }
    ]);
  });
});
