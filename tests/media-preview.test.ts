import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { getMessageImagePreview } from '../src/main/database/media-preview';

describe('message image previews', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;
  let imageId: number;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'media-preview-test-'));
    await mkdir(join(root, 'messages/inbox/thread-1/photos'), { recursive: true });
    await writeFile(join(root, 'messages/inbox/thread-1/photos/photo.png'), Buffer.from([137, 80, 78, 71]));
    const accountId = getOrCreateAccount(database, 'Synthetic media account');
    snapshotId = 'media-snapshot-test';
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at) VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)`).run(snapshotId, accountId, 'Synthetic export', root, now, now);
    const result = database.prepare(`INSERT INTO media_assets (snapshot_id, relative_path, media_kind, created_at) VALUES (?, ?, 'image', ?)`).run(snapshotId, 'messages/inbox/thread-1/photos/photo.png', now);
    imageId = Number(result.lastInsertRowid);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('returns a local data URL for a verified image asset', async () => {
    await expect(getMessageImagePreview(database, snapshotId, imageId)).resolves.toBe('data:image/png;base64,iVBORw==');
  });
  it('rejects media IDs from another backup', async () => {
    await expect(getMessageImagePreview(database, 'different-snapshot', imageId)).rejects.toThrow('does not belong');
  });
  it('rejects non-image media', async () => {
    database.prepare("UPDATE media_assets SET media_kind = 'video' WHERE id = ?").run(imageId);
    await expect(getMessageImagePreview(database, snapshotId, imageId)).rejects.toThrow('Only image');
  });
  it('rejects unsupported extensions', async () => {
    database.prepare("UPDATE media_assets SET relative_path = 'messages/inbox/thread-1/photos/photo.svg' WHERE id = ?").run(imageId);
    await expect(getMessageImagePreview(database, snapshotId, imageId)).rejects.toThrow('format is not supported');
  });
});
