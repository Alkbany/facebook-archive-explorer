import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { importAllSupportedData } from '../src/main/import/pipeline/import-all';

describe('Import all supported data', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'import-all-test-'));
    const folders = [
      'friends',
      'messages/inbox/thread-1',
      'posts',
      'comments',
      'likes_and_reactions'
    ];
    for (const folder of folders) await mkdir(join(root, folder), { recursive: true });
    const accountId = getOrCreateAccount(database, 'Synthetic import-all account');
    snapshotId = 'import-all-snapshot';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at)
      VALUES (?, ?, 'Synthetic export', 'directory', ?, 'discovered', ?, ?)
    `).run(snapshotId, accountId, root, now, now);

    const files = [
      ['friends/friends.html', 'friends.html', 'friends'],
      ['messages/inbox/thread-1/thread.html', 'thread.html', 'messages'],
      ['posts/your_posts.html', 'your_posts.html', 'posts'],
      ['comments/comments.html', 'comments.html', 'comments'],
      ['likes_and_reactions/likes.html', 'likes.html', 'likes_and_reactions']
    ] as const;
    for (const [path, name, section] of files) {
      await writeFile(join(root, path), '<html><body><p>Unrecognized synthetic structure</p></body></html>', 'utf8');
      database.prepare(`
        INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
        VALUES (?, ?, ?, ?, 'html', 'discovered', ?)
      `).run(snapshotId, path, name, section, now);
    }
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('runs every reviewed importer sequentially and reports unsupported structures', async () => {
    const result = await importAllSupportedData(database, snapshotId, root);
    expect(result.totals).toEqual({
      filesAttempted: 5,
      recordsImported: 0,
      mediaReferences: 0,
      unsupportedFiles: 5,
      failedFiles: 0
    });
    expect(result.sections.friends.filesAttempted).toBe(1);
    expect(result.sections.messages.filesAttempted).toBe(1);
    expect(result.sections.posts.filesAttempted).toBe(1);
    expect(result.sections.comments.filesAttempted).toBe(1);
    expect(result.sections.reactions.filesAttempted).toBe(1);

    const statuses = database.prepare('SELECT status FROM source_files WHERE snapshot_id = ? ORDER BY relative_path')
      .all(snapshotId) as Array<{ status: string }>;
    expect(statuses.every((row) => row.status === 'unsupported')).toBe(true);
    const snapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?')
      .get(snapshotId) as { status: string };
    expect(snapshot.status).toBe('partial');
  });

  it('skips completed files on a second import pass', async () => {
    await importAllSupportedData(database, snapshotId, root);
    database.prepare("UPDATE source_files SET status = 'completed' WHERE snapshot_id = ?").run(snapshotId);
    const result = await importAllSupportedData(database, snapshotId, root);
    expect(result.totals.filesAttempted).toBe(0);
    expect(result.totals.failedFiles).toBe(0);
    const snapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?')
      .get(snapshotId) as { status: string };
    expect(snapshot.status).toBe('completed');
  });
  it('recovers files and runs left in processing state after an interrupted session', async () => {
    const now = new Date().toISOString();
    database.prepare("UPDATE source_files SET status = 'processing' WHERE snapshot_id = ?").run(snapshotId);
    database.prepare(`
      INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered)
      VALUES ('interrupted-run', ?, 'import', 'running', ?, 1)
    `).run(snapshotId, now);

    const result = await importAllSupportedData(database, snapshotId, root);
    expect(result.totals.filesAttempted).toBe(5);
    const recoveredFiles = database.prepare("SELECT status, safe_error_code FROM source_files WHERE snapshot_id = ? ORDER BY relative_path")
      .all(snapshotId) as Array<{ status: string; safe_error_code: string | null }>;
    expect(recoveredFiles.every((file) => file.status === 'unsupported')).toBe(true);
    expect(recoveredFiles.map((file) => file.safe_error_code)).toEqual([
      'COMMENT_CARDS_NOT_FOUND',
      'FRIENDS_CARDS_NOT_FOUND',
      'REACTION_CARDS_NOT_FOUND',
      'MESSAGE_CARDS_NOT_FOUND',
      'POST_CARDS_NOT_FOUND'
    ]);
    const interruptedRun = database.prepare("SELECT status FROM import_runs WHERE id = 'interrupted-run'")
      .get() as { status: string };
    expect(interruptedRun.status).toBe('failed');
    const snapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?')
      .get(snapshotId) as { status: string };
    expect(snapshot.status).toBe('partial');
  });

});
