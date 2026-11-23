import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { parseCommentsExport } from '../parsers/comments-parser';

export interface CommentsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}
interface SourceFileRow { id: number; relative_path: string; }

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) return { code: error.code, message: 'The source file could not be safely read from the selected backup.' };
  return { code: 'COMMENTS_IMPORT_FAILED', message: 'The comments source file could not be imported.' };
}

/** Imports observed Comments HTML activity cards for one selected snapshot. */
export async function importCommentsSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string
): Promise<CommentsImportSectionResult> {
  const files = database.prepare(`
    SELECT id, relative_path FROM source_files
    WHERE snapshot_id = ? AND section_key = 'comments' AND detected_format = 'html'
      AND status IN ('discovered', 'failed', 'unsupported')
    ORDER BY relative_path COLLATE NOCASE
  `).all(snapshotId) as unknown as SourceFileRow[];
  const summary: CommentsImportSectionResult = {
    filesAttempted: 0, recordsImported: 0, unsupportedFiles: 0, failedFiles: 0
  };

  for (const file of files) {
    summary.filesAttempted += 1;
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    database.prepare("INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered) VALUES (?, ?, 'import', 'running', ?, 1)")
      .run(runId, snapshotId, startedAt);
    database.exec('SAVEPOINT comments_file');
    try {
      const parsed = parseCommentsExport(await readArchiveUtf8File(archiveRoot, file.relative_path), file.relative_path);
      const now = new Date().toISOString();
      const insertRecord = database.prepare(`
        INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
          title, body_text, normalized_text, event_time_raw, event_time_utc, sensitivity, search_enabled, payload_json, created_at)
        VALUES (?, ?, ?, 'comments', 'comment_activity', ?, ?, ?, ?, NULL, 'personal', 1, ?, ?)
        ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET
          title=excluded.title, body_text=excluded.body_text, normalized_text=excluded.normalized_text,
          event_time_raw=excluded.event_time_raw, payload_json=excluded.payload_json, created_at=excluded.created_at
      `);
      for (const record of parsed.records) {
        const normalized = normalizeSearchText([record.activityRaw, record.groupRaw, record.bodyRaw].filter(Boolean).join(' '));
        insertRecord.run(
          snapshotId, file.id, record.sourceCardIndex, record.activityRaw, record.bodyRaw,
          normalized, record.dateRaw,
          JSON.stringify({ group_raw: record.groupRaw, permalink_raw: record.permalinkRaw }), now
        );
      }
      for (const issue of parsed.issues) {
        database.prepare(`
          INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
          VALUES (?, ?, 'warning', ?, ?, ?, ?)
        `).run(runId, file.id, issue.code.toUpperCase(), 'A comment activity card could not be fully interpreted.',
          JSON.stringify({ sourceCardIndex: issue.sourceCardIndex }), now);
      }
      const unsupported = parsed.records.length === 0;
      database.prepare('UPDATE source_files SET status=?, record_count=?, safe_error_code=?, processed_at=? WHERE id=? AND snapshot_id=?')
        .run(unsupported ? 'unsupported' : 'completed', parsed.records.length,
          unsupported ? 'COMMENT_CARDS_NOT_FOUND' : null, now, file.id, snapshotId);
      database.prepare("UPDATE import_runs SET status='completed', finished_at=?, files_processed=1, records_imported=?, errors_count=? WHERE id=?")
        .run(now, parsed.records.length, unsupported ? 1 : 0, runId);
      database.exec('RELEASE comments_file');
      summary.recordsImported += parsed.records.length;
      if (unsupported) summary.unsupportedFiles += 1;
    } catch (error) {
      database.exec('ROLLBACK TO comments_file');
      database.exec('RELEASE comments_file');
      const failure = safeFailure(error);
      const now = new Date().toISOString();
      database.prepare("UPDATE source_files SET status='failed', safe_error_code=?, processed_at=? WHERE id=? AND snapshot_id=?")
        .run(failure.code, now, file.id, snapshotId);
      database.prepare(`
        INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
        VALUES (?, ?, 'error', ?, ?, '{}', ?)
      `).run(runId, file.id, failure.code, failure.message, now);
      database.prepare("UPDATE import_runs SET status='failed', finished_at=?, files_processed=1, errors_count=1 WHERE id=?")
        .run(now, runId);
      summary.failedFiles += 1;
    }
  }
  return summary;
}
