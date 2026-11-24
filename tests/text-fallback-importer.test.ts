import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { importTextFallbackFilesSection } from '../src/main/import/pipeline/text-fallback-importer';

const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

describe('generic plain-text fallback importer', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'text-fallback-test-'));
    for (const folder of ['groups', 'events', 'security_and_login_information', 'future_section', 'empty_section', 'oversized_section']) {
      await mkdir(join(root, folder), { recursive: true });
    }
    const accountId = getOrCreateAccount(database, 'Synthetic text account');
    snapshotId = 'text-fallback-snapshot';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at)
      VALUES (?, ?, 'Synthetic text export', 'directory', ?, 'discovered', ?, ?)
    `).run(snapshotId, accountId, root, now, now);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('preserves UTF-8 text, indexes only eligible sections, and marks empty files', async () => {
    const samples = [
      { path: 'groups/readme.txt', section: 'groups', text: '\uFEFFGroup details\r\nSecond line\r\n' },
      { path: 'events/no-data.txt', section: 'events', text: 'No events were included in this export.' },
      { path: 'security_and_login_information/no-data.txt', section: 'security_and_login_information', text: 'Private security export notice.' },
      { path: 'future_section/export.txt', section: 'future_section', text: 'Unreviewed text section.' },
      { path: 'empty_section/empty.txt', section: 'empty_section', text: '   \r\n  ' }
    ];
    const now = new Date().toISOString();
    for (const sample of samples) {
      await writeFile(join(root, sample.path), sample.text, 'utf8');
      database.prepare(`
        INSERT INTO source_files (
          snapshot_id, relative_path, file_name, section_key, detected_format,
          file_size_bytes, status, discovered_at
        ) VALUES (?, ?, ?, ?, 'text', ?, 'discovered', ?)
      `).run(snapshotId, sample.path, sample.path.split('/').pop() ?? sample.path,
        sample.section, Buffer.byteLength(sample.text), now);
    }

    const result = await importTextFallbackFilesSection(database, snapshotId, root);
    expect(result).toEqual({
      filesAttempted: 5,
      recordsImported: 4,
      unsupportedFiles: 0,
      failedFiles: 0
    });

    const records = database.prepare(`
      SELECT section_key AS sectionKey, record_type AS recordType, title, body_text AS body,
        sensitivity, search_enabled AS searchEnabled, payload_json AS payload
      FROM records WHERE snapshot_id = ? ORDER BY section_key
    `).all(snapshotId) as Array<{
      sectionKey: string; recordType: string; title: string; body: string;
      sensitivity: string; searchEnabled: number; payload: string;
    }>;

    expect(records).toHaveLength(4);
    expect(records.find((record) => record.sectionKey === 'groups')).toMatchObject({
      recordType: 'text_item',
      title: 'Group details',
      body: 'Group details\nSecond line',
      sensitivity: 'personal',
      searchEnabled: 1,
      payload: JSON.stringify({ text: 'Group details\r\nSecond line\r\n' })
    });
    expect(records.find((record) => record.sectionKey === 'events'))
      .toMatchObject({ sensitivity: 'personal', searchEnabled: 1 });
    expect(records.find((record) => record.sectionKey === 'security_and_login_information'))
      .toMatchObject({ sensitivity: 'sensitive', searchEnabled: 0 });
    expect(records.find((record) => record.sectionKey === 'future_section'))
      .toMatchObject({ sensitivity: 'sensitive', searchEnabled: 0 });

    const indexed = database.prepare('SELECT COUNT(*) AS count FROM record_search').get() as { count: number };
    expect(indexed.count).toBe(2);

    const statuses = database.prepare(`
      SELECT relative_path AS path, status, parser_key AS parserKey, record_count AS recordCount
      FROM source_files WHERE snapshot_id = ? ORDER BY relative_path
    `).all(snapshotId) as Array<{ path: string; status: string; parserKey: string; recordCount: number }>;
    expect(statuses.find((row) => row.path === 'empty_section/empty.txt'))
      .toMatchObject({ status: 'empty', parserKey: 'text_fallback', recordCount: 0 });
    expect(statuses.filter((row) => row.path !== 'empty_section/empty.txt')
      .every((row) => row.status === 'completed' && row.parserKey === 'text_fallback' && row.recordCount === 1)).toBe(true);
  });

  it('rejects oversized text files safely and leaves them retryable', async () => {
    const path = 'oversized_section/large.txt';
    await writeFile(join(root, path), 'tiny placeholder', 'utf8');
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format,
        file_size_bytes, status, discovered_at
      ) VALUES (?, ?, 'large.txt', 'oversized_section', 'text', ?, 'discovered', ?)
    `).run(snapshotId, path, MAX_TEXT_FILE_BYTES + 1, now);

    const result = await importTextFallbackFilesSection(database, snapshotId, root);
    expect(result.failedFiles).toBe(1);
    expect(database.prepare('SELECT status, safe_error_code AS error FROM source_files WHERE snapshot_id = ? AND relative_path = ?')
      .get(snapshotId, path)).toMatchObject({ status: 'failed', error: 'FILE_TOO_LARGE' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM records WHERE snapshot_id = ?').get(snapshotId))
      .toMatchObject({ count: 0 });
  });

  it('skips completed files on later import attempts', async () => {
    const path = 'groups/notes.txt';
    await writeFile(join(root, path), 'One local note', 'utf8');
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, ?, 'notes.txt', 'groups', 'text', 'discovered', ?)
    `).run(snapshotId, path, now);

    expect((await importTextFallbackFilesSection(database, snapshotId, root)).recordsImported).toBe(1);
    expect(await importTextFallbackFilesSection(database, snapshotId, root)).toEqual({
      filesAttempted: 0, recordsImported: 0, unsupportedFiles: 0, failedFiles: 0
    });
  });
});
