import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import {
  exportDatabaseBackup,
  recoverInterruptedDatabaseSwap,
  restoreDatabaseBackup,
  validateDatabaseBackup
} from '../src/main/database/backup';
import { getOrCreateAccount } from '../src/main/database/archive-repository';

const migrations = [
  { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
  { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
] as const;

const temporaryDirectories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'archive-db-backup-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe('local database backup and restore', () => {
  it('exports a consistent standalone SQLite backup containing committed WAL data', async () => {
    const directory = await makeDirectory();
    const livePath = join(directory, 'live.sqlite');
    const exportPath = join(directory, 'exports', 'archive-copy.sqlite');
    const database = openAppDatabase(livePath, migrations);
    try {
      getOrCreateAccount(database, 'Personal archive');
      const result = await exportDatabaseBackup(database, exportPath, migrations.length);
      expect(result.fileName).toBe('archive-copy.sqlite');
      expect(result.pagesCopied).toBeGreaterThan(0);
      expect(result.sizeBytes).toBe((await stat(exportPath)).size);
      await expect(validateDatabaseBackup(exportPath, migrations.length)).resolves.toMatchObject({
        schemaVersion: 2,
        accounts: 1,
        snapshots: 0,
        records: 0
      });

      const exported = new DatabaseSync(exportPath, { readOnly: true });
      try {
        expect(exported.prepare('SELECT display_name FROM accounts').get())
          .toEqual({ display_name: 'Personal archive' });
      } finally {
        exported.close();
      }
    } finally {
      database.close();
    }
  });

  it('rejects arbitrary SQLite files and leaves the active database untouched', async () => {
    const directory = await makeDirectory();
    const livePath = join(directory, 'live.sqlite');
    const invalidPath = join(directory, 'not-an-archive.sqlite');
    const database = openAppDatabase(livePath, migrations);
    const arbitrary = new DatabaseSync(invalidPath);
    arbitrary.exec('CREATE TABLE unrelated (value TEXT)');
    arbitrary.close();

    try {
      getOrCreateAccount(database, 'Keep this account');
      await expect(validateDatabaseBackup(invalidPath, migrations.length)).rejects.toThrow(
        'not a recognized archive database'
      );
      await expect(restoreDatabaseBackup(database, invalidPath, livePath, migrations.length)).rejects.toThrow();
      expect(database.isOpen).toBe(true);
      expect(database.prepare('SELECT display_name FROM accounts').get())
        .toEqual({ display_name: 'Keep this account' });
    } finally {
      database.close();
    }
  });

  it('restores a verified backup, preserves a pre-restore recovery copy, and closes the live handle', async () => {
    const directory = await makeDirectory();
    const livePath = join(directory, 'live.sqlite');
    const sourcePath = join(directory, 'portable-backup.sqlite');
    const liveDatabase = openAppDatabase(livePath, migrations);
    const sourceDatabase = openAppDatabase(sourcePath, migrations);
    getOrCreateAccount(liveDatabase, 'Existing local account');
    getOrCreateAccount(sourceDatabase, 'Restored account');
    sourceDatabase.close();

    const previousPath = await restoreDatabaseBackup(
      liveDatabase,
      sourcePath,
      livePath,
      migrations.length
    );

    expect(liveDatabase.isOpen).toBe(false);
    await expect(stat(previousPath)).resolves.toBeDefined();

    const restored = openAppDatabase(livePath, migrations);
    try {
      const names = restored.prepare('SELECT display_name FROM accounts ORDER BY display_name')
        .all() as Array<{ display_name: string }>;
      expect(names).toEqual([{ display_name: 'Restored account' }]);

      const previous = new DatabaseSync(previousPath, { readOnly: true });
      try {
        expect(previous.prepare('SELECT display_name FROM accounts').get())
          .toEqual({ display_name: 'Existing local account' });
      } finally {
        previous.close();
      }
    } finally {
      restored.close();
    }
  });

  it('refuses restore while an import run is active without closing the database', async () => {
    const directory = await makeDirectory();
    const livePath = join(directory, 'live.sqlite');
    const sourcePath = join(directory, 'portable-backup.sqlite');
    const liveDatabase = openAppDatabase(livePath, migrations);
    const sourceDatabase = openAppDatabase(sourcePath, migrations);
    const accountId = getOrCreateAccount(liveDatabase, 'Busy account');
    const now = new Date().toISOString();
    liveDatabase.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES ('busy-snapshot', ?, 'Busy backup', 'directory', ?, 'importing', ?, ?)
    `).run(accountId, directory, now, now);
    liveDatabase.prepare(`
      INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at)
      VALUES ('busy-run', 'busy-snapshot', 'import', 'running', ?)
    `).run(now);

    try {
      await expect(restoreDatabaseBackup(liveDatabase, sourcePath, livePath, migrations.length))
        .rejects.toThrow('operation is still active');
      expect(liveDatabase.isOpen).toBe(true);
    } finally {
      liveDatabase.close();
      sourceDatabase.close();
    }
  });

  it('recovers the original database path after an interrupted file swap', async () => {
    const directory = await makeDirectory();
    const livePath = join(directory, 'live.sqlite');
    const fallbackPath = livePath + '.swap-old';
    await mkdir(directory, { recursive: true });
    await writeFile(fallbackPath, 'previous database bytes');
    recoverInterruptedDatabaseSwap(livePath);
    expect(await readFile(livePath, 'utf8')).toBe('previous database bytes');
    await expect(stat(fallbackPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not overwrite the active database when exporting', async () => {
    const directory = await makeDirectory();
    const livePath = join(directory, 'live.sqlite');
    const database = openAppDatabase(livePath, migrations);
    try {
      await expect(exportDatabaseBackup(database, livePath, migrations.length)).rejects.toThrow(
        'different destination'
      );
      expect(database.isOpen).toBe(true);
    } finally {
      database.close();
    }
  });
});
