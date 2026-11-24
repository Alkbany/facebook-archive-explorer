import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { facebookDateToUtc } from '../../../shared/time/facebook-date';
import { normalizeSearchText } from '../../../shared/text/normalize';
import type { ImportProgressEvent, JsonImportSectionResult } from '../../../shared/archive/inspection';
import { clearSourceFileRecords } from './source-file-records';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';

interface EventSourceFile {
  id: number;
  relative_path: string;
  file_name: string;
  file_size_bytes: number | null;
}

interface EventPlace {
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface ParsedEventRecord {
  title: string;
  body: string | null;
  dateRaw: string | null;
  eventTimeUtc: string | null;
  eventKey: string;
  rsvp: 'joined' | 'interested' | 'declined' | 'invited' | 'hosted' | 'unknown';
  endDateRaw: string | null;
  responseTimeRaw: string | null;
  place: EventPlace;
  url: string | null;
  sourceIndex: number;
  payload: string;
}

interface ParsedEventFile {
  recognized: boolean;
  records: ParsedEventRecord[];
  invalidItems: number;
}

const MAX_EVENT_FILE_BYTES = 50 * 1024 * 1024;
const MAX_EVENT_RECORD_BYTES = 5 * 1024 * 1024;
const MAX_EVENT_RECORDS = 10_000;
const EVENT_FILE_ROLES: Readonly<Record<string, 'responses' | 'invitations' | 'hosted'>> = {
  'your_event_responses.json': 'responses',
  'event_invitations.json': 'invitations',
  'your_events.json': 'hosted',
  'events_you_hosted.json': 'hosted'
};

function text(value: unknown, maximum = 20_000): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : null;
}

function numericTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const integer = Math.trunc(value);
  if (integer < 100_000_000) return null;
  return String(integer);
}

function eventFromLabelValues(value: Record<string, unknown>): Record<string, unknown> | null {
  const labelValues = Array.isArray(value.label_values) ? value.label_values : null;
  if (!labelValues) return null;

  const event: Record<string, unknown> = {};
  const fields: Record<string, string> = {
    name: 'name',
    'start time': 'start_timestamp',
    'end time': 'end_timestamp',
    description: 'description',
    url: 'url',
    location: 'place'
  };

  const walk = (items: unknown, section: string | null): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const currentSection = text(row.title) ?? section;
      const label = text(row.label)?.toLocaleLowerCase() ?? '';
      const key = fields[label];
      // The Event host block can also contain a Name field. It is not the event title.
      if (key && (currentSection === null || currentSection.toLocaleLowerCase() === 'event')) {
        if (key === 'start_timestamp' || key === 'end_timestamp') {
          const stamp = row.timestamp_value;
          if (typeof stamp === 'number' && Number.isFinite(stamp)) event[key] = stamp;
        } else if (key === 'url') {
          event[key] = row.href ?? row.value;
        } else {
          event[key] = row.value;
        }
      }
      walk(row.dict, currentSection);
      walk(row.vec, currentSection);
    }
  };

  walk(labelValues, null);
  if (!text(event.name)) return null;
  return event;
}

function eventCandidate(
  value: unknown,
  rsvp: ParsedEventRecord['rsvp'],
  sourceIndex: number,
  filePath: string
): ParsedEventRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const original = value as Record<string, unknown>;
  const labelled = eventFromLabelValues(original);
  const event = labelled ?? original;

  const title = text(event.name) ?? text(event.title);
  if (!title) return null;

  const startRaw = numericTimestamp(event.start_timestamp);
  const endRaw = numericTimestamp(event.end_timestamp);
  const responseRaw = numericTimestamp(event.response_time);
  const placeValue = typeof event.place === 'object' && event.place !== null && !Array.isArray(event.place)
    ? event.place as Record<string, unknown>
    : {};
  const coordinate = typeof placeValue.coordinate === 'object' && placeValue.coordinate !== null
    ? placeValue.coordinate as Record<string, unknown>
    : {};
  const latitude = typeof coordinate.latitude === 'number' && Number.isFinite(coordinate.latitude)
    ? coordinate.latitude : null;
  const longitude = typeof coordinate.longitude === 'number' && Number.isFinite(coordinate.longitude)
    ? coordinate.longitude : null;
  const place: EventPlace = {
    name: text(placeValue.name),
    address: text(placeValue.address),
    latitude,
    longitude
  };
  const url = text(event.url) ?? text(event.href);
  const identity = startRaw
    ? title.toLocaleLowerCase().replace(/\\s+/gu, ' ') + '|' + (facebookDateToUtc(startRaw) ?? startRaw)
    : title.toLocaleLowerCase().replace(/\\s+/gu, ' ') + '|unknown|' + filePath + '|' + sourceIndex;
  const payload = {
    event_key: identity,
    rsvp,
    start_timestamp: startRaw,
    end_timestamp: endRaw,
    response_time: responseRaw,
    place,
    url,
    source_path: filePath,
    source_index: sourceIndex,
    source_payload: original
  };

  return {
    title,
    body: text(event.description),
    dateRaw: startRaw,
    eventTimeUtc: facebookDateToUtc(startRaw),
    eventKey: identity,
    rsvp,
    endDateRaw: endRaw,
    responseTimeRaw: responseRaw,
    place,
    url,
    sourceIndex,
    payload: JSON.stringify(payload)
  };
}

function collection(value: unknown, key: string): unknown[] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entry = Object.entries(value as Record<string, unknown>)
    .find(([name]) => name.toLocaleLowerCase() === key.toLocaleLowerCase());
  return Array.isArray(entry?.[1]) ? (entry?.[1] as unknown[]).slice(0, MAX_EVENT_RECORDS) : null;
}

function parseEventFile(jsonText: string, fileName: string, relativePath: string): ParsedEventFile {
  const role = EVENT_FILE_ROLES[fileName.toLocaleLowerCase()];
  if (!role) return { recognized: false, records: [], invalidItems: 0 };

  const parsed: unknown = JSON.parse(jsonText);
  const candidates: Array<{ value: unknown; rsvp: ParsedEventRecord['rsvp'] }> = [];
  let recognized = false;

  if (role === 'responses') {
    const rows = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).event_responses_v2
      : null;
    if (typeof rows === 'object' && rows !== null && !Array.isArray(rows)) {
      recognized = true;
      for (const [bucket, values] of Object.entries(rows as Record<string, unknown>)) {
        if (!Array.isArray(values)) continue;
        const rsvp = bucket === 'events_joined' ? 'joined'
          : bucket === 'events_interested' ? 'interested'
          : bucket === 'events_declined' ? 'declined' : 'unknown';
        values.slice(0, MAX_EVENT_RECORDS).forEach((value) => candidates.push({ value, rsvp }));
      }
    }
  } else if (role === 'invitations') {
    const rows = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).events_invited_v2
      : null;
    if (Array.isArray(rows)) {
      recognized = true;
      rows.slice(0, MAX_EVENT_RECORDS).forEach((value) => candidates.push({ value, rsvp: 'invited' }));
    }
  } else {
    const row = parsed as Record<string, unknown>;
    const rows = !Array.isArray(parsed) ? (
      (row.your_events_v2 ?? row.events_you_hosted_v2 ?? row.events_hosted_v2 ?? row.events_you_hosted)
    ) : parsed;
    if (Array.isArray(rows)) {
      recognized = true;
      rows.slice(0, MAX_EVENT_RECORDS).forEach((value) => candidates.push({ value, rsvp: 'hosted' }));
    } else if (!Array.isArray(parsed) && eventFromLabelValues(row)) {
      recognized = true;
      candidates.push({ value: parsed, rsvp: 'hosted' });
    }
  }

  if (!recognized) return { recognized: false, records: [], invalidItems: 0 };
  const records: ParsedEventRecord[] = [];
  let invalidItems = 0;
  candidates.forEach((candidate, index) => {
    const record = eventCandidate(candidate.value, candidate.rsvp, index, relativePath);
    if (record) records.push(record);
    else invalidItems += 1;
  });
  return { recognized: true, records, invalidItems };
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) {
    return { code: error.code, message: 'An Events source file could not be safely read from the selected backup.' };
  }
  return { code: 'EVENTS_IMPORT_FAILED', message: 'An Events source file could not be imported.' };
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
 * Imports the reviewed Accounts Center Events JSON variants. Unknown files and
 * unknown structures remain available to the generic fallback importer.
 * RSVP states are preserved (including declined and unanswered invitations).
 */
export async function importEventsJsonSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<JsonImportSectionResult> {
  const files = database.prepare(
    'SELECT id, relative_path, file_name, file_size_bytes FROM source_files ' +
    "WHERE snapshot_id = ? AND section_key = 'events' AND detected_format = 'json' " +
    'AND lower(file_name) IN (?, ?, ?, ?) ' +
    "AND (status IN ('discovered', 'failed', 'unsupported') OR " +
    "(status IN ('completed', 'empty') AND parser_key IN ('json_fallback', 'events_tng_json'))) " +
    'ORDER BY relative_path COLLATE NOCASE'
  ).all(
    snapshotId,
    'your_event_responses.json',
    'event_invitations.json',
    'your_events.json',
    'events_you_hosted.json'
  ) as unknown as EventSourceFile[];

  const summary: JsonImportSectionResult = {
    filesAttempted: 0, recordsImported: 0, unsupportedFiles: 0, failedFiles: 0
  };
  if (files.length === 0) return summary;

  const emitProgress = (phase: ImportProgressEvent['phase']) => reportImportProgress(onProgress, {
    sectionKey: 'events',
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

    database.exec('SAVEPOINT events_json_file');
    try {
      if (file.file_size_bytes !== null && file.file_size_bytes > MAX_EVENT_FILE_BYTES) {
        throw new ArchiveReadError('FILE_TOO_LARGE');
      }
      const jsonText = (await readArchiveUtf8File(
        archiveRoot, file.relative_path, MAX_EVENT_FILE_BYTES
      )).replace(/^\uFEFF/u, '');
      const parsed = parseEventFile(jsonText, file.file_name, file.relative_path);
      if (!parsed.recognized) {
        throw new Error('EVENTS_JSON_STRUCTURE_NOT_RECOGNIZED');
      }

      clearSourceFileRecords(database, file.id);
      const timestamp = new Date().toISOString();
      const insert = database.prepare(
        'INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type, ' +
        'title, body_text, normalized_text, event_time_raw, event_time_utc, sensitivity, search_enabled, payload_json, created_at) ' +
        "VALUES (?, ?, ?, 'events', 'event', ?, ?, ?, ?, ?, 'personal', 1, ?, ?) " +
        'ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET ' +
        'section_key = excluded.section_key, record_type = excluded.record_type, ' +
        'title = excluded.title, body_text = excluded.body_text, normalized_text = excluded.normalized_text, ' +
        'event_time_raw = excluded.event_time_raw, event_time_utc = excluded.event_time_utc, ' +
        'sensitivity = excluded.sensitivity, search_enabled = excluded.search_enabled, ' +
        'payload_json = excluded.payload_json, created_at = excluded.created_at'
      );

      let imported = 0;
      for (const record of parsed.records) {
        if (Buffer.byteLength(record.payload, 'utf8') > MAX_EVENT_RECORD_BYTES) {
          insertIssue(database, runId, file.id, 'EVENT_RECORD_TOO_LARGE',
            'An event item exceeded the per-record safety limit and was skipped.',
            'warning', { sourceIndex: record.sourceIndex });
          continue;
        }
        const normalized = normalizeSearchText([record.title, record.body, record.place.name, record.place.address, record.rsvp]
          .filter(Boolean).join(' '));
        insert.run(
          snapshotId, file.id, record.sourceIndex, record.title, record.body,
          normalized, record.dateRaw, record.eventTimeUtc, record.payload, timestamp
        );
        imported += 1;
      }

      if (parsed.invalidItems > 0) {
        insertIssue(database, runId, file.id, 'EVENT_ITEMS_WITHOUT_NAME',
          'Some event items did not contain a supported event name.',
          'warning', { skippedItems: parsed.invalidItems });
      }

      const unsupportedOnly = imported === 0 && parsed.invalidItems > 0;
      const finalStatus = unsupportedOnly ? 'unsupported' : imported === 0 ? 'empty' : 'completed';
      database.prepare(
        "UPDATE source_files SET status = ?, parser_key = 'events_tng_json', record_count = ?, safe_error_code = NULL, processed_at = ? " +
        'WHERE id = ? AND snapshot_id = ?'
      ).run(finalStatus, imported, timestamp, file.id, snapshotId);
      database.prepare(
        "UPDATE import_runs SET status = 'completed', finished_at = ?, files_processed = 1, " +
        'records_imported = ?, errors_count = 0 WHERE id = ?'
      ).run(timestamp, imported, runId);
      database.exec('RELEASE events_json_file');
      summary.recordsImported += imported;
      if (unsupportedOnly) summary.unsupportedFiles += 1;
    } catch (error) {
      database.exec('ROLLBACK TO events_json_file');
      database.exec('RELEASE events_json_file');
      const unsupported = error instanceof Error && error.message === 'EVENTS_JSON_STRUCTURE_NOT_RECOGNIZED';
      const failure = unsupported
        ? { code: 'EVENTS_JSON_STRUCTURE_NOT_RECOGNIZED', message: 'This Events file uses a structure that is not yet supported; its original content remains available.' }
        : safeFailure(error);
      const timestamp = new Date().toISOString();
      database.prepare(
        "UPDATE source_files SET status = ?, parser_key = ?, safe_error_code = ?, processed_at = ? " +
        'WHERE id = ? AND snapshot_id = ?'
      ).run(unsupported ? 'unsupported' : 'failed', unsupported ? 'events_tng_json' : null,
        failure.code, timestamp, file.id, snapshotId);
      insertIssue(database, runId, file.id, failure.code, failure.message, unsupported ? 'warning' : 'error');
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
