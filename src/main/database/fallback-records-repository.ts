import type { DatabaseSync } from 'node:sqlite';
import type {
  FallbackArchiveRecord,
  FallbackArchiveRecordsPage,
  FallbackArchiveSectionSummary
} from '../../shared/archive/inspection';

const PAGE_SIZE = 40;
const FALLBACK_RECORD_TYPES = ['html_item', 'json_item'] as const;

function assertSectionKey(sectionKey: string): void {
  if (typeof sectionKey !== 'string' || !/^[a-z0-9_]{1,80}$/u.test(sectionKey)) {
    throw new Error('Choose a valid archive section.');
  }
}

/** Lists sections that contain records preserved by the generic HTML/JSON fallbacks. */
export function listFallbackRecordSections(
  database: DatabaseSync,
  snapshotId: string
): FallbackArchiveSectionSummary[] {
  if (typeof snapshotId !== 'string' || !snapshotId.trim()) {
    throw new Error('A selected backup is required to list imported fallback records.');
  }

  return database.prepare(
    'SELECT section_key AS sectionKey, COUNT(*) AS recordCount, ' +
    "CASE MAX(CASE WHEN sensitivity = 'sensitive' THEN 3 WHEN sensitivity = 'personal' THEN 2 ELSE 1 END) " +
    "WHEN 3 THEN 'sensitive' WHEN 2 THEN 'personal' ELSE 'standard' END AS sensitivity " +
    'FROM records WHERE snapshot_id = ? AND record_type IN (?, ?) ' +
    'GROUP BY section_key ORDER BY section_key COLLATE NOCASE'
  ).all(snapshotId, ...FALLBACK_RECORD_TYPES) as unknown as FallbackArchiveSectionSummary[];
}

/** Returns one bounded page from a single selected section, including source provenance. */
export function listFallbackArchiveRecords(
  database: DatabaseSync,
  snapshotId: string,
  sectionKey: string,
  requestedPage = 1
): FallbackArchiveRecordsPage {
  if (typeof snapshotId !== 'string' || !snapshotId.trim()) {
    throw new Error('A selected backup is required to browse imported fallback records.');
  }
  assertSectionKey(sectionKey);
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    throw new Error('The fallback record page number is invalid.');
  }

  const count = database.prepare(
    'SELECT COUNT(*) AS total FROM records ' +
    'WHERE snapshot_id = ? AND section_key = ? AND record_type IN (?, ?)'
  ).get(snapshotId, sectionKey, ...FALLBACK_RECORD_TYPES) as { total: number };

  const total = count.total;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const records = database.prepare(
    'SELECT records.id AS id, records.section_key AS sectionKey, ' +
    'records.record_type AS recordType, records.title AS title, ' +
    'records.body_text AS body, records.event_time_raw AS dateRaw, ' +
    'source.relative_path AS sourcePath, records.source_record_index AS sourceRecordIndex, ' +
    'records.sensitivity AS sensitivity, ' +
    'substr(records.payload_json, 1, 20000) AS payloadPreview, ' +
    'length(records.payload_json) > 20000 AS payloadTruncated ' +
    'FROM records INNER JOIN source_files AS source ' +
    'ON source.id = records.source_file_id AND source.snapshot_id = records.snapshot_id ' +
    'WHERE records.snapshot_id = ? AND records.section_key = ? AND records.record_type IN (?, ?) ' +
    'ORDER BY source.relative_path COLLATE NOCASE, records.source_record_index ASC ' +
    'LIMIT ? OFFSET ?'
  ).all(snapshotId, sectionKey, ...FALLBACK_RECORD_TYPES, PAGE_SIZE, (page - 1) * PAGE_SIZE) as unknown as Array<Omit<FallbackArchiveRecord, 'payloadTruncated'> & { payloadTruncated: number }>;
  const records: FallbackArchiveRecord[] = rows.map((record) => ({
    ...record,
    payloadTruncated: record.payloadTruncated !== 0
  }));

  return { records, total, page, pageSize: PAGE_SIZE };
}
