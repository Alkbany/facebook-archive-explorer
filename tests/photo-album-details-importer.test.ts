import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { getPhotoAlbumDetail, listPhotoAlbums } from '../src/main/database/activity-repository';
import { importPhotoAlbumDetailsSection } from '../src/main/import/pipeline/photo-album-details-importer';

describe('Photos & Videos album detail import', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;
  let albumRecordId: number;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'photo-album-details-test-'));
    await mkdir(join(root, 'photos_and_videos', 'album'), { recursive: true });
    await mkdir(join(root, 'photos_and_videos', 'InstagramPhotos_token'), { recursive: true });
    const accountId = getOrCreateAccount(database, 'Synthetic photo details account');
    snapshotId = 'photo-album-details-snapshot';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at)
      VALUES (?, ?, 'Synthetic export', 'directory', ?, 'discovered', ?, ?)
    `).run(snapshotId, accountId, root, now, now);

    const indexFileId = database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, 'photos_and_videos/your_photos.html', 'your_photos.html', 'photos_and_videos', 'html', 'completed', ?)
    `).run(snapshotId, now).lastInsertRowid;
    albumRecordId = Number(database.prepare(`
      INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, event_time_raw, sensitivity, search_enabled, payload_json, created_at)
      VALUES (?, ?, 0, 'photos_and_videos', 'photo_album', 'Instagram Photos', '3 photos',
        'instagram photos 3 photos', '١٣/٠٢/٢٠١٨ ١١:٥٥ ص', 'personal', 1, ?, ?)
    `).run(
      snapshotId,
      Number(indexFileId),
      JSON.stringify({ album_path: 'photos_and_videos/album/0.html', photo_count: 3, cover_path: null }),
      now
    ).lastInsertRowid);

    database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, 'photos_and_videos/album/0.html', '0.html', 'photos_and_videos', 'html', 'discovered', ?)
    `).run(snapshotId, now);
    database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, 'photos_and_videos/InstagramPhotos_token/photo-1.jpg', 'photo-1.jpg', 'photos_and_videos', 'image', 'discovered', ?)
    `).run(snapshotId, now);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('imports photo cards, captions, original dates, comments, and links local image assets', async () => {
    const imagePath = 'photos_and_videos/InstagramPhotos_token/photo-1.jpg';
    const html = `<html><head><base href="../../" /><title>Instagram Photos</title></head><body>
      <div class="_3b0d">Instagram Photos</div>
      <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
        <div class="_3-96 _2let">
          <a href="${imagePath}"><img src="${imagePath}" /></a>
          <div class="_3-95">😍😍</div>
          <div class="pas _3-94 uiBoxGray noborder"><div><div><span class="_3-8_ _2oao">Saleh Elshrif</span>احلا خوات في الكون</div><div class="_67gx">‏٠١‏/٠٢‏/٢٠١٨ ١٠:٤٨ م‏</div></div></div>
          <div class="pas _3-94 uiBoxGray noborder"><div><div><span class="_3-8_ _2oao">Ahmed Alkbany</span>😍😍</div><div class="_67gx">‏٠٢‏/٠٢‏/٢٠١٨ ٣:٤٩ م‏</div></div></div>
        </div>
        <div class="_3-94 _2lem">‏٠١‏/٠٢‏/٢٠١٨ ٩:٢٥ م‏</div>
      </div>
    </body></html>`;
    await writeFile(join(root, 'photos_and_videos', 'album', '0.html'), html, 'utf8');
    await writeFile(join(root, ...imagePath.split('/')), 'synthetic photo bytes', 'utf8');

    const result = await importPhotoAlbumDetailsSection(database, snapshotId, root);

    expect(result).toMatchObject({
      filesAttempted: 1, recordsImported: 1, mediaReferences: 1,
      unsupportedFiles: 0, failedFiles: 0
    });
    const albumDetails = getPhotoAlbumDetail(database, snapshotId, albumRecordId);
    expect(albumDetails).toMatchObject({
      albumTitle: 'Instagram Photos',
      albumPath: 'photos_and_videos/album/0.html',
      detailFileStatus: 'completed',
      photos: [{
        imageAssetId: expect.any(Number),
        imagePath,
        originalPath: imagePath,
        captionRaw: '😍😍',
        dateRaw: '‏٠١‏/٠٢‏/٢٠١٨ ٩:٢٥ م‏',
        comments: [
          { authorRaw: 'Saleh Elshrif', bodyRaw: 'احلا خوات في الكون', dateRaw: '‏٠١‏/٠٢‏/٢٠١٨ ١٠:٤٨ م‏' },
          { authorRaw: 'Ahmed Alkbany', bodyRaw: '😍😍', dateRaw: '‏٠٢‏/٠٢‏/٢٠١٨ ٣:٤٩ م‏' }
        ]
      }]
    });
    expect(listPhotoAlbums(database, snapshotId)[0]).toMatchObject({
      detailStatus: 'completed',
      importedPhotoCount: 1
    });
  });

  it('keeps a photo record and reports a warning if its local image file is missing', async () => {
    const missingPath = 'photos_and_videos/InstagramPhotos_token/missing.jpg';
    const html = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2let"><a href="${missingPath}"><img src="${missingPath}"></a>
      <div class="_3-95">Caption retained</div></div><div class="_3-94 _2lem">Raw date</div>
    </div>`;
    await writeFile(join(root, 'photos_and_videos', 'album', '0.html'), html, 'utf8');

    const result = await importPhotoAlbumDetailsSection(database, snapshotId, root);

    expect(result).toMatchObject({ recordsImported: 1, mediaReferences: 0, unsupportedFiles: 0, failedFiles: 0 });
    const albumDetails = getPhotoAlbumDetail(database, snapshotId, albumRecordId);
    expect(albumDetails.photos[0]).toMatchObject({ imagePath: missingPath, imageAssetId: null, captionRaw: 'Caption retained' });
    const issue = database.prepare("SELECT issue_code FROM import_issues ORDER BY id DESC LIMIT 1").get() as { issue_code: string };
    expect(issue.issue_code).toBe('PHOTO_FILE_NOT_IN_ARCHIVE');
  });

  it('does not import unrelated album detail HTML that has no index entry', async () => {
    database.prepare('UPDATE records SET payload_json = ? WHERE id = ?')
      .run(JSON.stringify({ album_path: 'photos_and_videos/album/98.html', photo_count: 3 }), albumRecordId);
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, 'photos_and_videos/album/99.html', '99.html', 'photos_and_videos', 'html', 'discovered', ?)
    `).run(snapshotId, now);
    const result = await importPhotoAlbumDetailsSection(database, snapshotId, root);
    expect(result).toEqual({
      filesAttempted: 0, recordsImported: 0, mediaReferences: 0, unsupportedFiles: 0, failedFiles: 0
    });
    const detail = getPhotoAlbumDetail(database, snapshotId, albumRecordId);
    expect(detail.detailFileStatus).toBe('not_found');
    expect(detail.photos).toEqual([]);
  });
});
