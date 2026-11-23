import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { listPhotoAlbums } from '../src/main/database/activity-repository';
import { importPhotoAlbumsSection } from '../src/main/import/pipeline/photo-albums-importer';

describe('Photos & Videos album index import', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'photo-albums-import-test-'));
    await mkdir(join(root, 'photos_and_videos', 'album'), { recursive: true });
    await mkdir(join(root, 'photos_and_videos', 'sample_album'), { recursive: true });
    const accountId = getOrCreateAccount(database, 'Synthetic photo albums account');
    snapshotId = 'photo-albums-snapshot';
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

  it('imports album summaries and links verified local cover images without copying bytes', async () => {
    const html = `<html><head><title>Your Photos</title></head><body>
      <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
        <div class="_3-96 _2pio _2lek _2lel">‏‎Instagram Photos‎‏ - ‏٣‏ صور</div>
        <div class="_3-96 _2let"><a href="photos_and_videos/album/0.html"><img src="photos_and_videos/sample_album/cover.jpg"></a></div>
        <div class="_3-94 _2lem">١٣/٠٢/٢٠١٨ ١١:٥٥ ص</div>
      </div>
      <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
        <div class="_3-96 _2pio _2lek _2lel">صور الغلاف - ١٣ صورة</div>
        <div class="_3-96 _2let"><a href="photos_and_videos/album/1.html"><img src="photos_and_videos/sample_album/cover-2.jpg"></a></div>
        <div class="_3-94 _2lem">Raw date</div>
      </div>
    </body></html>`;
    await writeFile(join(root, 'photos_and_videos', 'your_photos.html'), html, 'utf8');
    await writeFile(join(root, 'photos_and_videos', 'sample_album', 'cover.jpg'), 'synthetic image', 'utf8');
    await writeFile(join(root, 'photos_and_videos', 'sample_album', 'cover-2.jpg'), 'synthetic image two', 'utf8');
    await writeFile(join(root, 'photos_and_videos', 'album', '0.html'), '<html>album detail not parsed yet</html>', 'utf8');

    const now = new Date().toISOString();
    const indexId = database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, 'photos_and_videos/your_photos.html', 'your_photos.html', 'photos_and_videos', 'html', 'discovered', ?)
    `).run(snapshotId, now).lastInsertRowid;
    const coverId = database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, 'photos_and_videos/sample_album/cover.jpg', 'cover.jpg', 'photos_and_videos', 'image', 'discovered', ?)
    `).run(snapshotId, now).lastInsertRowid;
    database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, 'photos_and_videos/sample_album/cover-2.jpg', 'cover-2.jpg', 'photos_and_videos', 'image', 'discovered', ?)
    `).run(snapshotId, now);
    const detailId = database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, 'photos_and_videos/album/0.html', '0.html', 'photos_and_videos', 'html', 'discovered', ?)
    `).run(snapshotId, now).lastInsertRowid;

    const result = await importPhotoAlbumsSection(database, snapshotId, root);

    expect(result).toMatchObject({
      filesAttempted: 1, recordsImported: 2, mediaReferences: 2,
      unsupportedFiles: 0, failedFiles: 0
    });
    expect(listPhotoAlbums(database, snapshotId)).toMatchObject([
      { albumTitle: 'Instagram Photos', photoCount: 3, albumPath: 'photos_and_videos/album/0.html', coverPath: 'photos_and_videos/sample_album/cover.jpg', coverAssetId: expect.any(Number) },
      { albumTitle: 'صور الغلاف', photoCount: 13, albumPath: 'photos_and_videos/album/1.html', coverPath: 'photos_and_videos/sample_album/cover-2.jpg', coverAssetId: expect.any(Number) }
    ]);
    const linked = database.prepare('SELECT COUNT(*) AS count FROM record_media').get() as { count: number };
    expect(linked.count).toBe(2);
    const indexStatus = database.prepare('SELECT status, record_count FROM source_files WHERE id = ?').get(Number(indexId)) as { status: string; record_count: number };
    const detailStatus = database.prepare('SELECT status FROM source_files WHERE id = ?').get(Number(detailId)) as { status: string };
    expect(indexStatus).toEqual({ status: 'completed', record_count: 2 });
    expect(detailStatus.status).toBe('discovered');
    expect(database.prepare('SELECT id FROM media_assets WHERE snapshot_id = ?').all(snapshotId)).toHaveLength(2);
    expect(coverId).toBeGreaterThan(0);
  });

  it('marks an unrecognized root HTML page unsupported without consuming nested album files', async () => {
    await writeFile(join(root, 'photos_and_videos', 'unknown.html'), '<html><body>Unknown</body></html>', 'utf8');
    const now = new Date().toISOString();
    const rootFile = database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, 'photos_and_videos/unknown.html', 'unknown.html', 'photos_and_videos', 'html', 'discovered', ?)
    `).run(snapshotId, now).lastInsertRowid;
    const nestedFile = database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, 'photos_and_videos/album/0.html', '0.html', 'photos_and_videos', 'html', 'discovered', ?)
    `).run(snapshotId, now).lastInsertRowid;

    const result = await importPhotoAlbumsSection(database, snapshotId, root);

    expect(result).toMatchObject({ filesAttempted: 1, recordsImported: 0, unsupportedFiles: 1, failedFiles: 0 });
    expect((database.prepare('SELECT status FROM source_files WHERE id = ?').get(Number(rootFile)) as { status: string }).status).toBe('unsupported');
    expect((database.prepare('SELECT status FROM source_files WHERE id = ?').get(Number(nestedFile)) as { status: string }).status).toBe('discovered');
  });
});
