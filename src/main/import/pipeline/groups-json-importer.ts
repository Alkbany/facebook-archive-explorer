import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { clearSourceFileRecords } from './source-file-records';
import type { ImportProgressEvent, JsonImportSectionResult } from '../../../shared/archive/inspection';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';

interface GroupsSourceFile {
  id: number;
  relative_path: string;
  file_name: string;
  file_size_bytes: number | null;
}

interface GroupRecord {
  title: string | null;
  body: string | null;
  dateRaw: string | null;
  payload: string;
  sourceIndex: number;
}

const MAX_GROUPS_FILE_BYTES = 50 * 1024 * 1024;
const MAX_GROUPS_RECORD_BYTES = 5 * 1024 * 1024;
const MAX_GROUPS_RECORDS = 5000;

const GROUP_FILE_SCHEMAS: Readonly<Record<string, string>> = {
  'group_posts_and_comments.json': 'group_posts_v2',
  'your_comments_in_groups.json': 'group_comments_v2',
  'your_group_membership_activity.json': 'groups_joined_v2'
};

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 20000) : null;
}

function collectionFor(value: unknown, key: string): unknown[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const found = Object.entries(value as Record<string, unknown>)
    .find(([name]) => name.toLocaleLowerCase() === key)?.[1];
  return Array.isArray(found) ? found.slice(0, MAX_GROUPS_RECORDS) : [];
}

function parseGroupItem(value: unknown, schema: string, sourceIndex: number): GroupRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const title = cleanString(row.title);
  const data = Array.isArray(row.data) ? row.data : [];
  const textParts: string[] = [];
  const addText = (candidate: unknown) => {
    const text = cleanString(candidate);
    if (text && !textParts.includes(text)) textParts.push(text);
  };

  if (schema === 'group_posts_v2') {
    for (const entry of data) {
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        addText((entry as Record<string, unknown>).post);
      }
    }
  } else if (schema === 'group_comments_v2') {
    for (const entry of data) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      const comment = (entry as Record<string, unknown>).comment;
      if (typeof comment !== 'object' || comment === null || Array.isArray(comment)) continue;
      addText((comment as Record<string, unknown>).comment);
      addText((comment as Record<string, unknown>).group);
    }
  } else if (schema === 'groups_joined_v2') {
    for (const entry of data) {
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        addText((entry as Record<string, unknown>).name);
      }
    }
  }

  const body = textParts.join('\n') || null;
  if (!title && !body) return null;
  const timestamp = row.timestamp;
  const dateRaw = typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? String(timestamp)
    : cleanString(timestamp);
  return {
    title,
    body,
    dateRaw,
    payload: JSON.stringify(value),
    sourceIndex
  };
}

function parseGroupsFile(jsonText: string, fileName: string): { records: GroupRecord[]; invalidItems: number } {
  const schema = GROUP_FILE_SCHEMAS[fileName.toLocaleLowerCase()];
  if (!schema) return { records: [], invalidItems: 0 };
  const parsed: unknown = JSON.parse(jsonText);
  const items = collectionFor(parsed, schema);
  const records: GroupRecord[] = [];
  let invalidItems = 0;
  items.forEach((item, index) => {
    const record = parseGroupItem(item, schema, index);
    if (record) records.push(record);
    else invalidItems += 1;
  });
  return { records, invalidItems };
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) {
    return { code: error.code, message: 'The Groups source file could not be safely read from the selected backup.' };
  }
  return { code: 'GROUPS_IMPORT_FAILED', message: 'The Groups source file could not be imported.' };
}

function insertIssue(
  database: DatabaseSync,
  runId: string,
  sourceFileId: number,
  code: string,
  message: string,
  severity: 'warning' | 'error',
  context: Record<string, number | string> = {}
): void {
  database.prepare(
    'INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(runId, sourceFileId, severity, code, message, JSON.stringify(context), new Date().toISOString());
}

/**
 * Imports the three observed Accounts Center Groups JSON files. Unsupported
 * structures remain eligible for the schema-agnostic JSON fallback.
 */
export async function importGroupsJsonSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<JsonImportSectionResult> {
  const files = database.prepare(
    'SELECT id, relative_path, file_name, file_size_bytes FROM source_files ' +
    "WHERE snapshot_id = ? AND section_key = 'groups' AND detected_format = 'json' " +
    'AND lower(file_name) IN (?, ?, ?) ' +
    "AND lower(relative_path) LIKE 'your_facebook_activity/groups/%' " +
    "AND status IN ('discovered', 'failed', 'unsupported') ORDER BY relative_path COLLATE NOCASE"
  ).all(
    snapshotId,
    'group_posts_and_comments.json',
    'your_comments_in_groups.json',
    'your_group_membership_activity.json'
  ) as unknown as GroupsSourceFile[];

  const summary: JsonImportSectionResult = {
    filesAttempted: 0, recordsImported: 0, unsupportedFiles: 0, failedFiles: 0
  };
  if (files.length === 0) return summary;

  const emitProgress = (phase: ImportProgressEvent['phase']) => reportImportProgress(onProgress, {
    sectionKey: 'groups',
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
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    database.prepare(
      "INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered) " +
      "VALUES (?, ?, 'import', 'running', ?, 1)"
    ).run(runId, snapshotId, startedAt);
    database.prepare(
      "UPDATE source_files SET status = 'processing', safe_error_code = NULL WHERE id = ? AND snapshot_id = ?"
    ).run(file.id, snapshotId);

    database.exec('SAVEPOINT groups_json_file');
    try {
      if (file.file_size_bytes !== null && file.file_size_bytes > MAX_GROUPS_FILE_BYTES) {
        throw new ArchiveReadError('FILE_TOO_LARGE');
      }
      const jsonText = (await readArchiveUtf8File(
        archiveRoot, file.relative_path, MAX_GROUPS_FILE_BYTES
      )).replace(/^\uFEFF/u, '');
      const parsed = parseGroupsFile(jsonText, file.file_name);
      clearSourceFileRecords(database, file.id);
      const timestamp = new Date().toISOString();
      const insert = database.prepare(
        'INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type, ' +
        'title, body_text, normalized_text, event_time_raw, event_time_utc, sensitivity, search_enabled, payload_json, created_at) ' +
        "VALUES (?, ?, ?, 'groups', 'json_item', ?, ?, ?, ?, NULL, 'personal', 1, ?, ?) " +
        'ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET ' +
        'title = excluded.title, body_text = excluded.body_text, normalized_text = excluded.normalized_text, ' +
        'event_time_raw = excluded.event_time_raw, event_time_utc = NULL, sensitivity = excluded.sensitivity, ' +
        'search_enabled = excluded.search_enabled, payload_json = excluded.payload_json, created_at = excluded.created_at'
      );

      let imported = 0;
      for (const record of parsed.records) {
        if (Buffer.byteLength(record.payload, 'utf8') > MAX_GROUPS_RECORD_BYTES) {
          insertIssue(database, runId, file.id, 'GROUP_RECORD_TOO_LARGE',
            'A group activity item exceeded the per-record safety limit and was skipped.',
            'warning', { sourceIndex: record.sourceIndex });
          continue;
        }
        const normalized = normalizeSearchText([record.title, record.body].filter(Boolean).join(' '));
        insert.run(
          snapshotId, file.id, record.sourceIndex, record.title, record.body,
          normalized, record.dateRaw, record.payload, timestamp
        );
        imported += 1;
      }

      if (parsed.invalidItems > 0) {
        insertIssue(database, runId, file.id, 'GROUP_ITEMS_WITHOUT_TEXT',
          'Some group activity items did not contain supported text fields.',
          'warning', { skippedItems: parsed.invalidItems });
      }

      const unsupported = imported === 0;
      database.prepare(
        'UPDATE source_files SET status = ?, record_count = ?, safe_error_code = ?, processed_at = ? ' +
        'WHERE id = ? AND snapshot_id = ?'
      ).run(
        unsupported ? 'unsupported' : 'completed',
        imported,
        unsupported ? 'GROUP_JSON_STRUCTURE_NOT_RECOGNIZED' : null,
        timestamp,
        file.id,
        snapshotId
      );
      database.prepare(
        "UPDATE import_runs SET status = 'completed', finished_at = ?, files_processed = 1, " +
        'records_imported = ?, errors_count = ? WHERE id = ?'
      ).run(timestamp, imported, unsupported ? 1 : parsed.invalidItems, runId);
      database.exec('RELEASE groups_json_file');
      summary.recordsImported += imported;
      if (unsupported) summary.unsupportedFiles += 1;
    } catch (error) {
      database.exec('ROLLBACK TO groups_json_file');
      database.exec('RELEASE groups_json_file');
      const failure = safeFailure(error);
      const timestamp = new Date().toISOString();
      database.prepare(
        "UPDATE source_files SET status = 'failed', safe_error_code = ?, processed_at = ? " +
        'WHERE id = ? AND snapshot_id = ?'
      ).run(failure.code, timestamp, file.id, snapshotId);
      insertIssue(database, runId, file.id, failure.code, failure.message, 'error');
      database.prepare(
        "UPDATE import_runs SET status = 'failed', finished_at = ?, files_processed = 1, errors_count = 1 WHERE id = ?"
      ).run(timestamp, runId);
      summary.failedFiles += 1;
    }
    emitProgress('progress');
  }

  emitProgress('completed');
  return summary;
}
