import type { DatabaseSync } from 'node:sqlite';
import type { ImportCoverageReport } from '../../shared/archive/inspection';

export function getImportCoverage(database: DatabaseSync, snapshotId: string): ImportCoverageReport {
  const totals = database.prepare(`
    SELECT
      COUNT(*) AS totalFiles,
      SUM(CASE WHEN detected_format IN ('image', 'video', 'audio') THEN 1 ELSE 0 END) AS mediaFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') THEN 1 ELSE 0 END) AS contentFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status = 'completed' THEN 1 ELSE 0 END) AS completedFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status = 'unsupported' THEN 1 ELSE 0 END) AS unsupportedFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status = 'failed' THEN 1 ELSE 0 END) AS failedFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status IN ('discovered', 'queued', 'processing') THEN 1 ELSE 0 END) AS unprocessedFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status = 'empty' THEN 1 ELSE 0 END) AS emptyFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status = 'skipped' THEN 1 ELSE 0 END) AS skippedFiles
    FROM source_files
    WHERE snapshot_id = ?
  `).get(snapshotId) as ImportCoverageReport['totals'];

  const sections = database.prepare(`
    SELECT
      section_key AS sectionKey,
      COUNT(*) AS totalFiles,
      SUM(CASE WHEN detected_format = 'html' THEN 1 ELSE 0 END) AS htmlFiles,
      SUM(CASE WHEN detected_format = 'json' THEN 1 ELSE 0 END) AS jsonFiles,
      SUM(CASE WHEN detected_format = 'text' THEN 1 ELSE 0 END) AS textFiles,
      SUM(CASE WHEN detected_format IN ('image', 'video', 'audio') THEN 1 ELSE 0 END) AS mediaFiles,
      SUM(CASE WHEN detected_format IN ('other', 'unknown') THEN 1 ELSE 0 END) AS otherFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status = 'completed' THEN 1 ELSE 0 END) AS completedFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status = 'unsupported' THEN 1 ELSE 0 END) AS unsupportedFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status = 'failed' THEN 1 ELSE 0 END) AS failedFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status IN ('discovered', 'queued', 'processing') THEN 1 ELSE 0 END) AS unprocessedFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status = 'empty' THEN 1 ELSE 0 END) AS emptyFiles,
      SUM(CASE WHEN detected_format NOT IN ('image', 'video', 'audio') AND status = 'skipped' THEN 1 ELSE 0 END) AS skippedFiles
    FROM source_files
    WHERE snapshot_id = ?
    GROUP BY section_key
    ORDER BY totalFiles DESC, section_key COLLATE NOCASE
  `).all(snapshotId) as unknown as ImportCoverageReport['sections'];

  const integrityRow = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM source_files AS files
        WHERE files.snapshot_id = ? AND files.record_count <> (
          SELECT COUNT(*) FROM records WHERE source_file_id = files.id
        )) AS sourceRecordCountMismatches,
      (SELECT COUNT(*) FROM records AS records
        INNER JOIN source_files AS files ON files.id = records.source_file_id
        WHERE records.snapshot_id = ? AND files.snapshot_id <> records.snapshot_id) AS recordsFromAnotherSnapshot,
      (SELECT COUNT(*) FROM media_assets AS assets
        LEFT JOIN source_files AS files ON files.id = assets.source_file_id
        WHERE assets.snapshot_id = ? AND (assets.source_file_id IS NULL OR files.id IS NULL)) AS mediaAssetsWithoutSourceFile,
      (SELECT COUNT(*) FROM media_assets AS assets
        INNER JOIN source_files AS files ON files.id = assets.source_file_id
        WHERE assets.snapshot_id = ? AND files.snapshot_id <> assets.snapshot_id) AS mediaAssetsFromAnotherSnapshot,
      (SELECT COUNT(*) FROM record_media AS links
        INNER JOIN records ON records.id = links.record_id
        INNER JOIN media_assets AS assets ON assets.id = links.media_asset_id
        WHERE records.snapshot_id = ? AND assets.snapshot_id <> records.snapshot_id) AS mediaLinksAcrossSnapshots,
      (SELECT COUNT(*) FROM media_assets AS assets
        WHERE assets.snapshot_id = ? AND (
          (assets.width IS NOT NULL AND assets.width < 1) OR
          (assets.height IS NOT NULL AND assets.height < 1) OR
          (assets.duration_ms IS NOT NULL AND assets.duration_ms < 0)
        )) AS invalidMediaMetadata,
      (SELECT COUNT(*) FROM import_runs
        WHERE snapshot_id = ? AND status = 'running') AS runningImportRuns,
      (SELECT COUNT(*) FROM source_files
        WHERE snapshot_id = ? AND status = 'processing') AS processingSourceFiles
  `).get(
    snapshotId, snapshotId, snapshotId, snapshotId,
    snapshotId, snapshotId, snapshotId, snapshotId
  ) as unknown as ImportCoverageReport['integrity'];

  const normalize = (value: number | null): number => value ?? 0;
  return {
    integrity: integrityRow,
    totals: {
      totalFiles: normalize(totals.totalFiles),
      contentFiles: normalize(totals.contentFiles),
      mediaFiles: normalize(totals.mediaFiles),
      completedFiles: normalize(totals.completedFiles),
      unsupportedFiles: normalize(totals.unsupportedFiles),
      failedFiles: normalize(totals.failedFiles),
      unprocessedFiles: normalize(totals.unprocessedFiles),
      emptyFiles: normalize(totals.emptyFiles),
      skippedFiles: normalize(totals.skippedFiles)
    },
    sections
  };
}
