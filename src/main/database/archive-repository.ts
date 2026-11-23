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
  sourcePath: string,
  sourceKind: 'directory' | 'zip' = 'directory'
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
      ) VALUES (?, ?, ?, ?, ?, 'importing', ?, ?)
    `).run(snapshotId, accountId, archiveName, sourceKind, sourcePath, timestamp, timestamp);

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
      snapshot_id, relative_path, file_name, section_key, detected_format,
      file_size_bytes, status, discovered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
        file.fileSizeBytes ?? null,
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

export interface ArchiveSnapshotOpenDetails {
  id: string;
  accountId: string;
  accountName: string;
  backupName: string;
  sourcePath: string;
  sourceKind: 'directory' | 'zip';
  createdAt: string;
  totalFiles: number;
  filesByFormat: { html: number; json: number; media: number; other: number };
  sectionFileCounts: Record<string, number>;
  noDataSections: string[];
}

export function getArchiveSnapshotOpenDetails(database: DatabaseSync, snapshotId: string): ArchiveSnapshotOpenDetails | null {
  const snapshot = database.prepare(`
    SELECT snapshots.id AS id, snapshots.account_id AS accountId,
      accounts.display_name AS accountName, snapshots.display_name AS backupName,
      snapshots.source_path AS sourcePath, snapshots.source_kind AS sourceKind,
      snapshots.created_at AS createdAt
    FROM archive_snapshots AS snapshots
    INNER JOIN accounts ON accounts.id = snapshots.account_id
    WHERE snapshots.id = ?
  `).get(snapshotId) as Omit<ArchiveSnapshotOpenDetails, 'totalFiles' | 'filesByFormat' | 'sectionFileCounts' | 'noDataSections'> | undefined;
  if (!snapshot) return null;

  const filesByFormat = { html: 0, json: 0, media: 0, other: 0 };
  const formats = database.prepare(`
    SELECT detected_format AS format, COUNT(*) AS count
    FROM source_files WHERE snapshot_id = ? GROUP BY detected_format
  `).all(snapshotId) as Array<{ format: string; count: number }>;
  for (const row of formats) {
    if (row.format === 'html') filesByFormat.html += row.count;
    else if (row.format === 'json') filesByFormat.json += row.count;
    else if (['image', 'video', 'audio'].includes(row.format)) filesByFormat.media += row.count;
    else filesByFormat.other += row.count;
  }

  const sectionRows = database.prepare(`
    SELECT section_key AS sectionKey, COUNT(*) AS count
    FROM source_files WHERE snapshot_id = ? GROUP BY section_key ORDER BY section_key
  `).all(snapshotId) as Array<{ sectionKey: string; count: number }>;
  const emptyRows = database.prepare(`
    SELECT DISTINCT section_key AS sectionKey FROM source_files
    WHERE snapshot_id = ? AND status = 'empty' ORDER BY section_key
  `).all(snapshotId) as Array<{ sectionKey: string }>;

  return {
    ...snapshot,
    totalFiles: Object.values(filesByFormat).reduce((total, count) => total + count, 0),
    filesByFormat,
    sectionFileCounts: Object.fromEntries(sectionRows.map((row) => [row.sectionKey, row.count])),
    noDataSections: emptyRows.map((row) => row.sectionKey)
  };
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
  `).all() as unknown as ArchiveSnapshotSummary[];
}
