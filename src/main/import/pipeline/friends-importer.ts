import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import {
  parseFriendsExport,
  parseFriendsJsonExport,
  type FriendParseIssue,
  type FriendParseResult
} from '../parsers/friends-parser';

interface SourceFileRow {
  relative_path: string;
  file_name: string;
  detected_format: string;
}

export interface FriendsFileImportResult {
  importRunId: string;
  recordsImported: number;
  fileStatus: 'completed' | 'unsupported';
  issues: FriendParseIssue[];
}

function insertIssue(
  database: DatabaseSync,
  importRunId: string,
  sourceFileId: number,
  severity: 'warning' | 'error',
  code: string,
  message: string,
  context: Record<string, number | string | null> = {}
): void {
  database.prepare(`
    INSERT INTO import_issues (
      import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    importRunId,
    sourceFileId,
    severity,
    code,
    message,
    JSON.stringify(context),
    new Date().toISOString()
  );
}

function mapReadError(error: unknown, detectedFormat: string): { code: string; message: string } {
  if (error instanceof ArchiveReadError) {
    const messages: Record<string, string> = {
      INVALID_RELATIVE_PATH: 'The stored source path is not a valid archive-relative path.',
      FILE_NOT_FOUND: 'The source file is no longer present in the selected archive.',
      SYMLINK_NOT_ALLOWED: 'Symbolic links are not read by the archive importer.',
      NOT_A_FILE: 'The discovered source path is not a regular file.',
      FILE_TOO_LARGE: 'The source file exceeded the configured parsing size limit.',
      PATH_OUTSIDE_ARCHIVE: 'The source path resolves outside the selected archive.'
    };
    return { code: error.code, message: messages[error.code] ?? 'The source file could not be read.' };
  }

  if (error instanceof Error && error.message === 'FRIENDS_FORMAT_UNSUPPORTED') {
    return { code: 'FRIENDS_FORMAT_UNSUPPORTED', message: 'This file does not match a reviewed Friends export structure.' };
  }
  return detectedFormat === 'json'
    ? { code: 'FRIENDS_JSON_PARSE_FAILED', message: 'The Friends JSON file could not be parsed.' }
    : { code: 'FRIENDS_FILE_PARSING_FAILED', message: 'The Friends HTML file could not be parsed.' };
}

/**
 * Imports one Friends HTML file into normalized records.
 * Contact information is stored only inside payload_json, never in FTS5 fields.
 */
export async function importFriendsSourceFile(
  database: DatabaseSync,
  snapshotId: string,
  sourceFileId: number,
  archiveRoot: string
): Promise<FriendsFileImportResult> {
  const sourceFile = database.prepare(`
    SELECT relative_path, file_name, detected_format
    FROM source_files
    WHERE id = ? AND snapshot_id = ?
  `).get(sourceFileId, snapshotId) as SourceFileRow | undefined;

  if (!sourceFile) {
    throw new Error('The discovered source file does not belong to this backup.');
  }

  const importRunId = randomUUID();
  const startedAt = new Date().toISOString();

  database.prepare(`
    INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered)
    VALUES (?, ?, 'import', 'running', ?, 1)
  `).run(importRunId, snapshotId, startedAt);

  database.prepare(`
    UPDATE source_files
    SET status = 'processing', safe_error_code = NULL
    WHERE id = ? AND snapshot_id = ?
  `).run(sourceFileId, snapshotId);

  database.exec('SAVEPOINT friends_file_import');

  try {
    let parsed: FriendParseResult;
    if (sourceFile.detected_format === 'html') {
      const html = await readArchiveUtf8File(archiveRoot, sourceFile.relative_path);
      parsed = parseFriendsExport(html, sourceFile.relative_path);
    } else if (sourceFile.detected_format === 'json' && sourceFile.file_name.toLocaleLowerCase() === 'your_friends.json') {
      const json = (await readArchiveUtf8File(archiveRoot, sourceFile.relative_path)).replace(/^\uFEFF/u, '');
      parsed = parseFriendsJsonExport(json, sourceFile.relative_path);
    } else {
      throw new Error('FRIENDS_FORMAT_UNSUPPORTED');
    }
    const timestamp = new Date().toISOString();

    const insertRecord = database.prepare(`
      INSERT INTO records (
        snapshot_id,
        source_file_id,
        source_record_index,
        section_key,
        record_type,
        title,
        body_text,
        normalized_text,
        event_time_raw,
        event_time_utc,
        sensitivity,
        search_enabled,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, 'friends', ?, ?, NULL, ?, ?, NULL, 'personal', 1, ?, ?)
      ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET
        record_type = excluded.record_type,
        title = excluded.title,
        body_text = excluded.body_text,
        normalized_text = excluded.normalized_text,
        event_time_raw = excluded.event_time_raw,
        event_time_utc = excluded.event_time_utc,
        sensitivity = excluded.sensitivity,
        search_enabled = excluded.search_enabled,
        payload_json = excluded.payload_json,
        created_at = excluded.created_at
    `);

    for (const record of parsed.records) {
      insertRecord.run(
        snapshotId,
        sourceFileId,
        record.sourceCardIndex,
        record.recordType,
        record.nameRaw,
        normalizeSearchText(record.nameRaw),
        record.dateRaw,
        JSON.stringify(record.rawPayload ?? { contact_info_raw: record.contactInfoRaw }),
        timestamp
      );
    }

    for (const issue of parsed.issues) {
      const isMissingName = issue.code === 'missing_name';
      insertIssue(
        database,
        importRunId,
        sourceFileId,
        isMissingName ? 'warning' : 'error',
        isMissingName ? 'FRIEND_CARD_MISSING_NAME' : 'FRIENDS_CARDS_NOT_FOUND',
        isMissingName
          ? 'A Friends card had no readable name and was not imported.'
          : 'No recognized Friends cards were found in this HTML file.',
        { sourceCardIndex: issue.sourceCardIndex }
      );
    }

    const unsupported = parsed.issues.some((issue) => issue.code === 'no_cards_found');
    const fileStatus = unsupported ? 'unsupported' : 'completed';
    const safeErrorCode = unsupported ? 'FRIENDS_CARDS_NOT_FOUND' : null;

    database.prepare(`
      UPDATE source_files
      SET status = ?, record_count = ?, safe_error_code = ?, processed_at = ?
      WHERE id = ? AND snapshot_id = ?
    `).run(fileStatus, parsed.records.length, safeErrorCode, timestamp, sourceFileId, snapshotId);

    database.prepare(`
      UPDATE import_runs
      SET status = 'completed',
          finished_at = ?,
          files_processed = 1,
          records_imported = ?,
          errors_count = ?
      WHERE id = ?
    `).run(timestamp, parsed.records.length, unsupported ? 1 : 0, importRunId);

    database.exec('RELEASE friends_file_import');

    return {
      importRunId,
      recordsImported: parsed.records.length,
      fileStatus,
      issues: parsed.issues
    };
  } catch (error) {
    database.exec('ROLLBACK TO friends_file_import');
    database.exec('RELEASE friends_file_import');

    const failure = mapReadError(error, sourceFile.detected_format);
    const timestamp = new Date().toISOString();

    database.exec('SAVEPOINT friends_file_failure');
    try {
      database.prepare(`
        UPDATE source_files
        SET status = 'failed', safe_error_code = ?, processed_at = ?
        WHERE id = ? AND snapshot_id = ?
      `).run(failure.code, timestamp, sourceFileId, snapshotId);

      insertIssue(
        database,
        importRunId,
        sourceFileId,
        'error',
        failure.code,
        failure.message
      );

      database.prepare(`
        UPDATE import_runs
        SET status = 'failed', finished_at = ?, files_processed = 1, errors_count = 1
        WHERE id = ?
      `).run(timestamp, importRunId);

      database.exec('RELEASE friends_file_failure');
    } catch (writeError) {
      database.exec('ROLLBACK TO friends_file_failure');
      database.exec('RELEASE friends_file_failure');
      throw writeError;
    }

    throw new Error('The Friends source file could not be imported. See the local import report.');
  }
}

const FRIENDS_HTML_EXPORT_FILES = [
  'friends.html',
  'received_friend_requests.html',
  'sent_friend_requests.html',
  'rejected_friend_requests.html',
  'removed_friends.html'
] as const;
const FRIENDS_JSON_EXPORT_FILE = 'your_friends.json';

export interface FriendsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

/**
 * Imports the five reviewed Friends HTML files and the observed TNG friends_v2 JSON export for one snapshot.
 * Completed files are left untouched; failed/unsupported files may be retried.
 */
export async function importFriendsSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<FriendsImportSectionResult> {
  const placeholders = FRIENDS_HTML_EXPORT_FILES.map(() => '?').join(', ');
  const files = database.prepare(`
    SELECT id, file_name
    FROM source_files
    WHERE snapshot_id = ?
      AND section_key = 'friends'
      AND (
        (detected_format = 'html' AND lower(file_name) IN (${placeholders}))
        OR (detected_format = 'json' AND lower(file_name) = ?)
      )
      AND status IN ('discovered', 'failed', 'unsupported')
    ORDER BY relative_path
  `).all(snapshotId, ...FRIENDS_HTML_EXPORT_FILES, FRIENDS_JSON_EXPORT_FILE) as Array<{ id: number; file_name: string }>;

  const summary: FriendsImportSectionResult = {
    filesAttempted: 0,
    recordsImported: 0,
    unsupportedFiles: 0,
    failedFiles: 0
  };

  const emitProgress = (phase: 'started' | 'progress' | 'completed') => reportImportProgress(onProgress, {
    sectionKey: 'friends',
    phase,
    filesCompleted: summary.filesAttempted,
    filesTotal: files.length,
    recordsImported: summary.recordsImported,
    unsupportedFiles: summary.unsupportedFiles,
    failedFiles: summary.failedFiles
  });
  emitProgress('started');

  for (const file of files) {
    await waitIfImportPaused();
    summary.filesAttempted += 1;
    try {
      const result = await importFriendsSourceFile(database, snapshotId, file.id, archiveRoot);
      summary.recordsImported += result.recordsImported;
      if (result.fileStatus === 'unsupported') summary.unsupportedFiles += 1;
    } catch {
      summary.failedFiles += 1;
    }
    emitProgress('progress');
  }

  emitProgress('completed');
  return summary;
}
