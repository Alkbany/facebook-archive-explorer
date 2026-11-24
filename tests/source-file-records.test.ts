import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { clearSourceFileRecords } from '../src/main/import/pipeline/source-file-records';

describe('clearSourceFileRecords', () => {
  let database: DatabaseSync;
  let sourceFileId: number;

  beforeEach(() => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    const accountId = getOrCreateAccount(database, 'Source replacement account');
    const now = new Date().toISOString();
    database.prepare(
      "INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at) VALUES ('source-replace-snapshot', ?, 'Synthetic', 'directory', '/synthetic', 'discovered', ?, ?)"
    ).run(accountId, now, now);
    sourceFileId = Number(database.prepare(
      "INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, discovered_at) VALUES ('source-replace-snapshot', 'posts/posts.html', 'posts.html', 'posts', 'html', ?)"
    ).run(now).lastInsertRowid);
  });

  afterEach(() => database.close());

  it('removes obsolete records, FTS rows, and links but preserves media inventory', () => {
    const now = new Date().toISOString();
    const recordId = Number(database.prepare(
      "INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type, title, body_text, normalized_text, sensitivity, search_enabled, payload_json, created_at) VALUES ('source-replace-snapshot', ?, 0, 'posts', 'post', 'Old title', 'ObsoleteNeedle', 'ObsoleteNeedle', 'personal', 1, '{}', ?)"
    ).run(sourceFileId, now).lastInsertRowid);
    const assetId = Number(database.prepare(
      "INSERT INTO media_assets (snapshot_id, relative_path, media_kind, created_at) VALUES ('source-replace-snapshot', 'photos/photo.jpg', 'image', ?)"
    ).run(now).lastInsertRowid);
    database.prepare(
      'INSERT INTO record_media (record_id, media_asset_id, display_order, role) VALUES (?, ?, 0, ?)'
    ).run(recordId, assetId, 'post_attachment');

    expect(clearSourceFileRecords(database, sourceFileId)).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS count FROM records').get()).toMatchObject({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM record_search').get()).toMatchObject({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM record_media').get()).toMatchObject({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM media_assets').get()).toMatchObject({ count: 1 });
  });

  it('rejects invalid source file identifiers', () => {
    expect(() => clearSourceFileRecords(database, 0)).toThrow(RangeError);
    expect(() => clearSourceFileRecords(database, Number.NaN)).toThrow(RangeError);
  });

  it('restores old records and FTS entries when the owning savepoint rolls back', () => {
    const now = new Date().toISOString();
    database.prepare(
      "INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type, title, body_text, normalized_text, sensitivity, search_enabled, payload_json, created_at) VALUES ('source-replace-snapshot', ?, 0, 'posts', 'post', 'Old title', 'RollbackNeedle', 'RollbackNeedle', 'personal', 1, '{}', ?)"
    ).run(sourceFileId, now);
    database.exec('SAVEPOINT test_source_replacement');
    clearSourceFileRecords(database, sourceFileId);
    database.exec('ROLLBACK TO test_source_replacement');
    database.exec('RELEASE test_source_replacement');

    expect(database.prepare('SELECT COUNT(*) AS count FROM records WHERE source_file_id = ?').get(sourceFileId))
      .toMatchObject({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM record_search WHERE record_search MATCH 'rollbackneedle'").get())
      .toMatchObject({ count: 1 });
  });
});
