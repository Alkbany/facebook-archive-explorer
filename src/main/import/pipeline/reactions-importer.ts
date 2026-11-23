import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { parseReactionsExport } from '../parsers/reactions-parser';

export interface ReactionsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

interface SourceFileRow { id: number; relative_path: string; detected_format: string; }

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) return { code: error.code, message: 'The source file could not be safely read from the selected backup.' };
  return { code: 'REACTIONS_IMPORT_FAILED', message: 'The Likes & Reactions source file could not be imported.' };
}

/** Imports recognized Likes & Reactions HTML files within one selected snapshot. */
export async function importReactionsSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<ReactionsImportSectionResult> {
  const files = database.prepare(`
    SELECT id, relative_path, detected_format
    FROM source_files
    WHERE snapshot_id = ? AND section_key = 'likes_and_reactions'
      AND detected_format = 'html' AND status IN ('discovered', 'failed', 'unsupported')
    ORDER BY relative_path COLLATE NOCASE
  `).all(snapshotId) as unknown as SourceFileRow[];
  const summary: ReactionsImportSectionResult = { filesAttempted: 0, recordsImported: 0, unsupportedFiles: 0, failedFiles: 0 };

  const emitProgress = (phase: 'started' | 'progress' | 'completed') => reportImportProgress(onProgress, {
    sectionKey: 'likes_and_reactions',
    phase,
    filesCompleted: summary.filesAttempted,
    filesTotal: files.length,
    recordsImported: summary.recordsImported,
    unsupportedFiles: summary.unsupportedFiles,
    failedFiles: summary.failedFiles
  });
  emitProgress('started');

  for (const file of files) {
    summary.filesAttempted += 1;
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    database.prepare("INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered) VALUES (?, ?, 'import', 'running', ?, 1)")
      .run(runId, snapshotId, startedAt);
    database.prepare("UPDATE source_files SET status = 'processing', safe_error_code = NULL WHERE id = ? AND snapshot_id = ?")
      .run(file.id, snapshotId);
    database.exec('SAVEPOINT reactions_file');
    try {
      const html = await readArchiveUtf8File(archiveRoot, file.relative_path);
      const parsed = parseReactionsExport(html, file.relative_path);
      const timestamp = new Date().toISOString();
      const insert = database.prepare(`
        INSERT INTO records (
          snapshot_id, source_file_id, source_record_index, section_key, record_type,
          title, body_text, normalized_text, event_time_raw, event_time_utc,
          sensitivity, search_enabled, payload_json, created_at
        ) VALUES (?, ?, ?, 'likes_and_reactions', 'reaction', ?, ?, ?, ?, NULL, 'personal', 1, ?, ?)
        ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET
          title=excluded.title, body_text=excluded.body_text, normalized_text=excluded.normalized_text,
          event_time_raw=excluded.event_time_raw, payload_json=excluded.payload_json, created_at=excluded.created_at
      `);
      for (const record of parsed.records) {
        insert.run(snapshotId, file.id, record.sourceCardIndex, record.reactionType, record.descriptionRaw,
          normalizeSearchText([record.reactionType, record.descriptionRaw].filter(Boolean).join(' ')),
          record.dateRaw, JSON.stringify({ reaction_image_raw: record.reactionImageRaw }), timestamp);
      }
      const unsupported = parsed.records.length === 0;
      for (const issue of parsed.issues) {
        database.prepare(`
          INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
          VALUES (?, ?, 'warning', ?, ?, ?, ?)
        `).run(runId, file.id, issue.code.toUpperCase(), 'A reaction card could not be fully interpreted.', JSON.stringify({ sourceCardIndex: issue.sourceCardIndex }), timestamp);
      }
      database.prepare('UPDATE source_files SET status = ?, record_count = ?, safe_error_code = ?, processed_at = ? WHERE id = ? AND snapshot_id = ?')
        .run(unsupported ? 'unsupported' : 'completed', parsed.records.length, unsupported ? 'REACTION_CARDS_NOT_FOUND' : null, timestamp, file.id, snapshotId);
      database.prepare("UPDATE import_runs SET status='completed', finished_at=?, files_processed=1, records_imported=?, errors_count=? WHERE id=?")
        .run(timestamp, parsed.records.length, unsupported ? 1 : 0, runId);
      database.exec('RELEASE reactions_file');
      summary.recordsImported += parsed.records.length;
      if (unsupported) summary.unsupportedFiles += 1;
    } catch (error) {
      database.exec('ROLLBACK TO reactions_file');
      database.exec('RELEASE reactions_file');
      const failure = safeFailure(error);
      const timestamp = new Date().toISOString();
      database.prepare("UPDATE source_files SET status='failed', safe_error_code=?, processed_at=? WHERE id=? AND snapshot_id=?")
        .run(failure.code, timestamp, file.id, snapshotId);
      database.prepare(`
        INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
        VALUES (?, ?, 'error', ?, ?, '{}', ?)
      `).run(runId, file.id, failure.code, failure.message, timestamp);
      database.prepare("UPDATE import_runs SET status='failed', finished_at=?, files_processed=1, errors_count=1 WHERE id=?")
        .run(timestamp, runId);
      summary.failedFiles += 1;
    }
    emitProgress('progress');
  }
  emitProgress('completed');
  return summary;
}
