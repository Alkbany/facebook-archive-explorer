import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { indexDiscoveredImageDimensions, indexDiscoveredVideoDurations } from '../src/main/database/media-indexer';

function atom(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + header.length, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function movieHeader(timescale: number, duration: number): Buffer {
  const payload = Buffer.alloc(20);
  payload[0] = 0;
  payload.writeUInt32BE(timescale, 12);
  payload.writeUInt32BE(duration, 16);
  return atom('mvhd', payload);
}

describe('bounded video duration indexing', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'media-indexer-test-'));
    snapshotId = 'video-tail-snapshot';
    const accountId = getOrCreateAccount(database, 'Synthetic video account');
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

  it('advances image metadata batches past unsupported images', async () => {
    const insert = database.prepare(
      "INSERT INTO media_assets (snapshot_id, relative_path, media_kind, created_at) VALUES (?, ?, 'image', ?)"
    );
    const now = new Date().toISOString();
    const directory = join(root, 'photos');
    await mkdir(directory, { recursive: true });

    for (let index = 0; index < 50; index += 1) {
      const name = String(index).padStart(3, '0') + '-unsupported.jpg';
      await writeFile(join(directory, name), Buffer.from('not an image header'));
      insert.run(snapshotId, 'photos/' + name, now);
    }

    const validName = '050-valid.png';
    const pngHeader = Buffer.alloc(24);
    pngHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    pngHeader.writeUInt32BE(640, 16);
    pngHeader.writeUInt32BE(480, 20);
    await writeFile(join(directory, validName), pngHeader);
    insert.run(snapshotId, 'photos/' + validName, now);

    await expect(indexDiscoveredImageDimensions(database, snapshotId, root)).resolves.toBe(0);
    await expect(indexDiscoveredImageDimensions(database, snapshotId, root)).resolves.toBe(1);

    const dimensions = database.prepare(
      'SELECT width, height FROM media_assets WHERE snapshot_id = ? AND relative_path = ?'
    ).get(snapshotId, 'photos/' + validName) as { width: number | null; height: number | null };
    expect(dimensions).toEqual({ width: 640, height: 480 });
  });

  it('finds duration metadata at the end of a non-fast-start MP4 without reading the full file', async () => {
    const relativePath = 'your_facebook_activity/posts/media/your_posts/late-moov.mp4';
    const videoPath = join(root, relativePath);
    await mkdir(join(videoPath, '..'), { recursive: true });

    const ftyp = atom('ftyp', Buffer.from('isom0000'));
    const mediaPayload = Buffer.alloc(2 * 1024 * 1024 + 4096, 0x5a);
    const mdatHeader = Buffer.alloc(8);
    mdatHeader.writeUInt32BE(mediaPayload.length + mdatHeader.length, 0);
    mdatHeader.write('mdat', 4, 4, 'ascii');
    const moov = atom('moov', movieHeader(1000, 98765));
    await writeFile(videoPath, Buffer.concat([ftyp, mdatHeader, mediaPayload, moov]));

    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO media_assets (snapshot_id, relative_path, media_kind, file_size_bytes, created_at)
      VALUES (?, ?, 'video', ?, ?)
    `).run(snapshotId, relativePath, ftyp.length + mdatHeader.length + mediaPayload.length + moov.length, now);

    await expect(indexDiscoveredVideoDurations(database, snapshotId, root)).resolves.toBe(1);
    const row = database.prepare(
      'SELECT duration_ms AS durationMs FROM media_assets WHERE snapshot_id = ? AND relative_path = ?'
    ).get(snapshotId, relativePath) as { durationMs: number | null };
    expect(row.durationMs).toBe(98765);
  });
});
