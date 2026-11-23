import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { listArchiveFiles } from '../src/main/database/archive-files-repository';

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

describe('Archive file directory repository', () => {
  let database: DatabaseSync;
  let snapshotId: string;

  beforeEach(() => {
    database = openAppDatabase(':memory:', migrations);
    const accountId = getOrCreateAccount(database, 'Synthetic archive file account');
    snapshotId = 'archive-file-directory-snapshot';
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, 'Synthetic file inventory', 'directory', '/synthetic/archive', 'discovered', ?, ?)
    `).run(snapshotId, accountId, timestamp, timestamp);
  });

  afterEach(() => database.close());

  function addFile(index: number, data: {
    path: string; section: string; format: string; status: string; error?: string | null;
  }): void {
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format,
        file_size_bytes, status, record_count, safe_error_code, discovered_at, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshotId, data.path, data.path.split('/').at(-1), data.section, data.format,
      (index + 1) * 1024, data.status, index, data.error ?? null, timestamp,
      data.status === 'completed' || data.status === 'unsupported' || data.status === 'failed' ? timestamp : null
    );
  }

  it('lists every discovered source file with status, format, size, and safe diagnostics code', () => {
    addFile(0, { path: 'friends/friends.html', section: 'friends', format: 'html', status: 'completed' });
    addFile(1, { path: 'groups/your_groups.json', section: 'groups', format: 'json', status: 'unsupported', error: 'GROUPS_JSON_NOT_SUPPORTED' });
    addFile(2, { path: 'posts/your_posts.html', section: 'posts', format: 'html', status: 'failed', error: 'POST_IMPORT_FAILED' });

    const result = listArchiveFiles(database, snapshotId);

    expect(result).toMatchObject({
      total: 3,
      page: 1,
      pageSize: 100,
      counts: {
        all: 3, discovered: 0, queued: 0, processing: 0,
        completed: 1, empty: 0, unsupported: 1, failed: 1, skipped: 0
      }
    });
    expect(result.records[0]).toMatchObject({
      relativePath: 'friends/friends.html',
      fileName: 'friends.html',
      sectionKey: 'friends',
      detectedFormat: 'html',
      status: 'completed',
      fileSizeBytes: 1024,
      recordCount: 0
    });
    expect(result.records[1].safeErrorCode).toBe('GROUPS_JSON_NOT_SUPPORTED');
  });

  it('filters by section and processing status, and searches paths and error codes', () => {
    addFile(0, { path: 'friends/friends.html', section: 'friends', format: 'html', status: 'completed' });
    addFile(1, { path: 'groups/your_groups.json', section: 'groups', format: 'json', status: 'unsupported', error: 'GROUPS_JSON_NOT_SUPPORTED' });
    addFile(2, { path: 'posts/your_posts.html', section: 'posts', format: 'html', status: 'failed', error: 'POST_IMPORT_FAILED' });

    expect(listArchiveFiles(database, snapshotId, 'unsupported').records).toHaveLength(1);
    expect(listArchiveFiles(database, snapshotId, 'all', 'groups').records[0].fileName).toBe('your_groups.json');
    expect(listArchiveFiles(database, snapshotId, 'all', 'all', 'GROUPS_JSON').total).toBe(1);
    expect(listArchiveFiles(database, snapshotId, 'all', 'all', 'posts/your_posts').records[0].status).toBe('failed');
  });

  it('paginates large inventories and clamps requests beyond the final page', () => {
    for (let index = 0; index < 205; index += 1) {
      addFile(index, {
        path: 'posts/post-' + String(index).padStart(3, '0') + '.html',
        section: 'posts', format: 'html', status: 'discovered'
      });
    }
    const first = listArchiveFiles(database, snapshotId, 'all', 'all', '', 1);
    const second = listArchiveFiles(database, snapshotId, 'all', 'all', '', 2);
    const final = listArchiveFiles(database, snapshotId, 'all', 'all', '', 99);
    expect(first.records).toHaveLength(100);
    expect(second.records).toHaveLength(100);
    expect(final.records).toHaveLength(5);
    expect(final.page).toBe(3);
  });

  it('rejects invalid filters and oversized queries', () => {
    expect(() => listArchiveFiles(database, snapshotId, 'unknown' as never)).toThrow('status');
    expect(() => listArchiveFiles(database, snapshotId, 'all', 'bad-section!')).toThrow('section');
    expect(() => listArchiveFiles(database, snapshotId, 'all', 'all', 'x'.repeat(121))).toThrow('120 characters');
    expect(() => listArchiveFiles(database, snapshotId, 'all', 'all', '', 0)).toThrow('page number');
  });
});
