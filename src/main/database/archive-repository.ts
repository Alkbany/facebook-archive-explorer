import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ArchiveSnapshotSummary,
  DiscoveredArchiveFile
} from '../../shared/archive/inspection';

export interface DiscoverySession {
  accountId: string;
  snapshotId: string;
  importRunId: string;
}

const now = (): string => new Date().toISOString();

export function getOrCreateAccount(database: DatabaseSync, displayName: string): string {
  const normalizedName = displayName.trim().replace(/\s+/gu, ' ');

  if (
    !normalizedName ||
    normalizedName.length > 100 ||
    /[\u0000-\u001F\u007F]/u.test(normalizedName)
  ) {
    throw new Error('Account label must contain 1 to 100 printable characters.');
  }

  const existing = database.prepare(
    'SELECT id FROM accounts WHERE display_name = ? COLLATE NOCASE'
  ).get(normalizedName) as { id: string } | undefined;

  if (existing) return existing.id;

  const accountId = randomUUID();
  const timestamp = now();
  database.prepare(
    'INSERT INTO accounts (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(accountId, normalizedName, timestamp, timestamp);

  return accountId;
}

export function beginDiscoverySession(
  database: DatabaseSync,
  accountId: string,
  archiveName: string,
  sourcePath: string
): DiscoverySession {
  const account = database.prepare(
    'SELECT id FROM accounts WHERE id = ?'
  ).get(accountId) as { id: string } | undefined;

  if (!account) throw new Error('The selected account does not exist.');

  const timestamp = now();
  const snapshotId = randomUUID();
  const importRunId = randomUUID();

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'directory', ?, 'importing', ?, ?)
    `).run(snapshotId, accountId, archiveName, sourcePath, timestamp, timestamp);

    database.prepare(`
      INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at)
      VALUES (?, ?, 'discovery', 'running', ?)
    `).run(importRunId, snapshotId, timestamp);

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return { accountId, snapshotId, importRunId };
}

export function insertDiscoveredFiles(
  database: DatabaseSync,
  snapshotId: string,
  files: readonly DiscoveredArchiveFile[]
): void {
  if (files.length === 0) return;

  const insert = database.prepare(`
    INSERT INTO source_files (
      snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_id, relative_path) DO NOTHING
  `);

  const timestamp = now();
  database.exec('SAVEPOINT source_file_batch');

  try {
    for (const file of files) {
      const status = file.fileName.toLocaleLowerCase() === 'no-data.txt' ? 'empty' : 'discovered';
      insert.run(
        snapshotId,
        file.relativePath,
        file.fileName,
        file.sectionKey,
        file.detectedFormat,
        status,
        timestamp
      );
    }
    database.exec('RELEASE source_file_batch');
  } catch (error) {
    database.exec('ROLLBACK TO source_file_batch');
    database.exec('RELEASE source_file_batch');
    throw error;
  }
}

export function completeDiscoverySession(
  database: DatabaseSync,
  session: DiscoverySession,
  filesDiscovered: number
): void {
  const timestamp = now();
  database.exec('BEGIN IMMEDIATE');

  try {
    database.prepare(`
      UPDATE import_runs
      SET status = 'completed', finished_at = ?, files_discovered = ?
      WHERE id = ? AND status = 'running'
    `).run(timestamp, filesDiscovered, session.importRunId);

    database.prepare(`
      UPDATE archive_snapshots
      SET status = 'discovered', updated_at = ?
      WHERE id = ? AND status = 'importing'
    `).run(timestamp, session.snapshotId);

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function failDiscoverySession(database: DatabaseSync, session: DiscoverySession): void {
  const timestamp = now();
  database.exec('BEGIN IMMEDIATE');

  try {
    database.prepare(`
      UPDATE import_runs
      SET status = 'failed', finished_at = ?, errors_count = errors_count + 1
      WHERE id = ? AND status = 'running'
    `).run(timestamp, session.importRunId);

    database.prepare(`
      UPDATE archive_snapshots
      SET status = 'partial', updated_at = ?
      WHERE id = ? AND status = 'importing'
    `).run(timestamp, session.snapshotId);

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function listArchiveSnapshots(database: DatabaseSync): ArchiveSnapshotSummary[] {
  return database.prepare(`
    SELECT
      snapshots.id AS id,
      accounts.display_name AS accountName,
      snapshots.display_name AS backupName,
      snapshots.status AS status,
      snapshots.created_at AS createdAt,
      COALESCE(SUM(CASE WHEN runs.run_type = 'discovery' THEN runs.files_discovered ELSE 0 END), 0) AS filesDiscovered,
      COALESCE(SUM(CASE WHEN runs.run_type = 'import' THEN runs.records_imported ELSE 0 END), 0) AS recordsImported
    FROM archive_snapshots AS snapshots
    INNER JOIN accounts ON accounts.id = snapshots.account_id
    LEFT JOIN import_runs AS runs
      ON runs.snapshot_id = snapshots.id
    GROUP BY
      snapshots.id,
      accounts.display_name,
      snapshots.display_name,
      snapshots.status,
      snapshots.created_at
    ORDER BY snapshots.created_at DESC
    LIMIT 20
  `).all() as unknown as ArchiveSnapshotSummary[];
}
