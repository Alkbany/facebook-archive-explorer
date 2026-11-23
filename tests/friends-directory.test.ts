import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { listFriendDirectory } from '../src/main/database/friends-repository';

const migrations = [
  {
    version: 1,
    name: 'initial_schema',
    sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8')
  },
  {
    version: 2,
    name: 'unique_account_display_names',
    sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8')
  }
];

describe('Friends directory repository', () => {
  let database: DatabaseSync;
  let snapshotId: string;
  let sourceFileId: number;

  beforeEach(() => {
    database = openAppDatabase(':memory:', migrations);
    const accountId = getOrCreateAccount(database, 'Synthetic friends account');
    snapshotId = 'friends-directory-snapshot';
    const timestamp = new Date().toISOString();

    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, 'Synthetic friends export', 'directory', '/synthetic/friends', 'discovered', ?, ?)
    `).run(snapshotId, accountId, timestamp, timestamp);

    sourceFileId = Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, discovered_at
      ) VALUES (?, 'friends/friends.html', 'friends.html', 'friends', 'html', ?)
    `).run(snapshotId, timestamp).lastInsertRowid);
  });

  afterEach(() => database.close());

  function addFriend(index: number, type: string, name: string, dateRaw: string | null = null): void {
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, event_time_raw, sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, ?, 'friends', ?, ?, ?, 'personal', 1, ?, ?)
    `).run(
      snapshotId,
      sourceFileId,
      index,
      type,
      name,
      dateRaw,
      JSON.stringify({ contact_info_raw: 'private synthetic contact' }),
      timestamp
    );
  }

  it('lists all five relationship groups with aggregate counts', () => {
    addFriend(0, 'friend', 'Layla Ahmed');
    addFriend(1, 'friend', 'Mina Adel');
    addFriend(2, 'received', 'Omar Request', 'Raw received date');
    addFriend(3, 'sent', 'Nour Pending');
    addFriend(4, 'rejected', 'Tarek Rejected');
    addFriend(5, 'removed', 'Salma Removed');

    const result = listFriendDirectory(database, snapshotId);

    expect(result).toMatchObject({
      total: 6,
      page: 1,
      pageSize: 100,
      counts: { all: 6, friends: 2, received: 1, sent: 1, rejected: 1, removed: 1 }
    });
    expect(result.records.map((record) => record.recordType)).toEqual([
      'friend', 'friend', 'sent', 'received', 'removed', 'rejected'
    ]);
    expect(result.records[0]).toMatchObject({
      nameRaw: 'Layla Ahmed',
      recordType: 'friend',
      sourcePath: 'friends/friends.html',
      sourceCardIndex: 0
    });
    expect(result.records[0]).not.toHaveProperty('contactInfoRaw');
  });

  it('filters relationship groups and searches names, raw dates, and source paths', () => {
    addFriend(0, 'friend', 'Layla Ahmed');
    addFriend(1, 'received', 'Omar Request', 'Raw received date');
    addFriend(2, 'sent', 'Nour Pending');

    expect(listFriendDirectory(database, snapshotId, 'received').records).toHaveLength(1);
    expect(listFriendDirectory(database, snapshotId, 'all', 'layla').records[0].nameRaw).toBe('Layla Ahmed');
    expect(listFriendDirectory(database, snapshotId, 'all', 'Raw received').records[0].nameRaw).toBe('Omar Request');
    expect(listFriendDirectory(database, snapshotId, 'all', 'friends/friends').total).toBe(3);
  });

  it('paginates large directories without loading every friend into the renderer', () => {
    for (let index = 0; index < 205; index += 1) {
      addFriend(index, 'friend', `Friend ${String(index).padStart(3, '0')}`);
    }

    const firstPage = listFriendDirectory(database, snapshotId, 'all', '', 1);
    const secondPage = listFriendDirectory(database, snapshotId, 'all', '', 2);
    const finalPage = listFriendDirectory(database, snapshotId, 'all', '', 3);

    expect(firstPage.records).toHaveLength(100);
    expect(secondPage.records).toHaveLength(100);
    expect(finalPage.records).toHaveLength(5);
    expect(firstPage.records[0].id).not.toBe(secondPage.records[0].id);
    expect(finalPage.total).toBe(205);
  });

  it('rejects invalid filters and oversized search values', () => {
    expect(() => listFriendDirectory(database, snapshotId, 'unknown' as never)).toThrow('filter');
    expect(() => listFriendDirectory(database, snapshotId, 'all', 'x'.repeat(101))).toThrow('100 characters');
    expect(() => listFriendDirectory(database, snapshotId, 'all', '', 0)).toThrow('page number');
  });
});
