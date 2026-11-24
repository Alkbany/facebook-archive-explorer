import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { getPhotoAlbumDetail, listPhotoAlbums } from '../src/main/database/activity-repository';
import { importPhotoAlbumsSection } from '../src/main/import/pipeline/photo-albums-importer';

describe('TNG photo album JSON importer', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

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
    root = await mkdtemp(join(tmpdir(), 'tng-photo-album-import-test-'));
    await mkdir(join(root, 'your_facebook_activity', 'posts', 'album'), { recursive: true });
    await mkdir(join(root, 'your_facebook_activity', 'posts', 'media', 'TenForwardNights'), { recursive: true });

    const accountId = getOrCreateAccount(database, 'Synthetic TNG photo account');
    snapshotId = 'tng-photo-album-snapshot';
    const now = new Date().toISOString();
    database.prepare(
      "INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at) " +
      "VALUES (?, ?, 'Synthetic TNG photo export', 'directory', ?, 'discovered', ?, ?)"
    ).run(snapshotId, accountId, root, now, now);

    const albumPath = 'your_facebook_activity/posts/album/0.json';
    const coverPath = 'your_facebook_activity/posts/media/TenForwardNights/cover.png';
    const secondPhotoPath = 'your_facebook_activity/posts/media/TenForwardNights/second.png';
    const source = {
      name: 'Ten Forward Nights',
      description: 'Off-duty evenings on Deck 10.',
      last_modified_timestamp: 12599096400,
      cover_photo: {
        uri: coverPath,
        creation_timestamp: 12599095800,
        media_metadata: { photo_metadata: { exif_data: [{ upload_ip: '10.0.0.1' }] } }
      },
      photos: [
        {
          uri: coverPath,
          creation_timestamp: 12599095800,
          title: 'Ten Forward Nights',
          media_metadata: { photo_metadata: { exif_data: [{ upload_ip: '10.0.0.1' }] } }
        },
        {
          uri: secondPhotoPath,
          creation_timestamp: 12599095920,
          description: 'Guinan behind the bar.',
          place: { name: 'Ten Forward', address: 'Deck 10' }
        }
      ]
    };
    await writeFile(join(root, albumPath), '\uFEFF' + JSON.stringify(source), 'utf8');
    const albumFileId = Number(database.prepare(
      "INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, file_size_bytes, status, discovered_at) " +
      "VALUES (?, ?, '0.json', 'photos_and_videos', 'json', ?, 'discovered', ?)"
    ).run(snapshotId, albumPath, Buffer.byteLength(JSON.stringify(source), 'utf8') + 3, now).lastInsertRowid);

    await writeFile(join(root, coverPath), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(root, secondPhotoPath), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    for (const [mediaPath, fileName] of [[coverPath, 'cover.png'], [secondPhotoPath, 'second.png']] as const) {
      database.prepare(
        "INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) " +
        "VALUES (?, ?, ?, 'photos_and_videos', 'image', 'discovered', ?)"
      ).run(snapshotId, mediaPath, fileName, now);
    }
    expect(albumFileId).toBeGreaterThan(0);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('imports album metadata and photos into the existing album viewer with local media links', async () => {
    const result = await importPhotoAlbumsSection(database, snapshotId, root);
    expect(result).toEqual({
      filesAttempted: 1,
      recordsImported: 3,
      mediaReferences: 3,
      unsupportedFiles: 0,
      failedFiles: 0
    });

    const albums = listPhotoAlbums(database, snapshotId);
    expect(albums).toHaveLength(1);
    expect(albums[0]).toMatchObject({
      albumTitle: 'Ten Forward Nights',
      photoCount: 2,
      albumPath: 'your_facebook_activity/posts/album/0.json',
      coverPath: 'your_facebook_activity/posts/media/TenForwardNights/cover.png',
      detailStatus: 'completed',
      importedPhotoCount: 2
    });
    expect(albums[0].coverAssetId).toEqual(expect.any(Number));

    const detail = getPhotoAlbumDetail(database, snapshotId, albums[0].id);
    expect(detail).toMatchObject({
      albumTitle: 'Ten Forward Nights',
      albumPath: 'your_facebook_activity/posts/album/0.json',
      detailFileStatus: 'completed',
      photos: [
        {
          imagePath: 'your_facebook_activity/posts/media/TenForwardNights/cover.png',
          captionRaw: null,
          dateRaw: '12599095800'
        },
        {
          imagePath: 'your_facebook_activity/posts/media/TenForwardNights/second.png',
          captionRaw: 'Guinan behind the bar.',
          dateRaw: '12599095920'
        }
      ]
    });
    expect(detail.photos.every((photo) => photo.imageAssetId !== null)).toBe(true);

    const links = database.prepare(
      'SELECT role, COUNT(*) AS count FROM record_media GROUP BY role ORDER BY role'
    ).all() as Array<{ role: string; count: number }>;
    expect(links).toEqual([
      { role: 'album_cover', count: 1 },
      { role: 'album_photo', count: 2 }
    ]);

    const albumSearch = database.prepare(
      "SELECT record_id FROM record_search WHERE record_search MATCH 'tenforward'"
    ).all();
    const captionSearch = database.prepare(
      "SELECT record_id FROM record_search WHERE record_search MATCH 'guinan'"
    ).all();
    const excludedPlace = database.prepare(
      "SELECT record_id FROM record_search WHERE record_search MATCH 'deck'"
    ).all();
    const excludedIp = database.prepare(
      "SELECT record_id FROM record_search WHERE record_search MATCH 'upload_ip'"
    ).all();
    expect(albumSearch.length).toBeGreaterThan(0);
    expect(captionSearch).toHaveLength(1);
    expect(excludedPlace).toHaveLength(0);
    expect(excludedIp).toHaveLength(0);

    const payload = database.prepare(
      "SELECT payload_json AS payload FROM records WHERE snapshot_id = ? AND record_type = 'photo_album'"
    ).get(snapshotId) as { payload: string };
    expect(JSON.parse(payload.payload).original_payload.cover_photo.media_metadata.photo_metadata.exif_data[0].upload_ip)
      .toBe('10.0.0.1');
  });

  it('leaves an unfamiliar TNG album JSON structure eligible for the generic JSON fallback', async () => {
    const albumPath = 'your_facebook_activity/posts/album/unknown.json';
    await writeFile(join(root, albumPath), JSON.stringify({ album_title: 'Unreviewed shape', entries: [] }), 'utf8');
    const now = new Date().toISOString();
    database.prepare(
      "INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) " +
      "VALUES (?, ?, 'unknown.json', 'photos_and_videos', 'json', 'discovered', ?)"
    ).run(snapshotId, albumPath, now);

    const result = await importPhotoAlbumsSection(database, snapshotId, root);
    expect(result).toMatchObject({ filesAttempted: 1, recordsImported: 0, unsupportedFiles: 1, failedFiles: 0 });
    expect(database.prepare(
      "SELECT status, safe_error_code FROM source_files WHERE snapshot_id = ? AND relative_path = ?"
    ).get(snapshotId, albumPath)).toMatchObject({
      status: 'unsupported',
      safe_error_code: 'TNG_ALBUM_STRUCTURE_NOT_RECOGNIZED'
    });
  });
});
