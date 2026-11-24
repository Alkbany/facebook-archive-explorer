import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { importPostsSection } from '../src/main/import/pipeline/posts-importer';
import { listPostRecords } from '../src/main/database/activity-repository';

describe('Posts import', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'posts-import-test-'));
    await mkdir(join(root, 'posts'), { recursive: true });
    await mkdir(join(root, 'photos_and_videos', 'your_posts'), { recursive: true });
    const accountId = getOrCreateAccount(database, 'Synthetic posts account');
    snapshotId = 'posts-snapshot-test';
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at) VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)`)
      .run(snapshotId, accountId, 'Synthetic export', root, now, now);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('imports post text and local media references without copying media bytes', async () => {
    const html = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">تم النشر بواسطة Ahmed في MagicalGhast.</div>
      <div class="_3-96 _2let"><div><div class="_2pin">
        <div>نص منشور تجريبي</div>
        <a href="photos_and_videos/your_posts/photo.jpg"><img src="photos_and_videos/your_posts/photo.jpg"></a>
      </div></div></div>
      <div class="_3-94 _2lem"><a href="https://www.facebook.com/dyi/l/?opaque=1">Raw date</a></div>
    </div>`;
    await writeFile(join(root, 'posts', 'your_posts.html'), html, 'utf8');
    await writeFile(join(root, 'photos_and_videos', 'your_posts', 'photo.jpg'), 'synthetic image bytes', 'utf8');
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) VALUES (?, ?, ?, 'posts', 'html', 'discovered', ?)`)
      .run(snapshotId, 'posts/your_posts.html', 'your_posts.html', now);
    database.prepare(`INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) VALUES (?, ?, ?, 'photos_and_videos', 'image', 'discovered', ?)`)
      .run(snapshotId, 'photos_and_videos/your_posts/photo.jpg', 'photo.jpg', now);

    const result = await importPostsSection(database, snapshotId, root);
    expect(result).toMatchObject({ filesAttempted: 1, recordsImported: 1, mediaReferences: 1, unsupportedFiles: 0, failedFiles: 0 });
    const record = database.prepare('SELECT title, body_text, event_time_raw FROM records WHERE snapshot_id = ?')
      .get(snapshotId) as { title: string; body_text: string; event_time_raw: string };
    expect(record).toMatchObject({ title: 'تم النشر بواسطة Ahmed في MagicalGhast.', body_text: 'نص منشور تجريبي', event_time_raw: 'Raw date' });
    const media = database.prepare('SELECT relative_path, media_kind, source_file_id FROM media_assets WHERE snapshot_id = ?')
      .get(snapshotId) as { relative_path: string; media_kind: string; source_file_id: number };
    const binarySource = database.prepare('SELECT id FROM source_files WHERE snapshot_id = ? AND relative_path = ?')
      .get(snapshotId, 'photos_and_videos/your_posts/photo.jpg') as { id: number };
    expect(media).toMatchObject({
      relative_path: 'photos_and_videos/your_posts/photo.jpg',
      media_kind: 'image',
      source_file_id: binarySource.id
    });
    expect(listPostRecords(database, snapshotId)).toMatchObject([{ bodyRaw: 'نص منشور تجريبي', mediaCount: 1 }]);
  });


  it('replaces obsolete records on retry and keeps the last good records when a retry fails', async () => {
    const firstCard = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">Synthetic First Post</div>
      <div class="_3-96 _2let"><div><div class="_2pin"><div>FirstPostNeedle</div></div></div></div>
      <div class="_3-94 _2lem"><a>Raw first date</a></div>
    </div>`;
    const secondCard = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">Synthetic Second Post</div>
      <div class="_3-96 _2let"><div><div class="_2pin"><div>SecondPostNeedle</div></div></div></div>
      <div class="_3-94 _2lem"><a>Raw second date</a></div>
    </div>`;
    const filePath = join(root, 'posts', 'your_posts.html');
    await writeFile(filePath, firstCard + secondCard, 'utf8');
    const now = new Date().toISOString();
    const fileId = Number(database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, 'posts/your_posts.html', 'your_posts.html', 'posts', 'html', 'discovered', ?)
    `).run(snapshotId, now).lastInsertRowid);

    const firstImport = await importPostsSection(database, snapshotId, root);
    expect(firstImport.recordsImported).toBe(2);
    expect(database.prepare('SELECT COUNT(*) AS count FROM records WHERE source_file_id = ?').get(fileId))
      .toMatchObject({ count: 2 });

    await writeFile(filePath, firstCard, 'utf8');
    database.prepare("UPDATE source_files SET status = 'failed' WHERE id = ?").run(fileId);
    const retry = await importPostsSection(database, snapshotId, root);
    expect(retry).toMatchObject({ filesAttempted: 1, recordsImported: 1, failedFiles: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM records WHERE source_file_id = ?').get(fileId))
      .toMatchObject({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM record_search WHERE record_search MATCH 'secondpostneedle'").get())
      .toMatchObject({ count: 0 });

    await rm(filePath, { force: true });
    database.prepare("UPDATE source_files SET status = 'failed' WHERE id = ?").run(fileId);
    const failedRetry = await importPostsSection(database, snapshotId, root);
    expect(failedRetry.failedFiles).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS count FROM records WHERE source_file_id = ?').get(fileId))
      .toMatchObject({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM record_search WHERE record_search MATCH 'firstpostneedle'").get())
      .toMatchObject({ count: 1 });
  });


  it('promotes a completed HTML fallback record when the reviewed Posts parser recognizes it', async () => {
    const html = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">Synthetic reviewed post</div>
      <div class="_3-96 _2let"><div><div class="_2pin"><div>PromotedPostNeedle</div></div></div></div>
      <div class="_3-94 _2lem"><a>Raw promotion date</a></div>
    </div>`;
    const filePath = join(root, 'posts', 'your_posts.html');
    await writeFile(filePath, html, 'utf8');
    const now = new Date().toISOString();
    const fileId = Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, parser_key, discovered_at
      ) VALUES (?, 'posts/your_posts.html', 'your_posts.html', 'posts', 'html', 'completed', 'html_fallback', ?)
    `).run(snapshotId, now).lastInsertRowid);
    database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, 0, 'posts', 'html_item', 'Old fallback title', 'OldFallbackNeedle', 'OldFallbackNeedle', 'personal', 1, '{}', ?)
    `).run(snapshotId, fileId, now);

    const result = await importPostsSection(database, snapshotId, root);
    expect(result).toMatchObject({ filesAttempted: 1, recordsImported: 1, failedFiles: 0 });
    expect(database.prepare('SELECT record_type AS recordType, body_text AS body FROM records WHERE source_file_id = ?')
      .get(fileId)).toEqual({ recordType: 'post', body: 'PromotedPostNeedle' });
    expect(database.prepare('SELECT status, parser_key AS parserKey FROM source_files WHERE id = ?')
      .get(fileId)).toEqual({ status: 'completed', parserKey: 'posts_reviewed' });
    expect(database.prepare("SELECT COUNT(*) AS count FROM record_search WHERE record_search MATCH 'oldfallbackneedle'")
      .get()).toMatchObject({ count: 0 });
  });


  it('stores a UTC-normalized Arabic post date only when the export footer supplies its offset', async () => {
    const html = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">Synthetic reviewed post</div>
      <div class="_3-96 _2let"><div><div class="_2pin"><div>TimezonePostNeedle</div></div></div></div>
      <div class="_3-94 _2lem">٢٥/٠٧/٢٠١٧ ٨:٣٨ م</div>
    </div><div class="_4t5o">Export created at 10:00 PM UTC+02</div>`;
    await writeFile(join(root, 'posts', 'your_posts.html'), html, 'utf8');
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) VALUES (?, ?, ?, 'posts', 'html', 'discovered', ?)`)
      .run(snapshotId, 'posts/your_posts.html', 'your_posts.html', now);

    await importPostsSection(database, snapshotId, root);
    const record = database.prepare('SELECT event_time_raw, event_time_utc FROM records WHERE snapshot_id = ?')
      .get(snapshotId) as { event_time_raw: string; event_time_utc: string | null };
    expect(record).toEqual({
      event_time_raw: '٢٥/٠٧/٢٠١٧ ٨:٣٨ م',
      event_time_utc: '2017-07-25T18:38:00.000Z'
    });
  });

  it('marks an unknown posts HTML layout as unsupported', async () => {
    await writeFile(join(root, 'posts', 'unknown.html'), '<html><body>Unknown</body></html>', 'utf8');
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) VALUES (?, ?, ?, 'posts', 'html', 'discovered', ?)`)
      .run(snapshotId, 'posts/unknown.html', 'unknown.html', now);
    const result = await importPostsSection(database, snapshotId, root);
    expect(result.unsupportedFiles).toBe(1);
  });
});
