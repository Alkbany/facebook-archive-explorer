import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ImportProgressEvent } from '../../../shared/archive/inspection';
import { getArchiveSection } from '../../../shared/archive/section-registry';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';

interface JsonSourceFile {
  id: number;
  relative_path: string;
  file_size_bytes: number | null;
  section_key: string;
}

interface JsonItem {
  key: string;
  value: unknown;
}

export interface JsonImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

const MAX_JSON_FILE_BYTES = 50 * 1024 * 1024;
const MAX_JSON_RECORD_BYTES = 5 * 1024 * 1024;
const MAX_JSON_RECORDS_PER_FILE = 5000;
const MAX_TEXT_FIELDS = 40;
const MAX_TEXT_LENGTH = 20_000;

const TITLE_KEYS = new Set(['title', 'name', 'label', 'subject', 'category', 'action', 'type']);
const PRIVATE_KEYS = new Set([
  'id', 'uuid', 'url', 'uri', 'email', 'phone', 'mobile', 'token',
  'password', 'username', 'ip', 'address', 'latitude', 'longitude', 'location', 'street', 'postal_code', 'zip', 'coordinates'
]);
const RAW_DATE_KEYS = new Set(['date', 'time', 'timestamp', 'created_time', 'created_at', 'updated_time', 'updated_at', 'event_time', 'creation_time', 'last_updated']);

function isPrivateFieldKey(key: string): boolean {
  const normalized = key.toLocaleLowerCase();
  return PRIVATE_KEYS.has(normalized) || /(?:^|_)(?:id|uuid|url|uri|email|phone|mobile|token|password|secret|username|ip|address|latitude|longitude)(?:_|$)/u.test(normalized);
}

function objectEntries(value: unknown): Array<[string, unknown]> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return Object.entries(value as Record<string, unknown>);
}

/** Splits only the root collection; nested values are preserved untouched in each record payload. */
function toJsonItems(value: unknown): JsonItem[] {
  if (Array.isArray(value)) {
    return value.slice(0, MAX_JSON_RECORDS_PER_FILE)
      .map((item, index) => ({ key: '[' + index + ']', value: item }));
  }
  const entries = objectEntries(value);
  if (!entries) return [{ key: 'value', value }];

  const items: JsonItem[] = [];
  for (const [key, child] of entries) {
    if (Array.isArray(child)) {
      for (let index = 0; index < child.length && items.length < MAX_JSON_RECORDS_PER_FILE; index += 1) {
        items.push({ key: key + '[' + index + ']', value: child[index] });
      }
    } else if (items.length < MAX_JSON_RECORDS_PER_FILE) {
      items.push({ key, value: child });
    }
    if (items.length >= MAX_JSON_RECORDS_PER_FILE) break;
  }
  return items.slice(0, MAX_JSON_RECORDS_PER_FILE);
}

function findTitle(value: unknown): string | null {
  const entries = objectEntries(value);
  if (!entries) return null;
  for (const [key, child] of entries) {
    if (TITLE_KEYS.has(key.toLocaleLowerCase()) && typeof child === 'string' && child.trim()) {
      return child.trim().slice(0, 200);
    }
  }
  return null;
}

function collectText(value: unknown, output: string[], depth = 0, key = ''): void {
  const normalizedKey = key.toLocaleLowerCase();
  if (output.length >= MAX_TEXT_FIELDS || depth > 8 || isPrivateFieldKey(normalizedKey) ||
      TITLE_KEYS.has(normalizedKey) || RAW_DATE_KEYS.has(normalizedKey)) return;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text && !/^https?:\/\//iu.test(text)) output.push(text);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return;
  if (Array.isArray(value)) {
    for (const child of value) collectText(child, output, depth + 1, key);
    return;
  }
  const entries = objectEntries(value);
  if (!entries) return;
  for (const [childKey, child] of entries) {
    const childKeyNormalized = childKey.toLocaleLowerCase();
    if (isPrivateFieldKey(childKeyNormalized) || TITLE_KEYS.has(childKeyNormalized) || RAW_DATE_KEYS.has(childKeyNormalized)) continue;
    if (typeof child === 'string') collectText(child, output, depth + 1, childKeyNormalized);
    else if (Array.isArray(child) || (typeof child === 'object' && child !== null)) {
      collectText(child, output, depth + 1, childKeyNormalized);
    }
  }
}

/** Converts only unambiguous epoch values or ISO timestamps with an explicit timezone. */
function parseKnownUtcTimestamp(rawTimestamp: string | null): string | null {
  if (!rawTimestamp) return null;
  const value = rawTimestamp.trim();
  if (!value) return null;

  if (/^\d+(?:\.\d+)?$/u.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const milliseconds = numeric >= 946_684_800_000 && numeric <= 4_102_444_800_000
      ? numeric
      : numeric >= 946_684_800 && numeric <= 4_102_444_800
        ? numeric * 1000
        : Number.NaN;
    if (!Number.isFinite(milliseconds)) return null;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  // Facebook's locale-formatted dates often omit their timezone; leave those raw.
  if (!/[Tt].*(?:Z|[+-]\d{2}:?\d{2})$/iu.test(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString();
}

function findRawTimestamp(value: unknown, depth = 0): string | null {
  if (depth > 8) return null;
  const entries = objectEntries(value);
  if (entries) {
    for (const [key, child] of entries) {
      const normalizedKey = key.toLocaleLowerCase();
      if (['date', 'time', 'timestamp', 'created_time', 'created_at', 'updated_time', 'updated_at', 'event_time', 'creation_time', 'last_updated'].includes(normalizedKey)) {
        if (typeof child === 'string' && child.trim()) return child.trim().slice(0, 500);
        if (typeof child === 'number' && Number.isFinite(child)) return String(child);
      }
    }
    for (const [, child] of entries) {
      const nested = findRawTimestamp(child, depth + 1);
      if (nested !== null) return nested;
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      const nested = findRawTimestamp(child, depth + 1);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function buildBody(value: unknown): string | null {
  const fields: string[] = [];
  collectText(value, fields);
  const body = fields.join('\n').slice(0, MAX_TEXT_LENGTH);
  return body || null;
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) {
    return { code: error.code, message: 'The JSON source file could not be safely read from the selected archive.' };
  }
  return { code: 'JSON_PARSE_FAILED', message: 'The JSON source file is not valid JSON and could not be imported.' };
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

async function importJsonFile(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  file: JsonSourceFile
): Promise<{ records: number; unsupported: boolean }> {
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

  database.exec('SAVEPOINT json_file_import');
  try {
    if (file.file_size_bytes !== null && file.file_size_bytes > MAX_JSON_FILE_BYTES) {
      throw new ArchiveReadError('FILE_TOO_LARGE');
    }
    const jsonText = (await readArchiveUtf8File(archiveRoot, file.relative_path, MAX_JSON_FILE_BYTES)).replace(/^\uFEFF/u, '');
    const parsed: unknown = JSON.parse(jsonText);
    const items = toJsonItems(parsed);
    const section = getArchiveSection(file.section_key);
    // Unknown sections fail closed: they remain out of full-text search until reviewed.
    const sensitivity = section?.sensitivity ?? 'sensitive';
    const searchEnabled = sensitivity === 'sensitive' ? 0 : 1;
    const timestamp = new Date().toISOString();
    const insertRecord = database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, event_time_raw, event_time_utc,
        sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, ?, ?, 'json_item', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET
        section_key = excluded.section_key,
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

    let imported = 0;
    let oversizedItems = 0;
    for (const [index, item] of items.entries()) {
      const payload = JSON.stringify({ source_key: item.key, value: item.value });
      if (Buffer.byteLength(payload, 'utf8') > MAX_JSON_RECORD_BYTES) {
        oversizedItems += 1;
        continue;
      }
      const title = findTitle(item.value) ?? (item.key === 'value' ? file.relative_path : item.key);
      const body = buildBody(item.value);
      const normalized = searchEnabled ? normalizeSearchText([title, body].filter(Boolean).join(' ')) : null;
      const eventTimeRaw = findRawTimestamp(item.value);
      const eventTimeUtc = parseKnownUtcTimestamp(eventTimeRaw);
      insertRecord.run(
        snapshotId, file.id, index, file.section_key, title, body,
        normalized, eventTimeRaw, eventTimeUtc, sensitivity, searchEnabled, payload, timestamp
      );
      imported += 1;
    }

    const unsupported = imported === 0 && items.length > 0;
    if (oversizedItems > 0) {
      insertIssue(database, runId, file.id, 'warning', 'JSON_ITEMS_TOO_LARGE',
        'Some JSON entries exceeded the per-record safety limit and were not indexed.',
        { skippedItems: oversizedItems });
    }
    if (items.length >= MAX_JSON_RECORDS_PER_FILE) {
      insertIssue(database, runId, file.id, 'warning', 'JSON_RECORD_LIMIT_REACHED',
        'The JSON file exceeded the maximum number of entries indexed from one file.',
        { maximumRecords: MAX_JSON_RECORDS_PER_FILE });
    }
    if (items.length === 0) {
      database.prepare(`
        UPDATE source_files SET status = 'empty', record_count = 0, safe_error_code = NULL, processed_at = ?
        WHERE id = ? AND snapshot_id = ?
      `).run(timestamp, file.id, snapshotId);
    } else {
      database.prepare(`
        UPDATE source_files SET status = ?, record_count = ?, safe_error_code = ?, processed_at = ?
        WHERE id = ? AND snapshot_id = ?
      `).run(unsupported ? 'unsupported' : 'completed', imported,
        unsupported ? 'JSON_ITEMS_TOO_LARGE' : null, timestamp, file.id, snapshotId);
    }
    database.prepare(`
      UPDATE import_runs SET status = 'completed', finished_at = ?, files_processed = 1,
        records_imported = ?, errors_count = ? WHERE id = ?
    `).run(timestamp, imported, oversizedItems, runId);
    database.exec('RELEASE json_file_import');
    return { records: imported, unsupported };
  } catch (error) {
    database.exec('ROLLBACK TO json_file_import');
    database.exec('RELEASE json_file_import');
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
    throw new Error('A JSON file could not be imported. See the local import report.');
  }
}

/** Generic, schema-agnostic JSON fallback. Raw values are preserved locally; unknown sections are not searchable. */
export async function importJsonFilesSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<JsonImportSectionResult> {
  const files = database.prepare(`
    SELECT id, relative_path, file_size_bytes, section_key
    FROM source_files
    WHERE snapshot_id = ? AND detected_format = 'json'
      AND status IN ('discovered', 'failed', 'unsupported')
    ORDER BY section_key COLLATE NOCASE, relative_path COLLATE NOCASE
  `).all(snapshotId) as unknown as JsonSourceFile[];

  const summary: JsonImportSectionResult = {
    filesAttempted: 0, recordsImported: 0, unsupportedFiles: 0, failedFiles: 0
  };
  if (files.length === 0) return summary;

  const emitProgress = (phase: ImportProgressEvent['phase']) => reportImportProgress(onProgress, {
    sectionKey: 'json',
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
      const result = await importJsonFile(database, snapshotId, archiveRoot, file);
      summary.recordsImported += result.records;
      if (result.unsupported) summary.unsupportedFiles += 1;
    } catch {
      summary.failedFiles += 1;
    }
    emitProgress('progress');
  }
  emitProgress('completed');
  return summary;
}
