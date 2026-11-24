import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, openAppDatabase } from '../src/main/database/connection';
import {
  beginDiscoverySession,
  completeDiscoverySession,
  getOrCreateAccount,
  insertDiscoveredFiles,
  getArchiveSnapshotOpenDetails,
  listArchiveSnapshots
} from '../src/main/database/archive-repository';

const migrations = [
  {
    version: 1,
    name: 'initial_schema',
    sql: readFileSync(resolve(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8')
  },
  {
    version: 2,
    name: 'unique_account_display_names',
    sql: readFileSync(resolve(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8')
  },
  {
    version: 3,
    name: 'backfill_verified_event_times',
    sql: readFileSync(resolve(process.cwd(), 'src/main/database/migrations/003_backfill_verified_event_times.sql'), 'utf8')
  },
  {
    version: 4,
    name: 'backfill_fallback_parser_keys',
    sql: readFileSync(resolve(process.cwd(), 'src/main/database/migrations/004_backfill_fallback_parser_keys.sql'), 'utf8')
  }
] as const;

describe('local SQLite storage', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openAppDatabase(':memory:', migrations);
  });

  afterEach(() => {
    database.close();
  });

  it('applies migrations exactly once and enables foreign keys', () => {
    const initialCount = database.prepare(
      'SELECT COUNT(*) AS count FROM schema_migrations'
    ).get() as { count: number };

    expect(initialCount.count).toBe(4);
    expect(database.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 });

    applyMigrations(database, migrations);

    const finalCount = database.prepare(
      'SELECT COUNT(*) AS count FROM schema_migrations'
    ).get() as { count: number };

    expect(finalCount.count).toBe(4);
  });

  it('backfills only verified Unix timestamps for records imported by older versions', () => {
    const legacyDatabase = openAppDatabase(':memory:', migrations.slice(0, 2));
    try {
      const timestamp = new Date().toISOString();
      legacyDatabase.prepare(
        'INSERT INTO accounts (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run('legacy-account', 'Legacy account', timestamp, timestamp);
      legacyDatabase.prepare(`
        INSERT INTO archive_snapshots (
          id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
        ) VALUES ('legacy-snapshot', 'legacy-account', 'Legacy export', 'directory', '/tmp/legacy', 'completed', ?, ?)
      `).run(timestamp, timestamp);
      const sourceId = legacyDatabase.prepare(`
        INSERT INTO source_files (
          snapshot_id, relative_path, file_name, section_key, detected_format, discovered_at
        ) VALUES ('legacy-snapshot', 'posts/posts.json', 'posts.json', 'posts', 'json', ?)
      `).run(timestamp).lastInsertRowid;
      const insertRecord = legacyDatabase.prepare(`
        INSERT INTO records (
          snapshot_id, source_file_id, source_record_index, section_key, record_type,
          event_time_raw, event_time_utc, created_at
        ) VALUES ('legacy-snapshot', ?, ?, ?, 'test', ?, NULL, ?)
      `);
      insertRecord.run(sourceId, 0, 'posts', '1540000000', timestamp);
      insertRecord.run(sourceId, 1, 'comments', '١٥/١٠/٢٠١٨ ٧:٣٦ ص', timestamp);

      applyMigrations(legacyDatabase, [migrations[2]]);

      const rows = legacyDatabase.prepare(
        'SELECT event_time_utc AS eventTimeUtc FROM records ORDER BY source_record_index'
      ).all() as Array<{ eventTimeUtc: string | null }>;
      expect(rows).toEqual([
        { eventTimeUtc: '2018-10-20T01:46:40.000Z' },
        { eventTimeUtc: null }
      ]);
    } finally {
      legacyDatabase.close();
    }
  });


  it('marks existing generic fallback files so new reviewed parsers can promote them', () => {
    const legacyDatabase = openAppDatabase(':memory:', migrations.slice(0, 3));
    try {
      const timestamp = new Date().toISOString();
      legacyDatabase.prepare(
        'INSERT INTO accounts (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run('fallback-account', 'Fallback account', timestamp, timestamp);
      legacyDatabase.prepare(`
        INSERT INTO archive_snapshots (
          id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
        ) VALUES ('fallback-snapshot', 'fallback-account', 'Fallback export', 'directory', '/tmp/fallback', 'completed', ?, ?)
      `).run(timestamp, timestamp);
      const insertSource = legacyDatabase.prepare(`
        INSERT INTO source_files (
          snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
        ) VALUES ('fallback-snapshot', ?, ?, ?, ?, 'completed', ?)
      `);
      const jsonId = Number(insertSource.run('groups/group_posts.json', 'group_posts.json', 'groups', 'json', timestamp).lastInsertRowid);
      const htmlId = Number(insertSource.run('future/index.html', 'index.html', 'future', 'html', timestamp).lastInsertRowid);
      const textId = Number(insertSource.run('future/readme.txt', 'readme.txt', 'future', 'text', timestamp).lastInsertRowid);
      const emptyId = Number(legacyDatabase.prepare(`
        INSERT INTO source_files (
          snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
        ) VALUES ('fallback-snapshot', 'future/empty.json', 'empty.json', 'future', 'json', 'empty', ?)
      `).run(timestamp).lastInsertRowid);

      const insertRecord = legacyDatabase.prepare(`
        INSERT INTO records (
          snapshot_id, source_file_id, source_record_index, section_key, record_type,
          title, sensitivity, search_enabled, payload_json, created_at
        ) VALUES ('fallback-snapshot', ?, 0, ?, ?, 'Synthetic', 'personal', 1, '{}', ?)
      `);
      insertRecord.run(jsonId, 'groups', 'json_item', timestamp);
      insertRecord.run(htmlId, 'future', 'html_item', timestamp);
      insertRecord.run(textId, 'future', 'text_item', timestamp);

      applyMigrations(legacyDatabase, [migrations[3]]);
      const rows = legacyDatabase.prepare(
        'SELECT id, parser_key AS parserKey FROM source_files ORDER BY id'
      ).all() as Array<{ id: number; parserKey: string | null }>;
      expect(rows).toEqual([
        { id: jsonId, parserKey: 'json_fallback' },
        { id: htmlId, parserKey: 'html_fallback' },
        { id: textId, parserKey: 'text_fallback' },
        { id: emptyId, parserKey: 'json_fallback' }
      ]);
    } finally {
      legacyDatabase.close();
    }
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
        detectedFormat: 'html',
        fileSizeBytes: 24576
      },
      {
        relativePath: 'location/no-data.txt',
        fileName: 'no-data.txt',
        sectionKey: 'location',
        detectedFormat: 'text',
        fileSizeBytes: 0
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
      'SELECT relative_path, status, file_size_bytes FROM source_files WHERE snapshot_id = ? ORDER BY relative_path'
    ).all(session.snapshotId) as Array<{ relative_path: string; status: string; file_size_bytes: number | null }>;

    expect(snapshot.status).toBe('discovered');
    expect(run).toMatchObject({ run_type: 'discovery', status: 'completed', files_discovered: 2 });
    expect(files).toEqual([
      { relative_path: 'friends/friends.html', status: 'discovered', file_size_bytes: 24576 },
      { relative_path: 'location/no-data.txt', status: 'empty', file_size_bytes: 0 }
    ]);

    expect(listArchiveSnapshots(database)).toEqual([
      {
        id: session.snapshotId,
        accountName: 'Test Facebook account',
        backupName: 'Synthetic export',
        status: 'discovered',
        createdAt: expect.any(String),
        filesDiscovered: 2,
        recordsImported: 0
      }
    ]);

  });
  
  it('reconstructs saved snapshot metadata so an existing backup can be reopened', () => {
    const accountId = getOrCreateAccount(database, 'Reopenable account');
    const session = beginDiscoverySession(database, accountId, 'Reopenable export', '/tmp/reopenable-export');
    insertDiscoveredFiles(database, session.snapshotId, [
      { relativePath: 'friends/friends.html', fileName: 'friends.html', sectionKey: 'friends', detectedFormat: 'html' },
      { relativePath: 'posts/your_posts.json', fileName: 'your_posts.json', sectionKey: 'posts', detectedFormat: 'json' },
      { relativePath: 'photos_and_videos/photo.jpg', fileName: 'photo.jpg', sectionKey: 'photos_and_videos', detectedFormat: 'image' },
      { relativePath: 'location/no-data.txt', fileName: 'no-data.txt', sectionKey: 'location', detectedFormat: 'text' }
    ]);
    completeDiscoverySession(database, session, 4);

    expect(getArchiveSnapshotOpenDetails(database, session.snapshotId)).toEqual({
      id: session.snapshotId,
      accountId,
      accountName: 'Reopenable account',
      backupName: 'Reopenable export',
      sourcePath: '/tmp/reopenable-export',
      sourceKind: 'directory',
      createdAt: expect.any(String),
      totalFiles: 4,
      filesByFormat: { html: 1, json: 1, media: 1, other: 1 },
      sectionFileCounts: { friends: 1, location: 1, photos_and_videos: 1, posts: 1 },
      noDataSections: ['location']
    });
    expect(getArchiveSnapshotOpenDetails(database, 'missing-snapshot')).toBeNull();
  });

  
  it('persists ZIP backups as a distinct source kind', () => {
    const accountId = getOrCreateAccount(database, 'ZIP account');
    const session = beginDiscoverySession(database, accountId, 'Facebook export', '/tmp/facebook-export.zip', 'zip');
    completeDiscoverySession(database, session, 0);
    expect(getArchiveSnapshotOpenDetails(database, session.snapshotId)).toMatchObject({
      id: session.snapshotId,
      sourceKind: 'zip',
      sourcePath: '/tmp/facebook-export.zip',
      backupName: 'Facebook export'
    });
  });


  it('reports the current imported record count instead of summing historical retry runs', () => {
    const accountId = getOrCreateAccount(database, 'Retry summary account');
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES ('retry-summary-snapshot', ?, 'Retry summary export', 'directory', '/tmp/retry-summary', 'partial', ?, ?)
    `).run(accountId, timestamp, timestamp);
    const sourceId = Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, discovered_at
      ) VALUES ('retry-summary-snapshot', 'posts/posts.html', 'posts.html', 'posts', 'html', ?)
    `).run(timestamp).lastInsertRowid);
    database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, sensitivity, search_enabled, payload_json, created_at
      ) VALUES ('retry-summary-snapshot', ?, 0, 'posts', 'post', 'Current record', 'personal', 1, '{}', ?)
    `).run(sourceId, timestamp);
    const insertRun = database.prepare(`
      INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, finished_at, files_discovered, records_imported)
      VALUES (?, 'retry-summary-snapshot', 'import', 'completed', ?, ?, 1, ?)
    `);
    insertRun.run('retry-run-one', timestamp, timestamp, 2);
    insertRun.run('retry-run-two', timestamp, timestamp, 1);

    expect(listArchiveSnapshots(database)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'retry-summary-snapshot',
        filesDiscovered: 1,
        recordsImported: 1
      })
    ]));
  });

});
