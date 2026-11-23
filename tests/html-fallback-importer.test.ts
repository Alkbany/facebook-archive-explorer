import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { importHtmlFallbackFilesSection } from '../src/main/import/pipeline/html-fallback-importer';

describe('generic HTML fallback importer', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'html-fallback-test-'));
    for (const folder of ['groups', 'security_and_login_information', 'future_section', 'posts']) {
      await mkdir(join(root, folder), { recursive: true });
    }
    const accountId = getOrCreateAccount(database, 'Synthetic HTML account');
    snapshotId = 'html-fallback-snapshot';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at)
      VALUES (?, ?, 'Synthetic export', 'directory', ?, 'discovered', ?, ?)
    `).run(snapshotId, accountId, root, now, now);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('imports visible text from unreviewed HTML sections without indexing sensitive content', async () => {
    const samples = [
      {
        path: 'groups/groups.html',
        section: 'groups',
        html: '<html><head><title>Groups</title><script>secret script text</script></head><body><article><h2>Chess Club</h2><p>Weekly chess games</p><time datetime="Raw Facebook date"></time></article><article><h2>Book Club</h2><p>Monthly reading meetings</p></article></body></html>'
      },
      {
        path: 'security_and_login_information/login.html',
        section: 'security_and_login_information',
        html: '<html><body><article><h2>Login history</h2><p>Private session entry</p></article></body></html>'
      },
      {
        path: 'future_section/export.html',
        section: 'future_section',
        html: '<html><body><article><h1>Unknown export</h1><p>Future section text</p></article></body></html>'
      }
    ];
    const now = new Date().toISOString();
    for (const sample of samples) {
      await writeFile(join(root, sample.path), sample.html, 'utf8');
      database.prepare(`
        INSERT INTO source_files (
          snapshot_id, relative_path, file_name, section_key, detected_format,
          file_size_bytes, status, discovered_at
        ) VALUES (?, ?, ?, ?, 'html', ?, 'discovered', ?)
      `).run(snapshotId, sample.path, sample.path.split('/').at(-1), sample.section,
        Buffer.byteLength(sample.html), now);
    }

    const result = await importHtmlFallbackFilesSection(database, snapshotId, root);
    expect(result).toEqual({
      filesAttempted: 3,
      recordsImported: 4,
      unsupportedFiles: 0,
      failedFiles: 0
    });

    const records = database.prepare(`
      SELECT section_key AS sectionKey, record_type AS recordType, title, body_text AS body,
        event_time_raw AS dateRaw, sensitivity, search_enabled AS searchEnabled
      FROM records WHERE snapshot_id = ? ORDER BY section_key, source_record_index
    `).all(snapshotId) as Array<{
      sectionKey: string; recordType: string; title: string; body: string;
      dateRaw: string | null; sensitivity: string; searchEnabled: number;
    }>;

    const groups = records.filter((record) => record.sectionKey === 'groups');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      recordType: 'html_item',
      title: 'Chess Club',
      body: 'Chess Club\nWeekly chess games',
      dateRaw: 'Raw Facebook date',
      sensitivity: 'personal',
      searchEnabled: 1
    });
    expect(groups[0].body).not.toContain('secret script text');

    const sensitive = records.find((record) => record.sectionKey === 'security_and_login_information');
    expect(sensitive).toMatchObject({ sensitivity: 'sensitive', searchEnabled: 0 });
    const unknown = records.find((record) => record.sectionKey === 'future_section');
    expect(unknown).toMatchObject({ sensitivity: 'sensitive', searchEnabled: 0 });

    const statuses = database.prepare(`
      SELECT relative_path AS path, status, parser_key AS parserKey
      FROM source_files WHERE snapshot_id = ? ORDER BY relative_path
    `).all(snapshotId) as Array<{ path: string; status: string; parserKey: string }>;
    expect(statuses.every((row) => row.status === 'completed' && row.parserKey === 'html_fallback')).toBe(true);
  });

  it('does not take over HTML sections with reviewed importers', async () => {
    const path = 'posts/your_posts.html';
    await writeFile(join(root, path), '<html><body><p>Reviewed section</p></body></html>', 'utf8');
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, ?, 'your_posts.html', 'posts', 'html', 'unsupported', ?)
    `).run(snapshotId, path, now);

    const result = await importHtmlFallbackFilesSection(database, snapshotId, root);
    expect(result.filesAttempted).toBe(0);
    expect(database.prepare('SELECT COUNT(*) AS count FROM records WHERE snapshot_id = ?').get(snapshotId))
      .toMatchObject({ count: 0 });
  });
});
