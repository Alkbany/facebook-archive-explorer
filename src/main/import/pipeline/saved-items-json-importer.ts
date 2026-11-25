import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { facebookDateToUtc } from '../../../shared/time/facebook-date';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { normalizeSafeExternalUrl } from '../../../shared/text/safe-external-url';
import type { ImportProgressEvent, JsonImportSectionResult } from '../../../shared/archive/inspection';
import { clearSourceFileRecords } from './source-file-records';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';

interface SavedItemFile {
  id: number;
  relative_path: string;
  file_name: string;
  file_size_bytes: number | null;
}

interface SavedContext {
  name: string | null;
  url: string | null;
  source: string | null;
}

interface SavedItem {
  title: string;
  timestampRaw: string | null;
  timestampUtc: string | null;
  contexts: SavedContext[];
  sourceIndex: number;
  payload: string;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_RECORD_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 20_000;
const MAX_CONTEXTS = 100;

function cleanText(value: unknown, maximum = 20_000): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : null;
}

function timestampString(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const stamp = Math.trunc(value);
  return stamp >= 100_000_000 ? String(stamp) : null;
}

function extractContexts(value: unknown): SavedContext[] {
  if (!Array.isArray(value)) return [];
  const contexts: SavedContext[] = [];
  for (const attachment of value.slice(0, MAX_CONTEXTS)) {
    if (typeof attachment !== 'object' || attachment === null || Array.isArray(attachment)) continue;
    const rows = (attachment as Record<string, unknown>).data;
    if (!Array.isArray(rows)) continue;
    for (const rowValue of rows.slice(0, MAX_CONTEXTS)) {
      if (typeof rowValue !== 'object' || rowValue === null || Array.isArray(rowValue)) continue;
      const external = (rowValue as Record<string, unknown>).external_context;
      if (typeof external !== 'object' || external === null || Array.isArray(external)) continue;
      const context = external as Record<string, unknown>;
      const item: SavedContext = {
        name: cleanText(context.name),
        url: normalizeSafeExternalUrl(context.url),
        source: cleanText(context.source, 500)
      };
      if (item.name || item.url || item.source) contexts.push(item);
      if (contexts.length >= MAX_CONTEXTS) return contexts;
    }
  }
  return contexts;
}

function parseSavedItems(jsonText: string): { recognized: boolean; items: SavedItem[]; invalid: number } {
  const parsed: unknown = JSON.parse(jsonText);
  const saves = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>).saves_v2
    : null;
  if (!Array.isArray(saves)) return { recognized: false, items: [], invalid: 0 };

  const items: SavedItem[] = [];
  let invalid = 0;
  saves.slice(0, MAX_ITEMS).forEach((raw, sourceIndex) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      invalid += 1;
      return;
    }
    const value = raw as Record<string, unknown>;
    const contexts = extractContexts(value.attachments);
    const title = cleanText(value.title) ?? contexts.find((item) => item.name)?.name ?? null;
    if (!title) {
      invalid += 1;
      return;
    }
    const timestampRaw = timestampString(value.timestamp);
    items.push({
      title,
      timestampRaw,
      timestampUtc: facebookDateToUtc(timestampRaw),
      contexts,
      sourceIndex,
      payload: JSON.stringify({
        timestamp: timestampRaw,
        contexts,
        source_index: sourceIndex,
        source_payload: value
      })
    });
  });
  return { recognized: true, items, invalid };
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

export async function importSavedItemsJsonSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<JsonImportSectionResult> {
  const files = database.prepare(
    'SELECT id, relative_path, file_name, file_size_bytes FROM source_files ' +
    "WHERE snapshot_id = ? AND section_key = 'saved_items_and_collections' AND detected_format = 'json' " +
    "AND lower(file_name) = 'your_saved_items.json' " +
    "AND (status IN ('discovered', 'failed', 'unsupported') OR " +
    "(status IN ('completed', 'empty') AND parser_key IN ('json_fallback', 'saved_items_tng_json'))) " +
    'ORDER BY relative_path COLLATE NOCASE'
  ).all(snapshotId) as unknown as SavedItemFile[];

  const result: JsonImportSectionResult = {
    filesAttempted: 0, recordsImported: 0, unsupportedFiles: 0, failedFiles: 0
  };
  if (files.length === 0) return result;

  const emit = (phase: ImportProgressEvent['phase']) => reportImportProgress(onProgress, {
    sectionKey: 'saved_items_and_collections',
    phase,
    filesCompleted: result.filesAttempted,
    filesTotal: files.length,
    recordsImported: result.recordsImported,
    unsupportedFiles: result.unsupportedFiles,
    failedFiles: result.failedFiles
  });
  emit('started');

  for (const file of files) {
    await waitIfImportPaused();
    result.filesAttempted += 1;
    const runId = randomUUID();
    const started = new Date().toISOString();
    database.prepare(
      "INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered) " +
      "VALUES (?, ?, 'import', 'running', ?, 1)"
    ).run(runId, snapshotId, started);
    database.prepare(
      "UPDATE source_files SET status = 'processing', safe_error_code = NULL WHERE id = ? AND snapshot_id = ?"
    ).run(file.id, snapshotId);

    database.exec('SAVEPOINT saved_items_file');
    try {
      if (file.file_size_bytes !== null && file.file_size_bytes > MAX_FILE_BYTES) {
        throw new ArchiveReadError('FILE_TOO_LARGE');
      }
      const jsonText = (await readArchiveUtf8File(archiveRoot, file.relative_path, MAX_FILE_BYTES)).replace(/^\uFEFF/u, '');
      const parsed = parseSavedItems(jsonText);
      if (!parsed.recognized) throw new Error('SAVED_ITEMS_JSON_STRUCTURE_NOT_RECOGNIZED');

      clearSourceFileRecords(database, file.id);
      const now = new Date().toISOString();
      const insert = database.prepare(
        'INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type, ' +
        'title, body_text, normalized_text, event_time_raw, event_time_utc, sensitivity, search_enabled, payload_json, created_at) ' +
        "VALUES (?, ?, ?, 'saved_items_and_collections', 'saved_item', ?, ?, ?, ?, ?, 'personal', 1, ?, ?) " +
        'ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET ' +
        'section_key = excluded.section_key, record_type = excluded.record_type, title = excluded.title, ' +
        'body_text = excluded.body_text, normalized_text = excluded.normalized_text, ' +
        'event_time_raw = excluded.event_time_raw, event_time_utc = excluded.event_time_utc, ' +
        'sensitivity = excluded.sensitivity, search_enabled = excluded.search_enabled, ' +
        'payload_json = excluded.payload_json, created_at = excluded.created_at'
      );
      let imported = 0;
      for (const item of parsed.items) {
        if (Buffer.byteLength(item.payload, 'utf8') > MAX_RECORD_BYTES) {
          insertIssue(database, runId, file.id, 'SAVED_ITEM_TOO_LARGE',
            'A Saved Item exceeded the per-record safety limit and was skipped.',
            'warning', { sourceIndex: item.sourceIndex });
          continue;
        }
        const names = item.contexts.flatMap((context) => [context.name, context.source]).filter(Boolean);
        const normalized = normalizeSearchText([item.title, ...names].join(' '));
        const body = names.length > 0 ? names.join('\n') : null;
        insert.run(snapshotId, file.id, item.sourceIndex, item.title, body, normalized,
          item.timestampRaw, item.timestampUtc, item.payload, now);
        imported += 1;
      }
      if (parsed.invalid > 0) {
        insertIssue(database, runId, file.id, 'SAVED_ITEMS_WITHOUT_TITLE',
          'Some saved entries did not contain a supported title or saved-item reference.',
          'warning', { skippedItems: parsed.invalid });
      }
      const unsupportedOnly = imported === 0 && parsed.invalid > 0;
      const status = unsupportedOnly ? 'unsupported' : imported === 0 ? 'empty' : 'completed';
      database.prepare(
        "UPDATE source_files SET status = ?, parser_key = 'saved_items_tng_json', record_count = ?, safe_error_code = NULL, processed_at = ? " +
        'WHERE id = ? AND snapshot_id = ?'
      ).run(status, imported, now, file.id, snapshotId);
      database.prepare(
        "UPDATE import_runs SET status = 'completed', finished_at = ?, files_processed = 1, records_imported = ?, errors_count = 0 WHERE id = ?"
      ).run(now, imported, runId);
      database.exec('RELEASE saved_items_file');
      result.recordsImported += imported;
      if (unsupportedOnly) result.unsupportedFiles += 1;
    } catch (error) {
      database.exec('ROLLBACK TO saved_items_file');
      database.exec('RELEASE saved_items_file');
      const unsupported = error instanceof Error && error.message === 'SAVED_ITEMS_JSON_STRUCTURE_NOT_RECOGNIZED';
      const code = unsupported ? 'SAVED_ITEMS_JSON_STRUCTURE_NOT_RECOGNIZED'
        : error instanceof ArchiveReadError ? error.code : 'SAVED_ITEMS_IMPORT_FAILED';
      const message = unsupported
        ? 'This Saved Items file uses a structure that is not yet supported; its original content remains available.'
        : error instanceof ArchiveReadError
          ? 'The Saved Items source file could not be safely read from the selected backup.'
          : 'The Saved Items source file could not be imported.';
      const now = new Date().toISOString();
      database.prepare(
        "UPDATE source_files SET status = ?, parser_key = ?, safe_error_code = ?, processed_at = ? WHERE id = ? AND snapshot_id = ?"
      ).run(unsupported ? 'unsupported' : 'failed', unsupported ? 'saved_items_tng_json' : null, code, now, file.id, snapshotId);
      insertIssue(database, runId, file.id, code, message, unsupported ? 'warning' : 'error');
      database.prepare(
        "UPDATE import_runs SET status = ?, finished_at = ?, files_processed = 1, errors_count = 1 WHERE id = ?"
      ).run(unsupported ? 'completed' : 'failed', now, runId);
      if (unsupported) result.unsupportedFiles += 1;
      else result.failedFiles += 1;
    }
    emit('progress');
  }
  emit('completed');
  return result;
}
