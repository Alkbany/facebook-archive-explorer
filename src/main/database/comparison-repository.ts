import type { DatabaseSync } from 'node:sqlite';
import type { ArchiveComparisonReport, ArchiveComparisonSection } from '../../shared/archive/comparison';
import type {
  ArchiveComparisonChangeKind,
  ArchiveComparisonChangesPage
} from '../../shared/archive/comparison';

interface SnapshotRow {
  id: string; accountId: string; backupName: string; createdAt: string; files: number; records: number;
}
interface ChangeRow { sectionKey: string; changeKind: 'added' | 'removed' | 'changed'; count: number; }

function getSnapshot(database: DatabaseSync, snapshotId: string): SnapshotRow | undefined {
  return database.prepare(`
    SELECT snapshots.id AS id, snapshots.account_id AS accountId,
      snapshots.display_name AS backupName, snapshots.created_at AS createdAt,
      (SELECT COUNT(*) FROM source_files WHERE snapshot_id = snapshots.id) AS files,
      (SELECT COUNT(*) FROM records WHERE snapshot_id = snapshots.id) AS records
    FROM archive_snapshots AS snapshots WHERE snapshots.id = ?
  `).get(snapshotId) as SnapshotRow | undefined;
}

/** Compares imported records by section, source-relative file path, and original card position. */
export function compareArchiveSnapshots(
  database: DatabaseSync, baselineSnapshotId: string, comparedSnapshotId: string
): ArchiveComparisonReport {
  if (!baselineSnapshotId || !comparedSnapshotId || baselineSnapshotId === comparedSnapshotId) {
    throw new Error('Choose two different backup snapshots to compare.');
  }
  const baseline = getSnapshot(database, baselineSnapshotId);
  const compared = getSnapshot(database, comparedSnapshotId);
  if (!baseline || !compared) throw new Error('One of the selected backups no longer exists.');
  if (baseline.accountId !== compared.accountId) {
    throw new Error('Only backups belonging to the same Facebook account can be compared.');
  }

  const rows = database.prepare(`
    WITH baseline_records AS (
      SELECT source.relative_path AS sourcePath, records.section_key AS sectionKey,
        records.source_record_index AS sourceCardIndex, records.record_type AS recordType,
        records.title AS title, records.body_text AS bodyText,
        records.normalized_text AS normalizedText, records.event_time_raw AS dateRaw,
        records.payload_json AS payloadJson
      FROM records INNER JOIN source_files AS source
        ON source.id = records.source_file_id AND source.snapshot_id = records.snapshot_id
      WHERE records.snapshot_id = ?
    ),
    compared_records AS (
      SELECT source.relative_path AS sourcePath, records.section_key AS sectionKey,
        records.source_record_index AS sourceCardIndex, records.record_type AS recordType,
        records.title AS title, records.body_text AS bodyText,
        records.normalized_text AS normalizedText, records.event_time_raw AS dateRaw,
        records.payload_json AS payloadJson
      FROM records INNER JOIN source_files AS source
        ON source.id = records.source_file_id AND source.snapshot_id = records.snapshot_id
      WHERE records.snapshot_id = ?
    ),
    changes AS (
      SELECT current.sectionKey, 'added' AS changeKind
      FROM compared_records AS current LEFT JOIN baseline_records AS previous
        ON previous.sectionKey = current.sectionKey AND previous.sourcePath = current.sourcePath
        AND previous.sourceCardIndex = current.sourceCardIndex
      WHERE previous.sourceCardIndex IS NULL
      UNION ALL
      SELECT previous.sectionKey, 'removed' AS changeKind
      FROM baseline_records AS previous LEFT JOIN compared_records AS current
        ON current.sectionKey = previous.sectionKey AND current.sourcePath = previous.sourcePath
        AND current.sourceCardIndex = previous.sourceCardIndex
      WHERE current.sourceCardIndex IS NULL
      UNION ALL
      SELECT current.sectionKey, 'changed' AS changeKind
      FROM compared_records AS current INNER JOIN baseline_records AS previous
        ON previous.sectionKey = current.sectionKey AND previous.sourcePath = current.sourcePath
        AND previous.sourceCardIndex = current.sourceCardIndex
      WHERE current.recordType IS NOT previous.recordType
        OR current.title IS NOT previous.title
        OR current.bodyText IS NOT previous.bodyText
        OR current.normalizedText IS NOT previous.normalizedText
        OR current.dateRaw IS NOT previous.dateRaw
        OR current.payloadJson IS NOT previous.payloadJson
    )
    SELECT sectionKey, changeKind, COUNT(*) AS count
    FROM changes GROUP BY sectionKey, changeKind
    ORDER BY sectionKey COLLATE NOCASE, changeKind
  `).all(baselineSnapshotId, comparedSnapshotId) as unknown as ChangeRow[];

  const bySection = new Map<string, ArchiveComparisonSection>();
  for (const row of rows) {
    const item = bySection.get(row.sectionKey) ?? { sectionKey: row.sectionKey, added: 0, removed: 0, changed: 0 };
    item[row.changeKind] = row.count;
    bySection.set(row.sectionKey, item);
  }
  const sections = [...bySection.values()];
  const added = sections.reduce((sum, section) => sum + section.added, 0);
  const removed = sections.reduce((sum, section) => sum + section.removed, 0);
  const changed = sections.reduce((sum, section) => sum + section.changed, 0);
  return {
    baseline: { id: baseline.id, backupName: baseline.backupName, createdAt: baseline.createdAt, files: baseline.files, records: baseline.records },
    compared: { id: compared.id, backupName: compared.backupName, createdAt: compared.createdAt, files: compared.files, records: compared.records },
    added, removed, changed,
    unchanged: Math.max(0, baseline.records - removed - changed),
    sections
  };
}


interface DetailedChangeRow {
  changeKind: 'added' | 'removed' | 'changed';
  sectionKey: string;
  sourcePath: string;
  sourceCardIndex: number;
  previousRecordType: string | null;
  previousTitle: string | null;
  previousBody: string | null;
  previousDateRaw: string | null;
  comparedRecordType: string | null;
  comparedTitle: string | null;
  comparedBody: string | null;
  comparedDateRaw: string | null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&');
}

const DETAILED_CHANGES_CTE = String.raw`
  WITH baseline_records AS (
    SELECT source.relative_path AS sourcePath, records.section_key AS sectionKey,
      records.source_record_index AS sourceCardIndex, records.record_type AS recordType,
      records.title AS title, records.body_text AS bodyText,
      records.normalized_text AS normalizedText, records.event_time_raw AS dateRaw,
      records.payload_json AS payloadJson
    FROM records INNER JOIN source_files AS source
      ON source.id = records.source_file_id AND source.snapshot_id = records.snapshot_id
    WHERE records.snapshot_id = ?
  ),
  compared_records AS (
    SELECT source.relative_path AS sourcePath, records.section_key AS sectionKey,
      records.source_record_index AS sourceCardIndex, records.record_type AS recordType,
      records.title AS title, records.body_text AS bodyText,
      records.normalized_text AS normalizedText, records.event_time_raw AS dateRaw,
      records.payload_json AS payloadJson
    FROM records INNER JOIN source_files AS source
      ON source.id = records.source_file_id AND source.snapshot_id = records.snapshot_id
    WHERE records.snapshot_id = ?
  ),
  changes AS (
    SELECT 'added' AS changeKind, current.sectionKey, current.sourcePath, current.sourceCardIndex,
      NULL AS previousRecordType, NULL AS previousTitle, NULL AS previousBody, NULL AS previousDateRaw,
      current.recordType AS comparedRecordType, current.title AS comparedTitle,
      current.bodyText AS comparedBody, current.dateRaw AS comparedDateRaw
    FROM compared_records AS current LEFT JOIN baseline_records AS previous
      ON previous.sectionKey = current.sectionKey AND previous.sourcePath = current.sourcePath
      AND previous.sourceCardIndex = current.sourceCardIndex
    WHERE previous.sourceCardIndex IS NULL
    UNION ALL
    SELECT 'removed' AS changeKind, previous.sectionKey, previous.sourcePath, previous.sourceCardIndex,
      previous.recordType, previous.title, previous.bodyText, previous.dateRaw,
      NULL, NULL, NULL, NULL
    FROM baseline_records AS previous LEFT JOIN compared_records AS current
      ON current.sectionKey = previous.sectionKey AND current.sourcePath = previous.sourcePath
      AND current.sourceCardIndex = previous.sourceCardIndex
    WHERE current.sourceCardIndex IS NULL
    UNION ALL
    SELECT 'changed' AS changeKind, current.sectionKey, current.sourcePath, current.sourceCardIndex,
      previous.recordType, previous.title, previous.bodyText, previous.dateRaw,
      current.recordType, current.title, current.bodyText, current.dateRaw
    FROM compared_records AS current INNER JOIN baseline_records AS previous
      ON previous.sectionKey = current.sectionKey AND previous.sourcePath = current.sourcePath
      AND previous.sourceCardIndex = current.sourceCardIndex
    WHERE current.recordType IS NOT previous.recordType
      OR current.title IS NOT previous.title
      OR current.bodyText IS NOT previous.bodyText
      OR current.normalizedText IS NOT previous.normalizedText
      OR current.dateRaw IS NOT previous.dateRaw
      OR current.payloadJson IS NOT previous.payloadJson
  )
`;

function validateComparisonPair(
  database: DatabaseSync,
  baselineSnapshotId: string,
  comparedSnapshotId: string
): void {
  if (!baselineSnapshotId || !comparedSnapshotId || baselineSnapshotId === comparedSnapshotId) {
    throw new Error('Choose two different backup snapshots to compare.');
  }
  const baseline = getSnapshot(database, baselineSnapshotId);
  const compared = getSnapshot(database, comparedSnapshotId);
  if (!baseline || !compared) throw new Error('One of the selected backups no longer exists.');
  if (baseline.accountId !== compared.accountId) {
    throw new Error('Only backups belonging to the same Facebook account can be compared.');
  }
}

/** Returns a page of source-provenanced added, removed, and changed records. */
export function listArchiveComparisonChanges(
  database: DatabaseSync,
  baselineSnapshotId: string,
  comparedSnapshotId: string,
  filter: ArchiveComparisonChangeKind = 'all',
  sectionKey = 'all',
  query = '',
  requestedPage = 1,
  requestedPageSize = 100
): ArchiveComparisonChangesPage {
  validateComparisonPair(database, baselineSnapshotId, comparedSnapshotId);
  if (!['all', 'added', 'removed', 'changed'].includes(filter)) {
    throw new Error('The selected comparison change filter is invalid.');
  }
  if (typeof sectionKey !== 'string' || sectionKey.length > 100) {
    throw new Error('The comparison section filter is invalid.');
  }
  if (typeof query !== 'string' || query.length > 160) {
    throw new Error('Comparison search must contain no more than 160 characters.');
  }
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 100000) {
    throw new Error('The comparison page number is invalid.');
  }
  if (!Number.isSafeInteger(requestedPageSize) || requestedPageSize < 1 || requestedPageSize > 1000) {
    throw new Error('The comparison page size is invalid.');
  }

  const conditions: string[] = [];
  const parameters: string[] = [baselineSnapshotId, comparedSnapshotId];
  if (filter !== 'all') {
    conditions.push('changes.changeKind = ?');
    parameters.push(filter);
  }
  if (sectionKey && sectionKey !== 'all') {
    conditions.push('changes.sectionKey = ?');
    parameters.push(sectionKey);
  }
  const normalizedQuery = query.trim();
  if (normalizedQuery) {
    const pattern = '%' + escapeLikePattern(normalizedQuery) + '%';
    conditions.push(String.raw`(
      changes.sourcePath LIKE ? ESCAPE '\' COLLATE NOCASE
      OR COALESCE(changes.previousTitle, '') LIKE ? ESCAPE '\' COLLATE NOCASE
      OR COALESCE(changes.previousBody, '') LIKE ? ESCAPE '\' COLLATE NOCASE
      OR COALESCE(changes.comparedTitle, '') LIKE ? ESCAPE '\' COLLATE NOCASE
      OR COALESCE(changes.comparedBody, '') LIKE ? ESCAPE '\' COLLATE NOCASE
    )`);
    parameters.push(pattern, pattern, pattern, pattern, pattern);
  }
  const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const totalRow = database.prepare(DETAILED_CHANGES_CTE + String.raw`
    SELECT COUNT(*) AS total FROM changes ${whereClause}
  `).get(...parameters) as { total: number };
  const total = totalRow.total;
  const pageCount = Math.max(1, Math.ceil(total / requestedPageSize));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * requestedPageSize;

  const changes = database.prepare(DETAILED_CHANGES_CTE + String.raw`
    SELECT changeKind, sectionKey, sourcePath, sourceCardIndex,
      previousRecordType, previousTitle, previousBody, previousDateRaw,
      comparedRecordType, comparedTitle, comparedBody, comparedDateRaw
    FROM changes
    ${whereClause}
    ORDER BY sectionKey COLLATE NOCASE, sourcePath COLLATE NOCASE,
      sourceCardIndex ASC, changeKind
    LIMIT ? OFFSET ?
  `).all(...parameters, requestedPageSize, offset) as unknown as DetailedChangeRow[];

  return { changes, total, page, pageSize: requestedPageSize };
}
