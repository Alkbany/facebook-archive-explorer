import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { listFallbackArchiveRecords, listFallbackRecordSections } from '../src/main/database/fallback-records-repository';

describe('fallback archive records repository', () => {
  let database: DatabaseSync;
  let snapshotId: string;

  beforeEach(() => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    const accountId = getOrCreateAccount(database, 'Fallback repository account');
    snapshotId = 'fallback-repository-snapshot';
    const now = new Date().toISOString();
    database.prepare('INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(snapshotId, accountId, 'Synthetic export', 'directory', '/synthetic', 'completed', now, now);

    const insertSource = database.prepare('INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const groupSource = Number(insertSource.run(snapshotId, 'groups/groups.json', 'groups.json', 'groups', 'json', 'completed', now).lastInsertRowid);
    const securitySource = Number(insertSource.run(snapshotId, 'security_and_login_information/login.html', 'login.html', 'security_and_login_information', 'html', 'completed', now).lastInsertRowid);
    const insertRecord = database.prepare('INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type, title, body_text, event_time_raw, sensitivity, search_enabled, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertRecord.run(snapshotId, groupSource, 0, 'groups', 'json_item', 'Chess Club', 'Weekly games', 'Raw date', 'personal', 1, '{}', now);
    insertRecord.run(snapshotId, groupSource, 1, 'groups', 'html_item', 'Book Club', 'Reading group', null, 'personal', 1, '{}', now);
    insertRecord.run(snapshotId, securitySource, 0, 'security_and_login_information', 'html_item', 'Login record', 'Private session', null, 'sensitive', 0, '{}', now);
  });

  afterEach(() => database.close());

  it('lists fallback sections and sensitivity without adding sensitive records to search', () => {
    expect(listFallbackRecordSections(database, snapshotId)).toEqual([
      { sectionKey: 'groups', recordCount: 2, sensitivity: 'personal' },
      { sectionKey: 'security_and_login_information', recordCount: 1, sensitivity: 'sensitive' }
    ]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM record_search').get()).toMatchObject({ count: 2 });
  });

  it('paginates within a selected section and returns source provenance', () => {
    expect(listFallbackArchiveRecords(database, snapshotId, 'groups', 1)).toMatchObject({
      total: 2, page: 1, pageSize: 40,
      records: [
        { sectionKey: 'groups', title: 'Chess Club', sourcePath: 'groups/groups.json', sourceRecordIndex: 0, payloadPreview: '{}', payloadTruncated: false },
        { sectionKey: 'groups', title: 'Book Club', sourcePath: 'groups/groups.json', sourceRecordIndex: 1, payloadPreview: '{}', payloadTruncated: false }
      ]
    });
    expect(listFallbackArchiveRecords(database, snapshotId, 'security_and_login_information', 1).records[0])
      .toMatchObject({ sensitivity: 'sensitive', body: 'Private session' });
  });

  it('searches only within the selected section, including sensitive records locally', () => {
    expect(listFallbackArchiveRecords(database, snapshotId, 'groups', 1, 'Weekly'))
      .toMatchObject({ total: 1, records: [{ title: 'Chess Club', body: 'Weekly games' }] });
    expect(listFallbackArchiveRecords(database, snapshotId, 'groups', 1, 'groups.json'))
      .toMatchObject({ total: 2 });
    expect(listFallbackArchiveRecords(database, snapshotId, 'groups', 1, 'no matching content'))
      .toMatchObject({ total: 0, records: [] });
    expect(listFallbackArchiveRecords(database, snapshotId, 'security_and_login_information', 1, 'Private'))
      .toMatchObject({ total: 1, records: [{ title: 'Login record', sensitivity: 'sensitive' }] });
    expect(database.prepare('SELECT COUNT(*) AS count FROM record_search').get()).toMatchObject({ count: 2 });
  });

  it('rejects invalid section keys and page numbers', () => {
    expect(() => listFallbackArchiveRecords(database, snapshotId, '../messages', 1)).toThrow();
    expect(() => listFallbackArchiveRecords(database, snapshotId, 'groups', 0)).toThrow();
    expect(() => listFallbackArchiveRecords(database, snapshotId, 'groups', 1, 'x'.repeat(121))).toThrow();
  });
});
