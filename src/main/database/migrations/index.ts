import initialSchema from './001_initial_schema.sql?raw';
import type { SqlMigration } from '../connection';

export const DATABASE_MIGRATIONS: readonly SqlMigration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: initialSchema
  }
];
