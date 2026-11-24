import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { importCommentsSection } from '../src/main/import/pipeline/comments-importer';
import { listCommentActivities } from '../src/main/database/activity-repository';

describe('Comments import', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'comments-import-test-'));
    await mkdir(join(root, 'comments'), { recursive: true });
    const accountId = getOrCreateAccount(database, 'Synthetic comments account');
    snapshotId = 'comments-snapshot-test';
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at) VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)`)
      .run(snapshotId, accountId, 'Synthetic export', root, now, now);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('imports activity context, group name, body, and raw date into separate fields', async () => {
    const html = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">رد ‏‎Ahmed Alkbany‎‏ على ‏تعليق‏ ‏‎Bssam Emad‎‏.</div>
      <div class="_3-96 _2let"><div><div class="_2pin"><div>
        <div class="_3-95"><span class="_4mp8">مجموعة: </span>pubg mobile - egypt™</div>
        مش فونيكس دا نظام<br>ولا ايموليتور
      </div></div></div></div>
      <div class="_3-94 _2lem"><a href="https://www.facebook.com/dyi/l/?opaque=1">١٩/٠٢/٢٠١٩ ٧:٣٩ ص</a></div>
    </div>`;
    await writeFile(join(root, 'comments', 'comments.html'), html, 'utf8');
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) VALUES (?, ?, ?, 'comments', 'html', 'discovered', ?)`)
      .run(snapshotId, 'comments/comments.html', 'comments.html', now);

    const result = await importCommentsSection(database, snapshotId, root);
    expect(result).toMatchObject({ filesAttempted: 1, recordsImported: 1, unsupportedFiles: 0, failedFiles: 0 });
    const record = database.prepare('SELECT title, body_text, event_time_raw, payload_json FROM records WHERE snapshot_id = ?')
      .get(snapshotId) as { title: string; body_text: string; event_time_raw: string; payload_json: string };
    expect(record).toMatchObject({
      title: 'رد ‏‎Ahmed Alkbany‎‏ على ‏تعليق‏ ‏‎Bssam Emad‎‏.',
      body_text: 'مش فونيكس دا نظام\nولا ايموليتور',
      event_time_raw: '١٩/٠٢/٢٠١٩ ٧:٣٩ ص'
    });
    expect(JSON.parse(record.payload_json)).toMatchObject({ group_raw: 'pubg mobile - egypt™' });
    expect(listCommentActivities(database, snapshotId)).toMatchObject([
      { bodyRaw: 'مش فونيكس دا نظام\nولا ايموليتور', groupRaw: 'pubg mobile - egypt™' }
    ]);
  });

  it('imports the current comments_v2 JSON file into the existing comments activity list', async () => {
    const relativePath = 'your_facebook_activity/comments_and_reactions/comments.json';
    const absolutePath = join(root, relativePath);
    const source = {
      comments_v2: [{
        timestamp: 1540000000,
        title: 'Synthetic account commented on a synthetic post.',
        data: [{ comment: { timestamp: 1540000000, comment: 'Synthetic comment body', author: 'Synthetic account' } }]
      }]
    };
    await mkdir(join(root, 'your_facebook_activity', 'comments_and_reactions'), { recursive: true });
    await writeFile(absolutePath, '\uFEFF' + JSON.stringify(source), 'utf8');
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, ?, 'comments.json', 'comments', 'json', 'discovered', ?)
    `).run(snapshotId, relativePath, now);

    const result = await importCommentsSection(database, snapshotId, root);
    expect(result).toMatchObject({ filesAttempted: 1, recordsImported: 1, unsupportedFiles: 0, failedFiles: 0 });
    expect(listCommentActivities(database, snapshotId)).toMatchObject([{
      activityRaw: 'Synthetic account commented on a synthetic post.',
      bodyRaw: 'Synthetic comment body',
      dateRaw: '1540000000',
      eventTimeUtc: '2018-10-20T01:46:40.000Z'
    }]);
    const normalizedTime = database.prepare(
      'SELECT event_time_utc AS value FROM records WHERE snapshot_id = ?'
    ).get(snapshotId) as { value: string | null };
    expect(normalizedTime.value).toBe('2018-10-20T01:46:40.000Z');
  });

  it('stores a UTC-normalized Arabic comment date only when the export footer supplies its offset', async () => {
    const html = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">Synthetic account commented on a post.</div>
      <div class="_3-96 _2let"><div><div class="_2pin">A synthetic comment body.</div></div></div>
      <div class="_3-94 _2lem">١٩/٠٢/٢٠١٩ ٧:٣٩ ص</div>
    </div><div class="_4t5o">Export created at 10:00 PM UTC+02</div>`;
    await writeFile(join(root, 'comments', 'comments.html'), html, 'utf8');
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) VALUES (?, ?, ?, 'comments', 'html', 'discovered', ?)`)
      .run(snapshotId, 'comments/comments.html', 'comments.html', now);

    await importCommentsSection(database, snapshotId, root);
    const record = database.prepare('SELECT event_time_raw, event_time_utc FROM records WHERE snapshot_id = ?')
      .get(snapshotId) as { event_time_raw: string; event_time_utc: string | null };
    expect(record).toEqual({
      event_time_raw: '١٩/٠٢/٢٠١٩ ٧:٣٩ ص',
      event_time_utc: '2019-02-19T05:39:00.000Z'
    });
  });

  it('marks an unknown comments HTML layout as unsupported', async () => {
    await writeFile(join(root, 'comments', 'unknown.html'), '<html><body>Unknown</body></html>', 'utf8');
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) VALUES (?, ?, ?, 'comments', 'html', 'discovered', ?)`)
      .run(snapshotId, 'comments/unknown.html', 'unknown.html', now);
    const result = await importCommentsSection(database, snapshotId, root);
    expect(result.unsupportedFiles).toBe(1);
  });
});
