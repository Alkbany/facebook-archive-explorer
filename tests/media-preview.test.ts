import { mkdtemp, mkdir, readFile, rm, writeFile, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { getMessageMediaPreview } from '../src/main/database/media-preview';

describe('message media previews', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;
  let imageId: number;
  let videoId: number;
  let audioId: number;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'media-preview-test-'));
    await mkdir(join(root, 'messages/inbox/thread-1/photos'), { recursive: true });
    await writeFile(join(root, 'messages/inbox/thread-1/photos/photo.png'), Buffer.from([137, 80, 78, 71]));
    await writeFile(join(root, 'messages/inbox/thread-1/photos/clip.mp4'), Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]));
    await writeFile(join(root, 'messages/inbox/thread-1/photos/voice.mp3'), Buffer.from([73, 68, 51, 4]));
    const accountId = getOrCreateAccount(database, 'Synthetic media account');
    snapshotId = 'media-snapshot-test';
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at) VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)`).run(snapshotId, accountId, 'Synthetic export', root, now, now);
    const insert = database.prepare('INSERT INTO media_assets (snapshot_id, relative_path, media_kind, created_at) VALUES (?, ?, ?, ?)');
    imageId = Number(insert.run(snapshotId, 'messages/inbox/thread-1/photos/photo.png', 'image', now).lastInsertRowid);
    videoId = Number(insert.run(snapshotId, 'messages/inbox/thread-1/photos/clip.mp4', 'video', now).lastInsertRowid);
    audioId = Number(insert.run(snapshotId, 'messages/inbox/thread-1/photos/voice.mp3', 'audio', now).lastInsertRowid);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('returns a local data URL for a verified image asset', async () => {
    await expect(getMessageMediaPreview(database, snapshotId, imageId)).resolves.toBe('data:image/png;base64,iVBORw==');
  });
  it('returns local data URLs for supported video and audio assets', async () => {
    await expect(getMessageMediaPreview(database, snapshotId, videoId)).resolves.toMatch(/^data:video\/mp4;base64,/u);
    await expect(getMessageMediaPreview(database, snapshotId, audioId)).resolves.toMatch(/^data:audio\/mpeg;base64,/u);
  });
  it('rejects media IDs from another backup', async () => {
    await expect(getMessageMediaPreview(database, 'different-snapshot', imageId)).rejects.toThrow('does not belong');
  });
  it('rejects unsupported extensions', async () => {
    database.prepare("UPDATE media_assets SET relative_path = 'messages/inbox/thread-1/photos/photo.svg' WHERE id = ?").run(imageId);
    await expect(getMessageMediaPreview(database, snapshotId, imageId)).rejects.toThrow('not supported');
  });
  it('rejects a media type and extension mismatch', async () => {
    database.prepare("UPDATE media_assets SET relative_path = 'messages/inbox/thread-1/photos/mismatch.mp4' WHERE id = ?").run(imageId);
    await expect(getMessageMediaPreview(database, snapshotId, imageId)).rejects.toThrow('extension does not match');
  });
  it('rejects media files above the bounded preview size', async () => {
    const largePath = join(root, 'messages/inbox/thread-1/photos/large.mp4');
    await writeFile(largePath, Buffer.alloc(1));
    await truncate(largePath, 24 * 1024 * 1024 + 1);
    const now = new Date().toISOString();
    const id = Number(database.prepare("INSERT INTO media_assets (snapshot_id, relative_path, media_kind, created_at) VALUES (?, ?, 'video', ?)").run(snapshotId, 'messages/inbox/thread-1/photos/large.mp4', now).lastInsertRowid);
    await expect(getMessageMediaPreview(database, snapshotId, id)).rejects.toThrow('FILE_TOO_LARGE');
  });
});
