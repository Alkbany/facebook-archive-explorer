import type { DatabaseSync } from 'node:sqlite';
import type { ImportAllSupportedDataResult } from '../../../shared/archive/inspection';
import { importFriendsSection } from './friends-importer';
import { importMessagesSection } from './messages-importer';
import { importPostsSection } from './posts-importer';
import { importCommentsSection } from './comments-importer';
import { importReactionsSection } from './reactions-importer';

/**
 * Repairs file/run markers left by an interrupted import-all session.
 * Per-file import runs are intentionally retained as the audit trail.
 */
function recoverInterruptedImports(database: DatabaseSync, snapshotId: string): void {
  const timestamp = new Date().toISOString();
  const snapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?')
    .get(snapshotId) as { status: string } | undefined;
  const processingFiles = database.prepare(`
    SELECT COUNT(*) AS count FROM source_files
    WHERE snapshot_id = ? AND status = 'processing'
  `).get(snapshotId) as { count: number };
  const runningImports = database.prepare(`
    SELECT COUNT(*) AS count FROM import_runs
    WHERE snapshot_id = ? AND run_type = 'import' AND status = 'running'
  `).get(snapshotId) as { count: number };

  database.prepare(`
    UPDATE source_files
    SET status = 'failed', safe_error_code = 'IMPORT_INTERRUPTED', processed_at = ?
    WHERE snapshot_id = ? AND status = 'processing'
  `).run(timestamp, snapshotId);

  database.prepare(`
    UPDATE import_runs
    SET status = 'failed', finished_at = ?, errors_count = errors_count + 1
    WHERE snapshot_id = ? AND run_type = 'import' AND status = 'running'
  `).run(timestamp, snapshotId);

  if (snapshot?.status === 'importing' || processingFiles.count > 0 || runningImports.count > 0) {
    database.prepare(`
      UPDATE archive_snapshots SET status = 'partial', updated_at = ?
      WHERE id = ? AND status = 'importing'
    `).run(timestamp, snapshotId);
  }
}

export async function importAllSupportedData(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string
): Promise<ImportAllSupportedDataResult> {
  recoverInterruptedImports(database, snapshotId);
  const startedAt = new Date().toISOString();
  database.prepare("UPDATE archive_snapshots SET status = 'importing', updated_at = ? WHERE id = ?")
    .run(startedAt, snapshotId);

  try {
    const friends = await importFriendsSection(database, snapshotId, archiveRoot);
    const messages = await importMessagesSection(database, snapshotId, archiveRoot);
    const posts = await importPostsSection(database, snapshotId, archiveRoot);
    const comments = await importCommentsSection(database, snapshotId, archiveRoot);
    const reactions = await importReactionsSection(database, snapshotId, archiveRoot);

    const sections = { friends, messages, posts, comments, reactions };
    const totals = Object.values(sections).reduce<ImportAllSupportedDataResult['totals']>((result, section) => {
      const mediaReferences = 'mediaReferences' in section ? section.mediaReferences : 0;
      return {
        filesAttempted: result.filesAttempted + section.filesAttempted,
        recordsImported: result.recordsImported + section.recordsImported,
        mediaReferences: result.mediaReferences + mediaReferences,
        unsupportedFiles: result.unsupportedFiles + section.unsupportedFiles,
        failedFiles: result.failedFiles + section.failedFiles
      };
    }, {
      filesAttempted: 0,
      recordsImported: 0,
      mediaReferences: 0,
      unsupportedFiles: 0,
      failedFiles: 0
    });

    const finishedAt = new Date().toISOString();
    const snapshotStatus = totals.failedFiles > 0 || totals.unsupportedFiles > 0 ? 'partial' : 'completed';
    database.prepare(`
      UPDATE archive_snapshots
      SET status = ?, imported_at = ?, updated_at = ?
      WHERE id = ?
    `).run(snapshotStatus, finishedAt, finishedAt, snapshotId);

    return { sections, totals };
  } catch (error) {
    const failedAt = new Date().toISOString();
    database.prepare(`
      UPDATE archive_snapshots SET status = 'partial', updated_at = ?
      WHERE id = ?
    `).run(failedAt, snapshotId);
    throw error;
  }
}
