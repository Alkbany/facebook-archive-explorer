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

  const normalize = (value: number | null): number => value ?? 0;
  return {
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
