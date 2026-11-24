import type { DatabaseSync } from 'node:sqlite';

/**
 * Replaces one source file's previously imported records after its new content
 * has been read and parsed successfully. Call inside the file savepoint.
 *
 * SQLite triggers and foreign keys remove obsolete FTS rows and media links.
 */
export function clearSourceFileRecords(database: DatabaseSync, sourceFileId: number): number {
  if (!Number.isSafeInteger(sourceFileId) || sourceFileId < 1) {
    throw new RangeError('A valid source file ID is required.');
  }
  const result = database.prepare('DELETE FROM records WHERE source_file_id = ?').run(sourceFileId);
  database.prepare('UPDATE source_files SET record_count = 0 WHERE id = ?').run(sourceFileId);
  return Number(result.changes);
}
