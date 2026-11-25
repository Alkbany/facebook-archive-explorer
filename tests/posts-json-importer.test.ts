import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { listPostRecords } from '../src/main/database/activity-repository';
import { importPostsSection } from '../src/main/import/pipeline/posts-importer';

describe('TNG Posts JSON importer', () => {
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
    root = await mkdtemp(join(tmpdir(), 'posts-json-import-test-'));
    await mkdir(join(root, 'your_facebook_activity/posts/media/your_posts'), { recursive: true });

    const accountId = getOrCreateAccount(database, 'Synthetic TNG Posts account');
    snapshotId = 'posts-json-snapshot';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, 'Synthetic TNG export', 'directory', ?, 'discovered', ?, ?)
    `).run(snapshotId, accountId, root, now, now);

    const postPath = 'your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json';
    const source = [{
      timestamp: 1540000000,
      attachments: [
        { data: [{ media: {
          uri: 'your_facebook_activity/posts/media/your_posts/200000000000003.png',
          description: 'The bridge at dawn.',
          media_metadata: { photo_metadata: { exif_data: [{ upload_ip: '10.0.0.1' }] } }
        } }] },
        { data: [{ place: { name: 'Ten Forward', address: 'Deck 10' } }] }
      ],
      data: [{ post: 'Two views of the bridge before alpha shift.' }],
      title: 'Jean-Luc Picard added 1 new photo.'
    }];
    await writeFile(join(root, postPath), '\uFEFF' + JSON.stringify(source), 'utf8');

    database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, ?, ?, 'posts', 'json', 'discovered', ?)
    `).run(snapshotId, postPath, postPath.split('/').pop() ?? postPath, now);

    const mediaPath = 'your_facebook_activity/posts/media/your_posts/200000000000003.png';
    await writeFile(join(root, mediaPath), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, ?, ?, 'photos_and_videos', 'image', 'discovered', ?)
    `).run(snapshotId, mediaPath, '200000000000003.png', now);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('imports the post activity and links only the discovered local image', async () => {
    const result = await importPostsSection(database, snapshotId, root);
    expect(result).toEqual({
      filesAttempted: 1,
      recordsImported: 1,
      mediaReferences: 1,
      unsupportedFiles: 0,
      failedFiles: 0
    });

    const postsPage = listPostRecords(database, snapshotId);
    expect(postsPage).toMatchObject({ page: 1, pageSize: 100, total: 1 });
    expect(postsPage.items).toHaveLength(1);
    expect(postsPage.items[0]).toMatchObject({
      activityRaw: 'Jean-Luc Picard added 1 new photo.',
      bodyRaw: 'Two views of the bridge before alpha shift.\nThe bridge at dawn.',
      dateRaw: '1540000000',
      eventTimeUtc: '2018-10-20T01:46:40.000Z',
      mediaCount: 1
    });

    const linkedMedia = database.prepare(`
      SELECT assets.relative_path AS relativePath, assets.media_kind AS mediaKind
      FROM record_media AS links
      INNER JOIN media_assets AS assets ON assets.id = links.media_asset_id
    `).all() as Array<{ relativePath: string; mediaKind: string }>;
    expect(linkedMedia).toEqual([{
      relativePath: 'your_facebook_activity/posts/media/your_posts/200000000000003.png',
      mediaKind: 'image'
    }]);

    const record = database.prepare(
      'SELECT body_text AS body, event_time_utc AS eventTimeUtc FROM records WHERE snapshot_id = ? AND section_key = ?'
    ).get(snapshotId, 'posts') as { body: string; eventTimeUtc: string | null };
    expect(record.eventTimeUtc).toBe('2018-10-20T01:46:40.000Z');
    expect(record.body).not.toContain('Deck 10');
    expect(record.body).not.toContain('10.0.0.1');
    const indexedPlace = database.prepare(
      "SELECT record_id FROM record_search WHERE record_search MATCH 'deck'"
    ).all();
    const indexedIp = database.prepare(
      "SELECT record_id FROM record_search WHERE record_search MATCH 'upload_ip'"
    ).all();
    expect(indexedPlace).toHaveLength(0);
    expect(indexedIp).toHaveLength(0);
  });


  it('promotes a completed generic JSON fallback file to the reviewed Posts parser', async () => {
    const sourceFile = database.prepare(
      "SELECT id, relative_path FROM source_files WHERE snapshot_id = ? AND section_key = 'posts'"
    ).get(snapshotId) as { id: number; relative_path: string };
    const now = new Date().toISOString();
    database.prepare(
      "UPDATE source_files SET status = 'completed', parser_key = 'json_fallback' WHERE id = ?"
    ).run(sourceFile.id);
    database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, 0, 'posts', 'json_item', 'Fallback JSON title', 'Fallback JSON body', 'Fallback JSON body', 'personal', 1, '{}', ?)
    `).run(snapshotId, sourceFile.id, now);

    const result = await importPostsSection(database, snapshotId, root);
    expect(result).toMatchObject({ filesAttempted: 1, recordsImported: 1, failedFiles: 0 });
    const postsPage = listPostRecords(database, snapshotId);
    expect(postsPage.total).toBe(1);
    expect(postsPage.items).toHaveLength(1);
    expect(postsPage.items[0]).toMatchObject({
      activityRaw: 'Jean-Luc Picard added 1 new photo.'
    });
    expect(postsPage.items[0].bodyRaw).toContain('The bridge at dawn.');
    expect(database.prepare('SELECT status, parser_key AS parserKey FROM source_files WHERE id = ?')
      .get(sourceFile.id)).toEqual({ status: 'completed', parserKey: 'posts_reviewed' });
    expect(database.prepare("SELECT COUNT(*) AS count FROM record_search WHERE record_search MATCH 'fallbackjsonbody'")
      .get()).toMatchObject({ count: 0 });
  });


  it('marks an unfamiliar JSON layout unsupported so the generic JSON fallback can preserve it', async () => {
    const sourceFile = database.prepare(
      "SELECT id, relative_path FROM source_files WHERE snapshot_id = ? AND section_key = 'posts'"
    ).get(snapshotId) as { id: number; relative_path: string };
    await writeFile(join(root, sourceFile.relative_path), JSON.stringify({ unknown_posts: [{ message: 'Unknown schema' }] }), 'utf8');

    const result = await importPostsSection(database, snapshotId, root);
    expect(result).toMatchObject({ filesAttempted: 1, recordsImported: 0, unsupportedFiles: 1, failedFiles: 0 });
    expect(database.prepare('SELECT status FROM source_files WHERE id = ?').get(sourceFile.id))
      .toMatchObject({ status: 'unsupported' });
  });
});
