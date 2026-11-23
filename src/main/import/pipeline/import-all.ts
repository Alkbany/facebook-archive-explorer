import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ImportAllSupportedDataResult } from '../../../shared/archive/inspection';
import { importFriendsSection } from './friends-importer';
import { importMessagesSection } from './messages-importer';
import { importPostsSection } from './posts-importer';
import { importCommentsSection } from './comments-importer';
import { importReactionsSection } from './reactions-importer';
import { importPhotoAlbumsSection } from './photo-albums-importer';
import { importPhotoAlbumDetailsSection } from './photo-album-details-importer';
import type { ImportProgressReporter } from './import-progress';

/**
 * Repairs file/run markers left by an interrupted import-all session.
 * Per-file import runs are intentionally retained as the audit trail.
 */
export function recoverInterruptedImports(database: DatabaseSync, snapshotId: string): void {
  database.exec('SAVEPOINT startup_import_recovery');
  try {
  const timestamp = new Date().toISOString();
  const snapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?')
    .get(snapshotId) as { status: string } | undefined;
  const processingFiles = database.prepare(`
    SELECT id FROM source_files
    WHERE snapshot_id = ? AND status = 'processing'
    ORDER BY id
  `).all(snapshotId) as Array<{ id: number }>;
  const runningImports = database.prepare(`
    SELECT id FROM import_runs
    WHERE snapshot_id = ? AND run_type = 'import' AND status = 'running'
    ORDER BY started_at, id
  `).all(snapshotId) as Array<{ id: string }>;

  database.prepare(`
    UPDATE source_files
    SET status = 'failed', safe_error_code = 'IMPORT_INTERRUPTED', processed_at = ?
    WHERE snapshot_id = ? AND status = 'processing'
  `).run(timestamp, snapshotId);

  // A processing file should normally have a running per-file import run.
  // Create a failed recovery run only when the database contains an orphaned
  // processing marker, so every recovered file still has a diagnostics link.
  const diagnosticRunIds = [...runningImports];
  if (processingFiles.length > 0 && diagnosticRunIds.length === 0) {
    const recoveryRunId = randomUUID();
    database.prepare(`
      INSERT INTO import_runs (
        id, snapshot_id, run_type, status, started_at, finished_at,
        files_discovered, files_processed, records_imported, errors_count
      ) VALUES (?, ?, 'import', 'failed', ?, ?, ?, ?, 0, ?)
    `).run(
      recoveryRunId,
      snapshotId,
      timestamp,
      timestamp,
      processingFiles.length,
      processingFiles.length,
      processingFiles.length
    );
    diagnosticRunIds.push({ id: recoveryRunId });
  }

  const issueCounts = new Map<string, number>();
  const insertInterruptedIssue = database.prepare(`
    INSERT INTO import_issues (
      import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at
    ) VALUES (?, ?, 'error', 'IMPORT_INTERRUPTED', ?, '{"recoveredAtStartup":true}', ?)
  `);

  const safeFileMessage = 'The import process ended before this source file finished. Retry the section to import it again.';
  const safeArchiveMessage = 'The import process ended before its active operation completed. Retry the section to continue.';

  if (processingFiles.length > 0) {
    processingFiles.forEach((file, index) => {
      const run = diagnosticRunIds[Math.min(index, diagnosticRunIds.length - 1)];
      if (!run) return;
      insertInterruptedIssue.run(run.id, file.id, safeFileMessage, timestamp);
      issueCounts.set(run.id, (issueCounts.get(run.id) ?? 0) + 1);
    });
  }

  // A run can be left behind if the process stops between creating its run
  // row and marking a source file as processing. Keep that visible as an
  // archive-level diagnostic instead of silently failing the run.
  const firstUnmatchedRun = processingFiles.length > 0 ? Math.min(processingFiles.length, diagnosticRunIds.length) : 0;
  for (let index = firstUnmatchedRun; index < diagnosticRunIds.length; index += 1) {
    const run = diagnosticRunIds[index];
    insertInterruptedIssue.run(run.id, null, safeArchiveMessage, timestamp);
    issueCounts.set(run.id, (issueCounts.get(run.id) ?? 0) + 1);
  }

  for (const run of runningImports) {
    const addedErrors = issueCounts.get(run.id) ?? 1;
    database.prepare(`
      UPDATE import_runs
      SET status = 'failed', finished_at = ?, errors_count = errors_count + ?
      WHERE id = ? AND status = 'running'
    `).run(timestamp, addedErrors, run.id);
  }

  if (snapshot?.status === 'importing' || processingFiles.length > 0 || runningImports.length > 0) {
    database.prepare(`
      UPDATE archive_snapshots SET status = 'partial', updated_at = ?
      WHERE id = ? AND status NOT IN ('failed', 'cancelled')
    `).run(timestamp, snapshotId);
  }
  database.exec('RELEASE startup_import_recovery');
  } catch (error) {
    database.exec('ROLLBACK TO startup_import_recovery');
    database.exec('RELEASE startup_import_recovery');
    throw error;
  }
}

/** Repairs every interrupted import before a user can reopen or retry any section. */
export function recoverAllInterruptedImports(database: DatabaseSync): number {
  const interruptedSnapshots = database.prepare(`
    SELECT id FROM archive_snapshots WHERE status = 'importing'
    UNION
    SELECT snapshot_id AS id FROM source_files WHERE status = 'processing'
    UNION
    SELECT snapshot_id AS id FROM import_runs WHERE run_type = 'import' AND status = 'running'
  `).all() as Array<{ id: string }>;

  for (const snapshot of interruptedSnapshots) {
    recoverInterruptedImports(database, snapshot.id);
  }
  return interruptedSnapshots.length;
}

export async function importAllSupportedData(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<ImportAllSupportedDataResult> {
  recoverInterruptedImports(database, snapshotId);
  const startedAt = new Date().toISOString();
  database.prepare("UPDATE archive_snapshots SET status = 'importing', updated_at = ? WHERE id = ?")
    .run(startedAt, snapshotId);

  try {
    const friends = await importFriendsSection(database, snapshotId, archiveRoot, onProgress);
    const messages = await importMessagesSection(database, snapshotId, archiveRoot, onProgress);
    const posts = await importPostsSection(database, snapshotId, archiveRoot, onProgress);
    const comments = await importCommentsSection(database, snapshotId, archiveRoot, onProgress);
    const reactions = await importReactionsSection(database, snapshotId, archiveRoot, onProgress);
    const photoAlbumIndex = await importPhotoAlbumsSection(database, snapshotId, archiveRoot, onProgress);
    const photoAlbumDetails = await importPhotoAlbumDetailsSection(database, snapshotId, archiveRoot, onProgress);
    const photosAndVideos = {
      filesAttempted: photoAlbumIndex.filesAttempted + photoAlbumDetails.filesAttempted,
      recordsImported: photoAlbumIndex.recordsImported + photoAlbumDetails.recordsImported,
      mediaReferences: photoAlbumIndex.mediaReferences + photoAlbumDetails.mediaReferences,
      unsupportedFiles: photoAlbumIndex.unsupportedFiles + photoAlbumDetails.unsupportedFiles,
      failedFiles: photoAlbumIndex.failedFiles + photoAlbumDetails.failedFiles
    };

    const sections = { friends, messages, posts, comments, reactions, photosAndVideos };
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
