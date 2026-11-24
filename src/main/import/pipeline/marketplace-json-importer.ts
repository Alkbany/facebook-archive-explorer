import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { facebookDateToUtc } from '../../../shared/time/facebook-date';
import { normalizeSearchText } from '../../../shared/text/normalize';
import type { ImportProgressEvent, JsonImportSectionResult } from '../../../shared/archive/inspection';
import { clearSourceFileRecords } from './source-file-records';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';

interface MarketplaceSourceFile {
  id: number;
  relative_path: string;
  file_name: string;
  file_size_bytes: number | null;
}

interface MarketplacePlace {
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface ParsedMarketplaceListing {
  title: string;
  price: string | null;
  description: string | null;
  category: string | null;
  marketplace: string | null;
  seller: string | null;
  dateRaw: string;
  eventTimeUtc: string | null;
  listingKey: string;
  facebookId: string | null;
  place: MarketplacePlace;
  sourceIndex: number;
  payload: string;
}

interface ParsedMarketplaceFile {
  recognized: boolean;
  listings: ParsedMarketplaceListing[];
  invalidItems: number;
}

const MAX_MARKETPLACE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_MARKETPLACE_RECORD_BYTES = 5 * 1024 * 1024;
const MAX_MARKETPLACE_RECORDS = 10_000;
const MARKETPLACE_FILE_NAMES = ['items_sold.json', 'your_marketplace_items.json'] as const;

function cleanText(value: unknown, maximum = 20_000): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : null;
}

function timestampString(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const normalized = Math.trunc(value);
  return normalized >= 100_000_000 ? String(normalized) : null;
}

function normalizeListingTitle(value: string): string {
  return normalizeSearchText(value).replace(/\s+/gu, ' ').trim();
}

function listingPlace(value: unknown): MarketplacePlace {
  const item = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const coordinate = typeof item.coordinate === 'object' && item.coordinate !== null && !Array.isArray(item.coordinate)
    ? item.coordinate as Record<string, unknown>
    : {};
  return {
    name: cleanText(item.name),
    address: cleanText(item.address),
    latitude: typeof coordinate.latitude === 'number' && Number.isFinite(coordinate.latitude) &&
      coordinate.latitude >= -90 && coordinate.latitude <= 90 ? coordinate.latitude : null,
    longitude: typeof coordinate.longitude === 'number' && Number.isFinite(coordinate.longitude) &&
      coordinate.longitude >= -180 && coordinate.longitude <= 180 ? coordinate.longitude : null
  };
}

function collectLabelValues(value: Record<string, unknown>): Map<string, unknown> {
  const labels = new Map<string, unknown>();
  const rows = Array.isArray(value.label_values) ? value.label_values : [];
  const walk = (items: unknown, depth: number): void => {
    if (depth > 8 || !Array.isArray(items)) return;
    for (const raw of items) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const key = cleanText(row.label)?.toLocaleLowerCase();
      if (key) {
        const fieldValue = row.value ?? row.href ?? row.timestamp_value;
        if (fieldValue !== undefined && !labels.has(key)) labels.set(key, fieldValue);
      }
      walk(row.dict, depth + 1);
      walk(row.vec, depth + 1);
    }
  };
  walk(rows, 0);
  return labels;
}

function listingKey(title: string, dateUtc: string | null, filePath: string, sourceIndex: number, facebookId: string | null): string {
  // The clean items_selling_v2 and label/value detail file are the same
  // listing. Prefer their shared normalized title + UTC creation time so the
  // records merge even when only one of the two copies carries the Facebook ID.
  if (dateUtc) return normalizeListingTitle(title) + '|' + dateUtc;
  if (facebookId) return 'facebook-id:' + facebookId;
  return normalizeListingTitle(title) + '|unknown|' + filePath + '|' + sourceIndex;
}

function parsedListing(
  raw: Record<string, unknown>,
  sourceIndex: number,
  filePath: string,
  kind: 'items_selling_v2' | 'label_values'
): ParsedMarketplaceListing | null {
  let item: Record<string, unknown> = raw;
  let fbid = cleanText(raw.fbid);

  if (kind === 'label_values') {
    const labels = collectLabelValues(raw);
    item = {
      title: labels.get('title'),
      price: labels.get('price'),
      description: labels.get('description'),
      category: labels.get('category'),
      marketplace: labels.get('marketplace'),
      created_timestamp: labels.get('creation time') ?? labels.get('created time'),
      seller: labels.get('seller'),
      location: labels.get('location')
    };
  }

  const title = cleanText(item.title);
  const dateRaw = timestampString(item.created_timestamp);
  if (!title || !dateRaw) return null;

  const dateUtc = facebookDateToUtc(dateRaw);
  const place = listingPlace(item.location);
  const price = cleanText(item.price, 2_000);
  const description = cleanText(item.description);
  const category = cleanText(item.category, 500);
  const marketplace = cleanText(item.marketplace, 500);
  const seller = cleanText(item.seller, 500);
  const identity = listingKey(title, dateUtc, filePath, sourceIndex, fbid);

  const payload = {
    listing_key: identity,
    facebook_id: fbid,
    price,
    category,
    marketplace,
    seller,
    location: place,
    source_path: filePath,
    source_index: sourceIndex,
    source_payload: raw
  };

  return {
    title,
    price,
    description,
    category,
    marketplace,
    seller,
    dateRaw,
    eventTimeUtc: dateUtc,
    listingKey: identity,
    facebookId: fbid,
    place,
    sourceIndex,
    payload: JSON.stringify(payload)
  };
}

function parseMarketplaceFile(
  jsonText: string,
  fileName: string,
  relativePath: string
): ParsedMarketplaceFile {
  const parsed: unknown = JSON.parse(jsonText);
  let candidates: unknown[] | null = null;
  let kind: 'items_selling_v2' | 'label_values' = 'items_selling_v2';

  if (fileName.toLocaleLowerCase() === 'items_sold.json') {
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const collection = (parsed as Record<string, unknown>).items_selling_v2;
      if (Array.isArray(collection)) candidates = collection.slice(0, MAX_MARKETPLACE_RECORDS);
    }
  } else if (fileName.toLocaleLowerCase() === 'your_marketplace_items.json') {
    kind = 'label_values';
    if (Array.isArray(parsed)) candidates = parsed.slice(0, MAX_MARKETPLACE_RECORDS);
    else if (typeof parsed === 'object' && parsed !== null) candidates = [parsed];
  }

  if (!candidates) return { recognized: false, listings: [], invalidItems: 0 };
  const listings: ParsedMarketplaceListing[] = [];
  let invalidItems = 0;
  candidates.forEach((candidate, index) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      invalidItems += 1;
      return;
    }
    const item = parsedListing(candidate as Record<string, unknown>, index, relativePath, kind);
    if (item) listings.push(item);
    else invalidItems += 1;
  });

  return {
    recognized: true,
    listings,
    invalidItems
  };
}

function failure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) {
    return { code: error.code, message: 'A Marketplace listing file could not be safely read from the selected backup.' };
  }
  return { code: 'MARKETPLACE_IMPORT_FAILED', message: 'A Marketplace listing file could not be imported.' };
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
 * Imports reviewed Marketplace listing formats only. Conversations, saved
 * searches, surveys, and unknown listing variants remain available through
 * the generic JSON fallback. Seller details and raw source objects are
 * preserved in payload_json but excluded from searchable text.
 */
export async function importMarketplaceJsonSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<JsonImportSectionResult> {
  const files = database.prepare(
    'SELECT id, relative_path, file_name, file_size_bytes FROM source_files ' +
    "WHERE snapshot_id = ? AND section_key = 'marketplace' AND detected_format = 'json' " +
    'AND lower(file_name) IN (?, ?) ' +
    "AND (status IN ('discovered', 'failed', 'unsupported') OR " +
    "(status IN ('completed', 'empty') AND parser_key IN ('json_fallback', 'marketplace_tng_json'))) " +
    'ORDER BY relative_path COLLATE NOCASE'
  ).all(snapshotId, ...MARKETPLACE_FILE_NAMES) as unknown as MarketplaceSourceFile[];

  const summary: JsonImportSectionResult = {
    filesAttempted: 0, recordsImported: 0, unsupportedFiles: 0, failedFiles: 0
  };
  if (files.length === 0) return summary;

  const emitProgress = (phase: ImportProgressEvent['phase']) => reportImportProgress(onProgress, {
    sectionKey: 'marketplace',
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

    database.exec('SAVEPOINT marketplace_json_file');
    try {
      if (file.file_size_bytes !== null && file.file_size_bytes > MAX_MARKETPLACE_FILE_BYTES) {
        throw new ArchiveReadError('FILE_TOO_LARGE');
      }
      const jsonText = (await readArchiveUtf8File(
        archiveRoot, file.relative_path, MAX_MARKETPLACE_FILE_BYTES
      )).replace(/^\uFEFF/u, '');
      const parsed = parseMarketplaceFile(jsonText, file.file_name, file.relative_path);
      if (!parsed.recognized) throw new Error('MARKETPLACE_JSON_STRUCTURE_NOT_RECOGNIZED');

      clearSourceFileRecords(database, file.id);
      const timestamp = new Date().toISOString();
      const insert = database.prepare(
        'INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type, ' +
        'title, body_text, normalized_text, event_time_raw, event_time_utc, sensitivity, search_enabled, payload_json, created_at) ' +
        "VALUES (?, ?, ?, 'marketplace', 'listing', ?, ?, ?, ?, ?, 'personal', 1, ?, ?) " +
        'ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET ' +
        'section_key = excluded.section_key, record_type = excluded.record_type, ' +
        'title = excluded.title, body_text = excluded.body_text, normalized_text = excluded.normalized_text, ' +
        'event_time_raw = excluded.event_time_raw, event_time_utc = excluded.event_time_utc, ' +
        'sensitivity = excluded.sensitivity, search_enabled = excluded.search_enabled, ' +
        'payload_json = excluded.payload_json, created_at = excluded.created_at'
      );

      let imported = 0;
      for (const listing of parsed.listings) {
        if (Buffer.byteLength(listing.payload, 'utf8') > MAX_MARKETPLACE_RECORD_BYTES) {
          insertIssue(database, runId, file.id, 'MARKETPLACE_RECORD_TOO_LARGE',
            'A Marketplace listing exceeded the per-record safety limit and was skipped.',
            'warning', { sourceIndex: listing.sourceIndex });
          continue;
        }
        const body = [listing.price, listing.description, listing.category, listing.marketplace, listing.place.name, listing.place.address]
          .filter(Boolean).join('\n') || null;
        const normalized = normalizeSearchText([
          listing.title, listing.price, listing.description, listing.category,
          listing.marketplace, listing.place.name, listing.place.address
        ].filter(Boolean).join(' '));
        insert.run(
          snapshotId, file.id, listing.sourceIndex, listing.title, body,
          normalized, listing.dateRaw, listing.eventTimeUtc, listing.payload, timestamp
        );
        imported += 1;
      }

      if (parsed.invalidItems > 0) {
        insertIssue(database, runId, file.id, 'MARKETPLACE_ITEMS_WITHOUT_TITLE_OR_DATE',
          'Some Marketplace entries lacked a supported title or creation time.',
          'warning', { skippedItems: parsed.invalidItems });
      }
      const unsupportedOnly = imported === 0 && parsed.invalidItems > 0;
      const status = unsupportedOnly ? 'unsupported' : imported === 0 ? 'empty' : 'completed';
      database.prepare(
        "UPDATE source_files SET status = ?, parser_key = 'marketplace_tng_json', record_count = ?, safe_error_code = NULL, processed_at = ? " +
        'WHERE id = ? AND snapshot_id = ?'
      ).run(status, imported, timestamp, file.id, snapshotId);
      database.prepare(
        "UPDATE import_runs SET status = 'completed', finished_at = ?, files_processed = 1, records_imported = ?, errors_count = 0 WHERE id = ?"
      ).run(timestamp, imported, runId);
      database.exec('RELEASE marketplace_json_file');
      summary.recordsImported += imported;
      if (unsupportedOnly) summary.unsupportedFiles += 1;
    } catch (error) {
      database.exec('ROLLBACK TO marketplace_json_file');
      database.exec('RELEASE marketplace_json_file');
      const unsupported = error instanceof Error && error.message === 'MARKETPLACE_JSON_STRUCTURE_NOT_RECOGNIZED';
      const problem = unsupported
        ? { code: 'MARKETPLACE_JSON_STRUCTURE_NOT_RECOGNIZED', message: 'This Marketplace file uses a structure that is not yet supported; its original content remains available.' }
        : failure(error);
      const timestamp = new Date().toISOString();
      database.prepare(
        "UPDATE source_files SET status = ?, parser_key = ?, safe_error_code = ?, processed_at = ? WHERE id = ? AND snapshot_id = ?"
      ).run(unsupported ? 'unsupported' : 'failed', unsupported ? 'marketplace_tng_json' : null,
        problem.code, timestamp, file.id, snapshotId);
      insertIssue(database, runId, file.id, problem.code, problem.message, unsupported ? 'warning' : 'error');
      database.prepare(
        "UPDATE import_runs SET status = ?, finished_at = ?, files_processed = 1, errors_count = 1 WHERE id = ?"
      ).run(unsupported ? 'completed' : 'failed', timestamp, runId);
      if (unsupported) summary.unsupportedFiles += 1;
      else summary.failedFiles += 1;
    }
    emitProgress('progress');
  }

  emitProgress('completed');
  return summary;
}
