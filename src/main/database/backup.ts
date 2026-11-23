import { backup, DatabaseSync } from 'node:sqlite';
import { existsSync, renameSync } from 'node:fs';
import { lstat, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const REQUIRED_TABLES = [
  'schema_migrations',
  'accounts',
  'archive_snapshots',
  'source_files',
  'import_runs',
  'records',
  'record_search',
  'media_assets',
  'record_media',
  'import_issues'
] as const;

export interface DatabaseBackupValidation {
  schemaVersion: number;
  accounts: number;
  snapshots: number;
  records: number;
  sizeBytes: number;
}

export interface DatabaseBackupExportResult {
  pagesCopied: number;
  sizeBytes: number;
  fileName: string;
}

/** Ensures SQLite database files are app backups rather than arbitrary SQLite files. */
export async function validateDatabaseBackup(
  filePath: string,
  supportedSchemaVersion: number
): Promise<DatabaseBackupValidation> {
  const fileStats = await lstat(filePath).catch(() => null);
  if (!fileStats?.isFile() || fileStats.isSymbolicLink() || fileStats.size < 1) {
    throw new Error('The selected file is not a regular, non-empty database file.');
  }

  const candidate = new DatabaseSync(filePath, { readOnly: true });
  try {
    const integrityRows = candidate.prepare('PRAGMA integrity_check').all() as Array<Record<string, string>>;
    if (integrityRows.length !== 1 || Object.values(integrityRows[0] ?? {})[0] !== 'ok') {
      throw new Error('The selected database failed its SQLite integrity check.');
    }

    const foreignKeyIssues = candidate.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyIssues.length > 0) {
      throw new Error('The selected database contains broken relationships.');
    }

    const tables = new Set(
      (candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
        .map((row) => row.name)
    );
    const missingTables = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missingTables.length > 0) {
      throw new Error('The selected file is not a recognized archive database.');
    }

    const migration = candidate.prepare(
      'SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations'
    ).get() as { version: number };
    if (migration.version < 1 || migration.version > supportedSchemaVersion) {
      throw new Error('The selected database version is not supported by this application.');
    }

    const counts = candidate.prepare(
      'SELECT (SELECT COUNT(*) FROM accounts) AS accounts, ' +
      '(SELECT COUNT(*) FROM archive_snapshots) AS snapshots, ' +
      '(SELECT COUNT(*) FROM records) AS records'
    ).get() as { accounts: number; snapshots: number; records: number };

    return {
      schemaVersion: migration.version,
      accounts: counts.accounts,
      snapshots: counts.snapshots,
      records: counts.records,
      sizeBytes: fileStats.size
    };
  } finally {
    candidate.close();
  }
}

async function replaceFileWithRollback(sourcePath: string, destinationPath: string): Promise<void> {
  const previousPath = destinationPath + '.' + randomUUID() + '.previous';
  let previousMoved = false;
  try {
    try {
      await rename(destinationPath, previousPath);
      previousMoved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    await rename(sourcePath, destinationPath);
    if (previousMoved) await rm(previousPath, { force: true });
  } catch (error) {
    if (previousMoved && !existsSync(destinationPath)) {
      await rename(previousPath, destinationPath).catch(() => undefined);
    }
    throw error;
  }
}

/** Creates a consistent SQLite backup, including committed WAL data, without copying live DB sidecars. */
export async function exportDatabaseBackup(
  database: DatabaseSync,
  outputPath: string,
  supportedSchemaVersion: number
): Promise<DatabaseBackupExportResult> {
  const sourcePath = database.location();
  if (!sourcePath) throw new Error('The active database has no file location and cannot be exported.');
  if (resolve(sourcePath).toLocaleLowerCase() === resolve(outputPath).toLocaleLowerCase()) {
    throw new Error('Choose a different destination from the active application database.');
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = resolve(dirname(outputPath), '.' + basename(outputPath) + '.' + randomUUID() + '.tmp');
  try {
    const pagesCopied = await backup(database, temporaryPath, { rate: 128 });
    await validateDatabaseBackup(temporaryPath, supportedSchemaVersion);
    await replaceFileWithRollback(temporaryPath, outputPath);
    const outputStats = await stat(outputPath);
    return { pagesCopied, sizeBytes: outputStats.size, fileName: basename(outputPath) };
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function removeDatabaseSidecars(databasePath: string): Promise<void> {
  await Promise.all([
    rm(databasePath + '-wal', { force: true }),
    rm(databasePath + '-shm', { force: true }),
    rm(databasePath + '-journal', { force: true })
  ]);
}

/**
 * Restores into the app database path. The previous live database is first
 * copied to a validated recovery file. The process must restart after success.
 */
export async function restoreDatabaseBackup(
  database: DatabaseSync,
  sourcePath: string,
  databasePath: string,
  supportedSchemaVersion: number
): Promise<string> {
  const livePath = resolve(databasePath);
  const selectedPath = resolve(sourcePath);
  if (livePath.toLocaleLowerCase() === selectedPath.toLocaleLowerCase()) {
    throw new Error('The active application database cannot be restored over itself.');
  }
  if (!database.isOpen) throw new Error('The application database is not open.');
  if (database.isTransaction) throw new Error('A database operation is active. Finish it before restoring a backup.');
  const activeRun = database.prepare(
    "SELECT 1 AS active FROM import_runs WHERE status = 'running' LIMIT 1"
  ).get();
  if (activeRun) throw new Error('An import or discovery operation is still active. Finish it before restoring a backup.');

  await validateDatabaseBackup(selectedPath, supportedSchemaVersion);
  await mkdir(dirname(livePath), { recursive: true });

  const token = randomUUID();
  const stagedPath = livePath + '.restore-' + token + '.tmp';
  const previousTemporaryPath = livePath + '.previous-' + token + '.tmp';
  const previousPath = livePath + '.previous-restore.sqlite';
  const interruptedSwapPath = livePath + '.swap-old';
  let sourceDatabase: DatabaseSync | null = null;
  let liveDatabaseClosed = false;
  let liveFileMoved = false;

  try {
    sourceDatabase = new DatabaseSync(selectedPath, { readOnly: true });
    await backup(sourceDatabase, stagedPath, { rate: 128 });
    sourceDatabase.close();
    sourceDatabase = null;
    await validateDatabaseBackup(stagedPath, supportedSchemaVersion);

    await backup(database, previousTemporaryPath, { rate: 128 });
    await validateDatabaseBackup(previousTemporaryPath, supportedSchemaVersion);
    await replaceFileWithRollback(previousTemporaryPath, previousPath);

    const checkpoint = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
      | { busy?: number }
      | undefined;
    if (checkpoint?.busy && checkpoint.busy > 0) {
      throw new Error('The application database is busy and could not be safely closed.');
    }

    database.close();
    liveDatabaseClosed = true;
    await removeDatabaseSidecars(livePath);

    // The fallback lets startup recover if the process is interrupted mid-swap.
    await rm(interruptedSwapPath, { force: true });
    await rename(livePath, interruptedSwapPath);
    liveFileMoved = true;
    await rename(stagedPath, livePath);
    await rm(interruptedSwapPath, { force: true });
    return previousPath;
  } catch (error) {
    if (liveFileMoved && !existsSync(livePath) && existsSync(interruptedSwapPath)) {
      await rename(interruptedSwapPath, livePath).catch(() => undefined);
    }
    if (liveDatabaseClosed) {
      throw new Error('The restore could not be completed. The application will restart using the recovered database.', {
        cause: error
      });
    }
    throw error;
  } finally {
    sourceDatabase?.close();
    await rm(stagedPath, { force: true });
    await rm(previousTemporaryPath, { force: true });
  }
}

/** Recovers the old DB file if the app exited after moving it but before installing the staged restore. */
export function recoverInterruptedDatabaseSwap(databasePath: string): void {
  const livePath = resolve(databasePath);
  const fallbackPath = livePath + '.swap-old';
  if (!existsSync(livePath) && existsSync(fallbackPath)) {
    renameSync(fallbackPath, livePath);
  }
}
