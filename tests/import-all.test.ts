import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { importAllSupportedData, recoverAllInterruptedImports } from '../src/main/import/pipeline/import-all';
import type { ImportProgressEvent } from '../src/shared/archive/inspection';

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
    const progress: ImportProgressEvent[] = [];
    const result = await importAllSupportedData(database, snapshotId, root, (event) => progress.push(event));
    expect(progress.filter((event) => event.phase === 'started').map((event) => event.sectionKey)).toEqual([
      'friends', 'messages', 'posts', 'comments', 'likes_and_reactions'
    ]);
    expect(progress.filter((event) => event.phase === 'progress')).toHaveLength(5);
    expect(progress.filter((event) => event.phase === 'completed').map((event) => event.sectionKey)).toEqual([
      'friends', 'messages', 'posts', 'comments', 'likes_and_reactions'
    ]);
    expect(progress.find((event) => event.sectionKey === 'posts' && event.phase === 'progress')).toMatchObject({
      filesCompleted: 1, filesTotal: 1, recordsImported: 0, unsupportedFiles: 1, failedFiles: 0
    });
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

  it('continues importing if a progress listener throws', async () => {
    await expect(importAllSupportedData(database, snapshotId, root, () => {
      throw new Error('Renderer progress listener is unavailable');
    })).resolves.toMatchObject({
      totals: { filesAttempted: 5, unsupportedFiles: 5, failedFiles: 0 }
    });
  });

  it('recovers interrupted individual imports across all saved backups at startup', () => {
    const accountId = getOrCreateAccount(database, 'Synthetic import-all account');
    const now = new Date().toISOString();
    const interruptedIds = ['interrupted-one', 'interrupted-two', 'interrupted-three'];
    const startingStatuses = ['importing', 'discovered', 'completed'] as const;

    for (const [index, id] of interruptedIds.entries()) {
      database.prepare(`
        INSERT INTO archive_snapshots (
          id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'directory', ?, ?, ?, ?)
      `).run(id, accountId, 'Interrupted backup ' + index, root, startingStatuses[index], now, now);
      const fileId = database.prepare(`
        INSERT INTO source_files (
          snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
        ) VALUES (?, 'posts/your_posts.html', 'your_posts.html', 'posts', 'html', 'processing', ?)
      `).run(id, now).lastInsertRowid;
      database.prepare(`
        INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered)
        VALUES (?, ?, 'import', 'running', ?, 1)
      `).run('run-' + id, id, now);
      expect(fileId).toBeGreaterThan(0);
    }

    expect(recoverAllInterruptedImports(database)).toBe(3);
    for (const id of interruptedIds) {
      const file = database.prepare('SELECT status, safe_error_code FROM source_files WHERE snapshot_id = ?')
        .get(id) as { status: string; safe_error_code: string | null };
      expect(file).toEqual({ status: 'failed', safe_error_code: 'IMPORT_INTERRUPTED' });
      const run = database.prepare('SELECT status FROM import_runs WHERE id = ?').get('run-' + id) as { status: string };
      expect(run.status).toBe('failed');
      const issue = database.prepare(`
        SELECT severity, issue_code, safe_message
        FROM import_issues WHERE import_run_id = ?
      `).get('run-' + id) as { severity: string; issue_code: string; safe_message: string };
      expect(issue).toMatchObject({
        severity: 'error',
        issue_code: 'IMPORT_INTERRUPTED'
      });
      expect(issue.safe_message).toContain('Retry the section');
      expect(issue.safe_message).not.toContain('your_posts.html');
      const snapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?').get(id) as { status: string };
      expect(snapshot.status).toBe('partial');
    }
  });

  it('creates a safe diagnostics record for an orphaned processing file without an import run', () => {
    const accountId = getOrCreateAccount(database, 'Synthetic import-all account');
    const now = new Date().toISOString();
    const orphanSnapshotId = 'orphaned-processing-snapshot';
    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, 'Orphaned import backup', 'directory', ?, 'completed', ?, ?)
    `).run(orphanSnapshotId, accountId, root, now, now);
    database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, 'posts/your_posts.html', 'your_posts.html', 'posts', 'html', 'processing', ?)
    `).run(orphanSnapshotId, now);

    expect(recoverAllInterruptedImports(database)).toBe(1);
    const run = database.prepare(`
      SELECT id, status, files_processed AS filesProcessed, errors_count AS errorsCount
      FROM import_runs WHERE snapshot_id = ?
    `).get(orphanSnapshotId) as { id: string; status: string; filesProcessed: number; errorsCount: number };
    expect(run).toMatchObject({ status: 'failed', filesProcessed: 1, errorsCount: 1 });
    const issue = database.prepare(`
      SELECT severity, issue_code AS issueCode, source_file_id AS sourceFileId
      FROM import_issues WHERE import_run_id = ?
    `).get(run.id) as { severity: string; issueCode: string; sourceFileId: number };
    expect(issue).toMatchObject({ severity: 'error', issueCode: 'IMPORT_INTERRUPTED' });
    expect(issue.sourceFileId).toBeGreaterThan(0);
  });

  it('rolls back startup recovery changes if a diagnostic cannot be recorded', () => {
    const now = new Date().toISOString();
    database.prepare("UPDATE source_files SET status = 'processing' WHERE snapshot_id = ?").run(snapshotId);
    database.prepare(`
      INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered)
      VALUES ('atomic-recovery-run', ?, 'import', 'running', ?, 5)
    `).run(snapshotId, now);
    database.exec(`
      CREATE TRIGGER reject_recovery_diagnostics
      BEFORE INSERT ON import_issues
      BEGIN
        SELECT RAISE(ABORT, 'synthetic diagnostics write failure');
      END;
    `);

    expect(() => recoverAllInterruptedImports(database)).toThrow('synthetic diagnostics write failure');
    const unchangedFiles = database.prepare('SELECT status FROM source_files WHERE snapshot_id = ?')
      .all(snapshotId) as Array<{ status: string }>;
    expect(unchangedFiles.every((file) => file.status === 'processing')).toBe(true);
    const unchangedRun = database.prepare("SELECT status FROM import_runs WHERE id = 'atomic-recovery-run'")
      .get() as { status: string };
    expect(unchangedRun.status).toBe('running');
    const unchangedSnapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?')
      .get(snapshotId) as { status: string };
    expect(unchangedSnapshot.status).toBe('discovered');

    database.exec('DROP TRIGGER reject_recovery_diagnostics');
    expect(recoverAllInterruptedImports(database)).toBe(1);
    const recoveredFiles = database.prepare('SELECT status FROM source_files WHERE snapshot_id = ?')
      .all(snapshotId) as Array<{ status: string }>;
    expect(recoveredFiles.every((file) => file.status === 'failed')).toBe(true);
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
    const interruptedRun = database.prepare("SELECT status, errors_count FROM import_runs WHERE id = 'interrupted-run'")
      .get() as { status: string; errors_count: number };
    expect(interruptedRun).toEqual({ status: 'failed', errors_count: 5 });
    const interruptionIssues = database.prepare("SELECT COUNT(*) AS count FROM import_issues WHERE import_run_id = 'interrupted-run'")
      .get() as { count: number };
    expect(interruptionIssues.count).toBe(5);
    const snapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?')
      .get(snapshotId) as { status: string };
    expect(snapshot.status).toBe('partial');
  });

});
