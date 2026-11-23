import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount, listArchiveSnapshots } from '../src/main/database/archive-repository';
import { indexDiscoveredMediaAssets } from '../src/main/database/media-indexer';
import { listArchiveMediaGallery } from '../src/main/database/messages-repository';
import { searchArchiveRecords } from '../src/main/database/search-repository';
import { compareArchiveSnapshots } from '../src/main/database/comparison-repository';

const migrations = [
  { version: 1, name: 'initial_schema', sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
  { version: 2, name: 'unique_account_display_names', sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
];

describe('archive-wide media, search, and comparison', () => {
  let database: DatabaseSync;
  let accountId: string;
  let baselineId: string;
  let comparedId: string;

  beforeEach(() => {
    database = openAppDatabase(':memory:', migrations);
    accountId = getOrCreateAccount(database, 'Synthetic feature account');
    const now = new Date().toISOString();
    baselineId = 'features-baseline';
    comparedId = 'features-compared';
    for (const [id, name] of [[baselineId, 'Older backup'], [comparedId, 'Newer backup']] as const) {
      database.prepare(`
        INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at)
        VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)
      `).run(id, accountId, name, `/synthetic/${id}`, now, now);
    }
  });

  afterEach(() => database.close());

  function addSource(snapshotId: string, path: string, format: string, section: string): number {
    const now = new Date().toISOString();
    const row = database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, discovered_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(snapshotId, path, path.split('/').pop() ?? path, section, format, now);
    return Number(row.lastInsertRowid);
  }

  function addPost(snapshotId: string, sourceId: number, index: number, title: string, body: string): void {
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, event_time_raw, sensitivity, search_enabled, payload_json, created_at)
      VALUES (?, ?, ?, 'posts', 'post', ?, ?, ?, 'Raw date', 'personal', 1, '{}', ?)
    `).run(snapshotId, sourceId, index, title, body, `${title} ${body}`.toLocaleLowerCase(), now);
  }

  it('indexes all discovered media and keeps local record context when available', () => {
    const html = addSource(baselineId, 'posts/your_posts.html', 'html', 'posts');
    addSource(baselineId, 'photos_and_videos/your_posts/photo.jpg', 'image', 'photos_and_videos');
    addSource(baselineId, 'videos/video.mp4', 'video', 'videos');
    addPost(baselineId, html, 0, 'Synthetic author', 'Gallery context');
    const savedRecord = database.prepare('SELECT id FROM records WHERE snapshot_id = ?').get(baselineId) as { id: number };
    indexDiscoveredMediaAssets(database, baselineId);
    database.prepare(`
      INSERT INTO record_media (record_id, media_asset_id, display_order, role)
      SELECT ?, id, 0, 'post_attachment' FROM media_assets
      WHERE snapshot_id = ? AND relative_path = 'photos_and_videos/your_posts/photo.jpg'
    `).run(savedRecord.id, baselineId);

    const gallery = listArchiveMediaGallery(database, baselineId);
    expect(gallery).toHaveLength(2);
    expect(gallery).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'photos_and_videos/your_posts/photo.jpg', mediaKind: 'image', sectionKey: 'posts', title: 'Synthetic author', body: 'Gallery context' }),
      expect.objectContaining({ relativePath: 'videos/video.mp4', mediaKind: 'video', sectionKey: 'videos', recordId: null })
    ]));
    expect(indexDiscoveredMediaAssets(database, baselineId)).toBe(2);
  });

  it('searches indexed records by text and section while private messages remain excluded', () => {
    const posts = addSource(baselineId, 'posts/your_posts.html', 'html', 'posts');
    const comments = addSource(baselineId, 'comments/comments.html', 'html', 'comments');
    const messages = addSource(baselineId, 'messages/inbox/thread/thread.html', 'html', 'messages');
    addPost(baselineId, posts, 0, 'Sample person', 'Phoenix emulator discussion');
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
        body_text, normalized_text, sensitivity, search_enabled, created_at)
      VALUES (?, ?, 0, 'comments', 'comment_activity', 'Phoenix was discussed', 'phoenix was discussed', 'personal', 1, ?)
    `).run(baselineId, comments, now);
    database.prepare(`
      INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
        body_text, normalized_text, sensitivity, search_enabled, created_at)
      VALUES (?, ?, 0, 'messages', 'message', 'Phoenix private message', 'phoenix private message', 'sensitive', 0, ?)
    `).run(baselineId, messages, now);

    expect(searchArchiveRecords(database, baselineId, 'Phoenix emulator')).toMatchObject([
      { sectionKey: 'posts', body: 'Phoenix emulator discussion' }
    ]);
    expect(searchArchiveRecords(database, baselineId, 'Phoenix', 'comments')).toHaveLength(1);
    expect(searchArchiveRecords(database, baselineId, 'Phoenix', 'messages')).toHaveLength(0);
  });

  it('compares source-card positions and reports added, removed, changed, and unchanged counts', () => {
    const basePath = addSource(baselineId, 'posts/your_posts.html', 'html', 'posts');
    const newPath = addSource(comparedId, 'posts/your_posts.html', 'html', 'posts');
    addPost(baselineId, basePath, 0, 'Same', 'Unchanged body');
    addPost(baselineId, basePath, 1, 'Old title', 'Changed body');
    addPost(baselineId, basePath, 2, 'Removed', 'Removed body');
    addPost(comparedId, newPath, 0, 'Same', 'Unchanged body');
    addPost(comparedId, newPath, 1, 'New title', 'Changed body');
    addPost(comparedId, newPath, 3, 'Added', 'Added body');

    const report = compareArchiveSnapshots(database, baselineId, comparedId);
    expect(report).toMatchObject({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    expect(report.sections).toEqual([{ sectionKey: 'posts', added: 1, removed: 1, changed: 1 }]);
  });

  it('lists every saved backup instead of hiding snapshots beyond the latest twenty', () => {
    const now = new Date().toISOString();
    for (let index = 0; index < 25; index += 1) {
      const id = 'additional-snapshot-' + index;
      database.prepare(`
        INSERT INTO archive_snapshots (
          id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)
      `).run(id, accountId, 'Backup ' + index, '/synthetic/' + id, now, now);
    }

    const backups = listArchiveSnapshots(database);
    expect(backups).toHaveLength(27);
    expect(backups.some((backup) => backup.id === baselineId)).toBe(true);
    expect(backups.some((backup) => backup.id === comparedId)).toBe(true);
    expect(new Set(backups.map((backup) => backup.id)).size).toBe(27);
  });

  it('rejects comparisons between backups from different accounts', () => {
    const otherAccount = getOrCreateAccount(database, 'Different synthetic account');
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at)
      VALUES ('different-account', ?, 'Other', 'directory', '/synthetic/other', 'discovered', ?, ?)
    `).run(otherAccount, now, now);
    expect(() => compareArchiveSnapshots(database, baselineId, 'different-account')).toThrow('same Facebook account');
  });
});
