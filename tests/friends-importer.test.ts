import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { importFriendsSection, importFriendsSourceFile } from '../src/main/import/pipeline/friends-importer';

describe('Friends file import', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;
  let sourceFileId: number;

  beforeEach(async () => {
    const migrations = [
      {
        version: 1,
        name: 'initial_schema',
        sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8')
      },
      {
        version: 2,
        name: 'unique_account_display_names',
        sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8')
      }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'friends-import-test-'));
    await mkdir(join(root, 'friends'), { recursive: true });

    const accountId = getOrCreateAccount(database, 'Synthetic account');
    snapshotId = 'friends-snapshot-test';
    const timestamp = new Date().toISOString();

    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)
    `).run(snapshotId, accountId, 'Synthetic export', root, timestamp, timestamp);

    const result = database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, ?, ?, 'friends', 'html', 'discovered', ?)
    `).run(snapshotId, 'friends/friends.html', 'friends.html', timestamp);

    sourceFileId = Number(result.lastInsertRowid);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('imports friend name and raw date, but keeps contact info out of FTS5', async () => {
    const html = `<!doctype html><html><body>
      <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
        <div class="_3-96 _2pio _2lek _2lel">Synthetic Friend Needle</div>
        <div class="_3-94 _2lem">Raw exported date</div>
        <div class="_3-96 _2let">PrivateContactNeedle@example.invalid</div>
      </div>
    </body></html>`;
    const filePath = join(root, 'friends', 'friends.html');
    await writeFile(filePath, html, 'utf8');

    const result = await importFriendsSourceFile(database, snapshotId, sourceFileId, root);

    expect(result.recordsImported).toBe(1);
    expect(result.fileStatus).toBe('completed');

    const record = database.prepare(`
      SELECT title, event_time_raw, payload_json, search_enabled
      FROM records
      WHERE source_file_id = ?
    `).get(sourceFileId) as {
      title: string;
      event_time_raw: string;
      payload_json: string;
      search_enabled: number;
    };

    expect(record.title).toBe('Synthetic Friend Needle');
    expect(record.event_time_raw).toBe('Raw exported date');
    expect(record.search_enabled).toBe(1);
    expect(record.payload_json).toContain('PrivateContactNeedle@example.invalid');

    const indexedName = database.prepare(
      "SELECT record_id FROM record_search WHERE record_search MATCH 'needle'"
    ).all();
    const indexedContact = database.prepare(
      "SELECT record_id FROM record_search WHERE record_search MATCH 'privatecontactneedle'"
    ).all();

    expect(indexedName).toHaveLength(1);
    expect(indexedContact).toHaveLength(0);
    await expect(readFile(filePath, 'utf8')).resolves.toBe(html);
  });

  it('imports only the five registered Friends export filenames', async () => {
    const friendsHtml = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">Synthetic First Person</div>
      <div class="_3-94 _2lem">Raw date one</div>
    </div>`;
    const sentHtml = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">Synthetic Second Person</div>
      <div class="_3-94 _2lem">Raw date two</div>
    </div>`;

    await writeFile(join(root, 'friends', 'friends.html'), friendsHtml, 'utf8');
    await writeFile(join(root, 'friends', 'sent_friend_requests.html'), sentHtml, 'utf8');
    await writeFile(join(root, 'friends', 'unrecognized.html'), friendsHtml, 'utf8');

    const timestamp = new Date().toISOString();
    const sentFileId = Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, ?, ?, 'friends', 'html', 'discovered', ?)
    `).run(
      snapshotId,
      'friends/sent_friend_requests.html',
      'sent_friend_requests.html',
      timestamp
    ).lastInsertRowid);
    const unknownFileId = Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, ?, ?, 'friends', 'html', 'discovered', ?)
    `).run(
      snapshotId,
      'friends/unrecognized.html',
      'unrecognized.html',
      timestamp
    ).lastInsertRowid);

    const result = await importFriendsSection(database, snapshotId, root);

    expect(result).toEqual({
      filesAttempted: 2,
      recordsImported: 2,
      unsupportedFiles: 0,
      failedFiles: 0
    });

    const unknownFile = database.prepare(
      'SELECT status FROM source_files WHERE id = ?'
    ).get(unknownFileId) as { status: string };
    const importedCount = database.prepare(
      'SELECT COUNT(*) AS count FROM records WHERE snapshot_id = ?'
    ).get(snapshotId) as { count: number };

    expect(unknownFile.status).toBe('discovered');
    expect(importedCount.count).toBe(2);
    expect(sentFileId).toBeGreaterThan(0);
  });

  it('marks an unrecognized Friends page as unsupported rather than importing zero records silently', async () => {
    await writeFile(
      join(root, 'friends', 'friends.html'),
      '<html><body><p>Unexpected export structure</p></body></html>',
      'utf8'
    );

    const result = await importFriendsSourceFile(database, snapshotId, sourceFileId, root);
    const source = database.prepare(
      'SELECT status, safe_error_code FROM source_files WHERE id = ?'
    ).get(sourceFileId) as { status: string; safe_error_code: string };

    expect(result.fileStatus).toBe('unsupported');
    expect(result.recordsImported).toBe(0);
    expect(source).toEqual({
      status: 'unsupported',
      safe_error_code: 'FRIENDS_CARDS_NOT_FOUND'
    });
  });
});
