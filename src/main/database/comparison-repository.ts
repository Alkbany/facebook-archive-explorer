import type { DatabaseSync } from 'node:sqlite';
import type { ArchiveComparisonReport, ArchiveComparisonSection } from '../../shared/archive/comparison';

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
