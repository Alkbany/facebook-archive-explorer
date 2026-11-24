import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { clearSourceFileRecords } from './source-file-records';
import type { ImportProgressEvent } from '../../../shared/archive/inspection';
import { getArchiveSection } from '../../../shared/archive/section-registry';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { ArchiveReadError, readArchiveBinaryFile } from '../discovery/read-archive-file';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';

interface TextSourceFile {
  id: number;
  relative_path: string;
  file_size_bytes: number | null;
  section_key: string;
}

export interface TextFallbackImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_INDEXED_TEXT_LENGTH = 20_000;

function decodeTextBytes(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString('utf16le');
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const bigEndianBytes = bytes.subarray(2, bytes.length - ((bytes.length - 2) % 2));
    const littleEndianBytes = Buffer.allocUnsafe(bigEndianBytes.length);
    for (let index = 0; index < bigEndianBytes.length; index += 2) {
      littleEndianBytes[index] = bigEndianBytes[index + 1];
      littleEndianBytes[index + 1] = bigEndianBytes[index];
    }
    return littleEndianBytes.toString('utf16le');
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString('utf8');
  }
  return bytes.toString('utf8');
}

function cleanText(value: string): string {
  return value
    .replace(/\u0000/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t ]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function getTitle(value: string, relativePath: string): string {
  const firstLine = value.split('\n').map((line) => line.trim()).find(Boolean);
  return (firstLine || relativePath).slice(0, 200);
}

function insertIssue(
  database: DatabaseSync,
  runId: string,
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
  `).run(runId, sourceFileId, severity, code, message, JSON.stringify(context), new Date().toISOString());
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) {
    return { code: error.code, message: 'The text source file could not be safely read from the selected archive.' };
  }
  return { code: 'TEXT_FALLBACK_FAILED', message: 'The text source file could not be converted into a local archive record.' };
}

async function importTextFile(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  file: TextSourceFile
): Promise<number> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered)
    VALUES (?, ?, 'import', 'running', ?, 1)
  `).run(runId, snapshotId, startedAt);
  database.prepare(`
    UPDATE source_files SET status = 'processing', safe_error_code = NULL
    WHERE id = ? AND snapshot_id = ?
  `).run(file.id, snapshotId);

  database.exec('SAVEPOINT text_fallback_file');
  try {
    if (file.file_size_bytes !== null && file.file_size_bytes > MAX_TEXT_FILE_BYTES) {
      throw new ArchiveReadError('FILE_TOO_LARGE');
    }
    const sourceBytes = await readArchiveBinaryFile(archiveRoot, file.relative_path, MAX_TEXT_FILE_BYTES);
    const withoutBom = decodeTextBytes(sourceBytes);
    const normalizedText = cleanText(withoutBom);
    clearSourceFileRecords(database, file.id);
    const section = getArchiveSection(file.section_key);
    const sensitivity = section?.sensitivity ?? 'sensitive';
    const searchEnabled = sensitivity === 'sensitive' ? 0 : 1;
    const timestamp = new Date().toISOString();
    let imported = 0;

    if (normalizedText.length > 0) {
      const title = getTitle(normalizedText, file.relative_path);
      const body = normalizedText.slice(0, MAX_INDEXED_TEXT_LENGTH);
      const payload = JSON.stringify({ text: withoutBom });
      const normalized = searchEnabled ? normalizeSearchText(title + ' ' + body) : null;
      database.prepare(`
        INSERT INTO records (
          snapshot_id, source_file_id, source_record_index, section_key, record_type,
          title, body_text, normalized_text, event_time_raw, event_time_utc,
          sensitivity, search_enabled, payload_json, created_at
        ) VALUES (?, ?, 0, ?, 'text_item', ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
        ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET
          section_key = excluded.section_key,
          record_type = excluded.record_type,
          title = excluded.title,
          body_text = excluded.body_text,
          normalized_text = excluded.normalized_text,
          event_time_raw = NULL,
          event_time_utc = NULL,
          sensitivity = excluded.sensitivity,
          search_enabled = excluded.search_enabled,
          payload_json = excluded.payload_json,
          created_at = excluded.created_at
      `).run(
        snapshotId, file.id, file.section_key, title, body, normalized,
        sensitivity, searchEnabled, payload, timestamp
      );
      imported = 1;
    }

    database.prepare(`
      UPDATE source_files
      SET status = ?, parser_key = 'text_fallback', record_count = ?,
        safe_error_code = NULL, processed_at = ?
      WHERE id = ? AND snapshot_id = ?
    `).run(imported === 0 ? 'empty' : 'completed', imported, timestamp, file.id, snapshotId);

    if (normalizedText.length > MAX_INDEXED_TEXT_LENGTH) {
      insertIssue(database, runId, file.id, 'warning', 'TEXT_SEARCH_PREVIEW_TRUNCATED',
        'The full text file was preserved locally, while its searchable text preview was limited.',
        { maximumIndexedCharacters: MAX_INDEXED_TEXT_LENGTH });
    }
    database.prepare(`
      UPDATE import_runs SET status = 'completed', finished_at = ?, files_processed = 1,
        records_imported = ? WHERE id = ?
    `).run(timestamp, imported, runId);
    database.exec('RELEASE text_fallback_file');
    return imported;
  } catch (error) {
    database.exec('ROLLBACK TO text_fallback_file');
    database.exec('RELEASE text_fallback_file');
    const failure = safeFailure(error);
    const timestamp = new Date().toISOString();
    database.prepare(`
      UPDATE source_files SET status = 'failed', safe_error_code = ?, processed_at = ?
      WHERE id = ? AND snapshot_id = ?
    `).run(failure.code, timestamp, file.id, snapshotId);
    insertIssue(database, runId, file.id, 'error', failure.code, failure.message);
    database.prepare(`
      UPDATE import_runs SET status = 'failed', finished_at = ?, files_processed = 1, errors_count = 1
      WHERE id = ?
    `).run(timestamp, runId);
    throw new Error('A text file could not be imported. See the local import report.');
  }
}

/**
 * Preserves bounded plain-text files as local records. This is a content
 * preservation fallback, not a parser for the semantic meaning of a section.
 */
export async function importTextFallbackFilesSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<TextFallbackImportSectionResult> {
  const files = database.prepare(`
    SELECT id, relative_path, file_size_bytes, section_key
    FROM source_files
    WHERE snapshot_id = ? AND detected_format = 'text'
      AND status IN ('discovered', 'failed', 'unsupported')
    ORDER BY section_key COLLATE NOCASE, relative_path COLLATE NOCASE
  `).all(snapshotId) as unknown as TextSourceFile[];

  const summary: TextFallbackImportSectionResult = {
    filesAttempted: 0, recordsImported: 0, unsupportedFiles: 0, failedFiles: 0
  };
  if (files.length === 0) return summary;

  const emitProgress = (phase: ImportProgressEvent['phase']) => reportImportProgress(onProgress, {
    sectionKey: 'text_fallback',
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
      summary.recordsImported += await importTextFile(database, snapshotId, archiveRoot, file);
    } catch {
      summary.failedFiles += 1;
    }
    emitProgress('progress');
  }
  emitProgress('completed');
  return summary;
}
