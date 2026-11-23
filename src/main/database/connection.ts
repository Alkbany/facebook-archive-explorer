import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface SqlMigration {
  version: number;
  name: string;
  sql: string;
}

export function applyMigrations(database: DatabaseSync, migrations: readonly SqlMigration[]): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const hasMigration = database.prepare(
    'SELECT 1 AS found FROM schema_migrations WHERE version = ?'
  );
  const saveMigration = database.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
  );

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (hasMigration.get(migration.version)) continue;

    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      saveMigration.run(migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw new Error(`Database migration ${migration.version} (${migration.name}) failed.`, {
        cause: error
      });
    }
  }
}

export function openAppDatabase(
  databasePath: string,
  migrations: readonly SqlMigration[]
): DatabaseSync {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);

  try {
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA busy_timeout = 5000');

    if (databasePath !== ':memory:') {
      database.exec('PRAGMA journal_mode = WAL');
      database.exec('PRAGMA synchronous = NORMAL');
    }

    applyMigrations(database, migrations);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
