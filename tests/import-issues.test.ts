import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { listImportIssues } from '../src/main/database/import-issues-repository';

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

describe('snapshot import diagnostics', () => {
  let database: DatabaseSync;
  let firstSnapshotId: string;

  beforeEach(() => {
    database = openAppDatabase(':memory:', migrations);
    const accountId = getOrCreateAccount(database, 'Diagnostics test account');
    const now = '2026-11-23T12:00:00.000Z';
    for (const snapshotId of ['diagnostics-first', 'diagnostics-second']) {
      database.prepare(`
        INSERT INTO archive_snapshots (
          id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'directory', '/synthetic/archive', 'discovered', ?, ?)
      `).run(snapshotId, accountId, snapshotId, now, now);
    }
    firstSnapshotId = 'diagnostics-first';

    const fileId = database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, discovered_at
      ) VALUES (?, 'posts/your_posts.html', 'your_posts.html', 'posts', 'html', ?)
    `).run(firstSnapshotId, now).lastInsertRowid;

    for (const [id, status, startedAt] of [
      ['diagnostic-run-1', 'completed', now],
      ['diagnostic-run-2', 'completed', '2026-11-23T12:01:00.000Z']
    ] as const) {
      database.prepare(`
        INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at)
        VALUES (?, ?, 'import', ?, ?)
      `).run(id, firstSnapshotId, status, startedAt);
    }

    database.prepare(`
      INSERT INTO import_issues (
        import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at
      ) VALUES
        ('diagnostic-run-1', ?, 'warning', 'POST_CARD_PARTIAL', 'A post card was missing optional metadata.', '{"sourceCardIndex":4}', '2026-11-23T12:00:10.000Z'),
        ('diagnostic-run-1', ?, 'error', 'POST_FILE_UNREADABLE', 'The source file could not be safely read.', '{}', '2026-11-23T12:00:20.000Z'),
        ('diagnostic-run-2', ?, 'info', 'IMPORT_RETRIED', 'A previously failed file was retried.', '{"sourceCardIndex":9}', '2026-11-23T12:01:10.000Z')
    `).run(fileId, fileId, fileId);
  });

  afterEach(() => {
    database.close();
  });

  it('returns a snapshot-scoped summary with severity counts and newest-first results', () => {
    const report = listImportIssues(database, firstSnapshotId);
    expect(report.total).toBe(3);
    expect(report.hasMore).toBe(false);
    expect(report.counts).toEqual({ info: 1, warning: 1, error: 1 });
    expect(report.items.map((issue) => issue.issueCode)).toEqual([
      'IMPORT_RETRIED',
      'POST_FILE_UNREADABLE',
      'POST_CARD_PARTIAL'
    ]);
    expect(report.items[0]).toMatchObject({
      severity: 'info',
      sourceFileName: 'your_posts.html',
      sourcePath: 'posts/your_posts.html',
      sourceCardIndex: 9
    });
  });

  it('limits the returned diagnostics while retaining the total count', () => {
    const report = listImportIssues(database, firstSnapshotId, 1);
    expect(report.items).toHaveLength(1);
    expect(report.total).toBe(3);
    expect(report.hasMore).toBe(true);
  });

  it('does not mix diagnostics from another saved backup', () => {
    const report = listImportIssues(database, 'diagnostics-second');
    expect(report).toEqual({
      items: [],
      total: 0,
      hasMore: false,
      counts: { info: 0, warning: 0, error: 0 }
    });
  });
});
