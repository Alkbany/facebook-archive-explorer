import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { getImportCoverage } from '../src/main/database/import-coverage-repository';

const migrations = [
  {
    version: 1,
    name: 'initial_schema',
    sql: readFileSync(resolve(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8')
  },
  {
    version: 2,
    name: 'unique_account_display_names',
    sql: readFileSync(resolve(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8')
  }
] as const;

describe('archive import coverage', () => {
  let database: DatabaseSync;
  const snapshotId = 'coverage-snapshot';

  beforeEach(() => {
    database = openAppDatabase(':memory:', migrations);
    const accountId = getOrCreateAccount(database, 'Coverage test account');
    const now = new Date().toISOString();
    for (const id of [snapshotId, 'other-snapshot']) {
      database.prepare(`
        INSERT INTO archive_snapshots (
          id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'directory', '/synthetic/archive', 'discovered', ?, ?)
      `).run(id, accountId, id, now, now);
    }

    const insertFile = database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const files = [
      ['friends/friends.html', 'friends.html', 'friends', 'html', 'completed'],
      ['posts/your_posts.json', 'your_posts.json', 'posts', 'json', 'discovered'],
      ['photos_and_videos/photo.jpg', 'photo.jpg', 'photos_and_videos', 'image', 'discovered'],
      ['comments/comments.html', 'comments.html', 'comments', 'html', 'unsupported'],
      ['comments/other.html', 'other.html', 'comments', 'html', 'failed'],
      ['location/no-data.txt', 'no-data.txt', 'location', 'text', 'empty'],
      ['messages/voice.mp4', 'voice.mp4', 'messages', 'video', 'discovered'],
      ['marketplace/extra.bin', 'extra.bin', 'marketplace', 'other', 'skipped']
    ] as const;
    for (const [path, name, section, format, status] of files) {
      insertFile.run(snapshotId, path, name, section, format, status, now);
    }
    insertFile.run('other-snapshot', 'posts/other.html', 'other.html', 'posts', 'html', 'discovered', now);
  });

  afterEach(() => {
    database.close();
  });

  it('separates media inventory from content import states', () => {
    const report = getImportCoverage(database, snapshotId);
    expect(report.totals).toEqual({
      totalFiles: 8,
      contentFiles: 6,
      mediaFiles: 2,
      completedFiles: 1,
      unsupportedFiles: 1,
      failedFiles: 1,
      unprocessedFiles: 1,
      emptyFiles: 1,
      skippedFiles: 1
    });
    expect(report.sections.find((section) => section.sectionKey === 'comments')).toMatchObject({
      totalFiles: 2,
      htmlFiles: 2,
      completedFiles: 0,
      unsupportedFiles: 1,
      failedFiles: 1
    });
    expect(report.sections.find((section) => section.sectionKey === 'photos_and_videos')).toMatchObject({
      mediaFiles: 1,
      unprocessedFiles: 0
    });
  });

  it('reports cross-snapshot links, stale counts, invalid metadata, and interrupted work', () => {
    const now = new Date().toISOString();
    const friendsFile = database.prepare(
      "SELECT id FROM source_files WHERE snapshot_id = ? AND section_key = 'friends'"
    ).get(snapshotId) as { id: number };
    const otherFile = database.prepare(
      "SELECT id FROM source_files WHERE snapshot_id = ?"
    ).get('other-snapshot') as { id: number };
    database.prepare('UPDATE source_files SET record_count = 2 WHERE id = ?').run(friendsFile.id);
    const pendingFile = database.prepare("SELECT id FROM source_files WHERE snapshot_id = ? AND section_key = 'posts'").get(snapshotId) as { id: number };
    database.prepare("UPDATE source_files SET status = 'processing' WHERE id = ?").run(pendingFile.id);
    database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        body_text, sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, 0, 'posts', 'post', 'synthetic cross-snapshot record', 'personal', 0, '{}', ?)
    `).run(snapshotId, otherFile.id, now);

    database.prepare(`
      INSERT INTO media_assets (snapshot_id, source_file_id, relative_path, media_kind, width, height, created_at)
      VALUES (?, ?, 'synthetic/cross-snapshot.jpg', 'image', 10, 10, ?)
    `).run(snapshotId, otherFile.id, now);
    database.prepare(`
      INSERT INTO media_assets (snapshot_id, relative_path, media_kind, width, height, created_at)
      VALUES (?, 'synthetic/unlinked-invalid.png', 'image', 0, 12, ?)
    `).run(snapshotId, now);
    database.prepare(`
      INSERT INTO media_assets (snapshot_id, source_file_id, relative_path, media_kind, created_at)
      VALUES ('other-snapshot', ?, 'synthetic/other.jpg', 'image', ?)
    `).run(otherFile.id, now);

    const currentRecord = database.prepare(
      'SELECT id FROM records WHERE snapshot_id = ? ORDER BY id DESC LIMIT 1'
    ).get(snapshotId) as { id: number };
    const otherAsset = database.prepare(
      "SELECT id FROM media_assets WHERE snapshot_id = 'other-snapshot'"
    ).get() as { id: number };
    database.prepare(
      'INSERT INTO record_media (record_id, media_asset_id, display_order) VALUES (?, ?, 0)'
    ).run(currentRecord.id, otherAsset.id);
    database.prepare(`
      INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at)
      VALUES ('running-integrity-run', ?, 'import', 'running', ?)
    `).run(snapshotId, now);

    expect(getImportCoverage(database, snapshotId).integrity).toEqual({
      sourceRecordCountMismatches: 1,
      recordsFromAnotherSnapshot: 1,
      mediaAssetsWithoutSourceFile: 1,
      mediaAssetsFromAnotherSnapshot: 1,
      mediaLinksAcrossSnapshots: 1,
      invalidMediaMetadata: 1,
      runningImportRuns: 1,
      processingSourceFiles: 1
    });
  });

  it('keeps coverage isolated to the selected saved backup', () => {
    const report = getImportCoverage(database, 'other-snapshot');
    expect(report.totals).toMatchObject({
      totalFiles: 1,
      contentFiles: 1,
      mediaFiles: 0,
      unprocessedFiles: 1
    });
    expect(report.sections).toHaveLength(1);
    expect(report.sections[0].sectionKey).toBe('posts');
  });

  it('returns an empty report for a snapshot with no discovered files', () => {
    const report = getImportCoverage(database, 'snapshot-with-no-files');
    expect(report.totals).toEqual({
      totalFiles: 0,
      contentFiles: 0,
      mediaFiles: 0,
      completedFiles: 0,
      unsupportedFiles: 0,
      failedFiles: 0,
      unprocessedFiles: 0,
      emptyFiles: 0,
      skippedFiles: 0
    });
    expect(report.sections).toEqual([]);
  });
});
