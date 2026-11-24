import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { listArchiveMediaGallery } from '../src/main/database/messages-repository';

describe('paged archive media gallery', () => {
  let database: DatabaseSync;
  let snapshotId: string;
  let sourceFileId: number;

  beforeEach(async () => {
    const migrationNames = [
      '001_initial_schema.sql',
      '002_account_names.sql',
      '003_backfill_verified_event_times.sql',
      '004_backfill_fallback_parser_keys.sql',
      '005_media_metadata_scan_state.sql'
    ];
    const migrations = await Promise.all(migrationNames.map(async (fileName, index) => ({
      version: index + 1,
      name: fileName.replace(/^\\d+_/u, '').replace(/\\.sql$/u, ''),
      sql: await readFile(join(process.cwd(), 'src/main/database/migrations', fileName), 'utf8')
    })));
    database = openAppDatabase(':memory:', migrations);
    const accountId = getOrCreateAccount(database, 'Media gallery test account');
    snapshotId = 'media-gallery-snapshot';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at)
      VALUES (?, ?, 'Synthetic export', 'directory', '/tmp/media-gallery', 'discovered', ?, ?)
    `).run(snapshotId, accountId, now, now);
    sourceFileId = Number(database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, discovered_at)
      VALUES (?, 'messages/inbox/thread/messages.json', 'messages.json', 'messages', 'json', ?)
    `).run(snapshotId, now).lastInsertRowid);

    const insertAsset = database.prepare(`
      INSERT INTO media_assets (snapshot_id, source_file_id, relative_path, media_kind, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (let index = 0; index < 75; index += 1) {
      insertAsset.run(snapshotId, null, `photos/image-${String(index).padStart(3, '0')}.jpg`, 'image', now);
    }
    for (let index = 0; index < 30; index += 1) {
      insertAsset.run(snapshotId, null, `videos/clip-${String(index).padStart(3, '0')}.mp4`, 'video', now);
    }
    for (let index = 0; index < 3; index += 1) {
      insertAsset.run(snapshotId, null, `audio/voice-${index}.mp3`, 'audio', now);
    }
    for (let index = 0; index < 2; index += 1) {
      insertAsset.run(snapshotId, null, `stickers/sticker-${index}.webp`, 'sticker', now);
    }

    const assetId = Number(database.prepare(
      "SELECT id FROM media_assets WHERE snapshot_id = ? AND relative_path = 'photos/image-000.jpg'"
    ).get(snapshotId)?.id);
    const insertRecord = database.prepare(`
      INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type, title, sensitivity, search_enabled, payload_json, created_at)
      VALUES (?, ?, ?, 'messages', 'message', ?, 'sensitive', 0, '{}', ?)
    `);
    const firstRecord = Number(insertRecord.run(snapshotId, sourceFileId, 0, 'First message context', now).lastInsertRowid);
    const secondRecord = Number(insertRecord.run(snapshotId, sourceFileId, 1, 'Second message context', now).lastInsertRowid);
    database.prepare("INSERT INTO record_media (record_id, media_asset_id, display_order, role) VALUES (?, ?, 0, 'photo')")
      .run(firstRecord, assetId);
    database.prepare("INSERT INTO record_media (record_id, media_asset_id, display_order, role) VALUES (?, ?, 1, 'photo')")
      .run(secondRecord, assetId);
  });

  afterEach(() => database.close());

  it('returns distinct files in stable pages and reports the full total', () => {
    const firstPage = listArchiveMediaGallery(database, snapshotId, 'all', 1);
    const secondPage = listArchiveMediaGallery(database, snapshotId, 'all', 2);

    expect(firstPage).toMatchObject({ page: 1, pageSize: 100, total: 110 });
    expect(secondPage).toMatchObject({ page: 2, pageSize: 100, total: 110 });
    expect(firstPage.items).toHaveLength(100);
    expect(secondPage.items).toHaveLength(10);
    const allIds = [...firstPage.items, ...secondPage.items].map((item) => item.id);
    expect(new Set(allIds).size).toBe(110);
  });

  it('filters by media kind before pagination', () => {
    const images = listArchiveMediaGallery(database, snapshotId, 'image', 2, '', 50);
    const videos = listArchiveMediaGallery(database, snapshotId, 'video', 1);
    const audio = listArchiveMediaGallery(database, snapshotId, 'audio', 1);

    expect(images).toMatchObject({ page: 2, pageSize: 50, total: 75 });
    expect(images.items).toHaveLength(25);
    expect(images.items.every((item) => item.mediaKind === 'image')).toBe(true);
    expect(videos).toMatchObject({ page: 1, total: 30 });
    expect(videos.items.every((item) => item.mediaKind === 'video')).toBe(true);
    expect(audio).toMatchObject({ page: 1, total: 3 });
    expect(audio.items.every((item) => item.mediaKind === 'audio')).toBe(true);
  });

  it('searches file names and paths literally before paginating', () => {
    const firstImagePage = listArchiveMediaGallery(database, snapshotId, 'image', 1, 'IMAGE-0');
    const secondImagePage = listArchiveMediaGallery(database, snapshotId, 'image', 2, 'IMAGE-0', 50);
    const exactVideo = listArchiveMediaGallery(database, snapshotId, 'video', 1, 'clip-007');
    const wildcardText = listArchiveMediaGallery(database, snapshotId, 'video', 1, '%');

    expect(firstImagePage).toMatchObject({ page: 1, pageSize: 100, total: 75 });
    expect(secondImagePage).toMatchObject({ page: 2, pageSize: 50, total: 75 });
    expect(secondImagePage.items).toHaveLength(25);
    expect(firstImagePage.items.every((item) => item.relativePath.includes('image-0'))).toBe(true);
    expect(exactVideo).toMatchObject({ total: 1, items: [expect.objectContaining({ relativePath: 'videos/clip-007.mp4' })] });
    expect(wildcardText).toMatchObject({ total: 0, items: [] });
  });

  it('trims and bounds long gallery search terms', () => {
    const padded = listArchiveMediaGallery(database, snapshotId, 'image', 1, '  image-004.jpg  ');
    const tooLong = listArchiveMediaGallery(database, snapshotId, 'image', 1, 'x'.repeat(500));

    expect(padded).toMatchObject({ total: 1, items: [expect.objectContaining({ relativePath: 'photos/image-004.jpg' })] });
    expect(tooLong).toMatchObject({ total: 0, items: [] });
  });

  it('shows one stable context record when an asset is linked more than once', () => {
    const page = listArchiveMediaGallery(database, snapshotId, 'image', 1);
    const linked = page.items.find((item) => item.relativePath === 'photos/image-000.jpg');
    expect(linked?.recordId).not.toBeNull();
    expect(linked?.title).toBe('First message context');
    expect(page.items.filter((item) => item.relativePath === 'photos/image-000.jpg')).toHaveLength(1);
  });

  it('clamps pages beyond the final result page and returns an empty page for no matches', () => {
    const beyondEnd = listArchiveMediaGallery(database, snapshotId, 'video', 999);
    const noMatches = listArchiveMediaGallery(database, 'missing-snapshot', 'all', 1);
    expect(beyondEnd).toMatchObject({ page: 1, total: 30 });
    expect(beyondEnd.items).toHaveLength(30);
    expect(noMatches).toMatchObject({ page: 1, total: 0, items: [] });
  });
});
