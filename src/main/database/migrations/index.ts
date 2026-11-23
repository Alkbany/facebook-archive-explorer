import initialSchema from './001_initial_schema.sql?raw';
import accountNames from './002_account_names.sql?raw';
import type { SqlMigration } from '../connection';

export const DATABASE_MIGRATIONS: readonly SqlMigration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: initialSchema
  },
  {
    version: 2,
    name: 'unique_account_display_names',
    sql: accountNames
  }
];
