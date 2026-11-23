import type { DatabaseSync } from 'node:sqlite';
import type {
  ArchiveFileDirectoryView,
  ArchiveFileRecord,
  ArchiveFileStatus
} from '../../shared/archive/inspection';

const PAGE_SIZE = 100;
const FILE_STATUSES: readonly Exclude<ArchiveFileStatus, 'all'>[] = [
  'discovered', 'queued', 'processing', 'completed', 'empty', 'unsupported', 'failed', 'skipped'
];

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&');
}

/** Lists source-file metadata only; it never reads or modifies original archive content. */
export function listArchiveFiles(
  database: DatabaseSync,
  snapshotId: string,
  status: ArchiveFileStatus = 'all',
  sectionKey = 'all',
  query = '',
  requestedPage = 1
): ArchiveFileDirectoryView {
  if (typeof snapshotId !== 'string' || !snapshotId.trim()) {
    throw new Error('A selected backup is required to list archive files.');
  }
  if (status !== 'all' && !FILE_STATUSES.includes(status)) {
    throw new Error('The selected archive file status is not supported.');
  }
  if (typeof sectionKey !== 'string' || (sectionKey !== 'all' && !/^[a-z0-9_]{1,80}$/u.test(sectionKey))) {
    throw new Error('The selected archive section is invalid.');
  }
  if (typeof query !== 'string' || query.length > 120) {
    throw new Error('Archive file search must contain no more than 120 characters.');
  }
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    throw new Error('The archive file page number is invalid.');
  }

  const countsRow = database.prepare(`
    SELECT
      COUNT(*) AS all_count,
      SUM(CASE WHEN status = 'discovered' THEN 1 ELSE 0 END) AS discovered_count,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued_count,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing_count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
      SUM(CASE WHEN status = 'empty' THEN 1 ELSE 0 END) AS empty_count,
      SUM(CASE WHEN status = 'unsupported' THEN 1 ELSE 0 END) AS unsupported_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count
    FROM source_files
    WHERE snapshot_id = ?
  `).get(snapshotId) as {
    all_count: number;
    discovered_count: number | null;
    queued_count: number | null;
    processing_count: number | null;
    completed_count: number | null;
    empty_count: number | null;
    unsupported_count: number | null;
    failed_count: number | null;
    skipped_count: number | null;
  };

  const conditions = ['snapshot_id = ?'];
  const parameters: Array<string | number> = [snapshotId];
  if (status !== 'all') {
    conditions.push('status = ?');
    parameters.push(status);
  }
  if (sectionKey !== 'all') {
    conditions.push('section_key = ?');
    parameters.push(sectionKey);
  }
  const normalizedQuery = query.trim();
  if (normalizedQuery) {
    const pattern = '%' + escapeLikePattern(normalizedQuery) + '%';
    conditions.push("(relative_path LIKE ? ESCAPE '\\' COLLATE NOCASE OR file_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR section_key LIKE ? ESCAPE '\\' COLLATE NOCASE OR COALESCE(safe_error_code, '') LIKE ? ESCAPE '\\' COLLATE NOCASE)");
    parameters.push(pattern, pattern, pattern, pattern);
  }

  const whereClause = conditions.join(' AND ');
  const totalRow = database.prepare(
    'SELECT COUNT(*) AS total FROM source_files WHERE ' + whereClause
  ).get(...parameters) as { total: number };

  const total = totalRow.total;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * PAGE_SIZE;

  const records = database.prepare(`
    SELECT
      id,
      relative_path AS relativePath,
      file_name AS fileName,
      section_key AS sectionKey,
      detected_format AS detectedFormat,
      status,
      file_size_bytes AS fileSizeBytes,
      record_count AS recordCount,
      safe_error_code AS safeErrorCode,
      processed_at AS processedAt
    FROM source_files
    WHERE ${whereClause}
    ORDER BY section_key COLLATE NOCASE, relative_path COLLATE NOCASE
    LIMIT ? OFFSET ?
  `).all(...parameters, PAGE_SIZE, offset) as unknown as ArchiveFileRecord[];

  return {
    records,
    counts: {
      all: countsRow.all_count,
      discovered: countsRow.discovered_count ?? 0,
      queued: countsRow.queued_count ?? 0,
      processing: countsRow.processing_count ?? 0,
      completed: countsRow.completed_count ?? 0,
      empty: countsRow.empty_count ?? 0,
      unsupported: countsRow.unsupported_count ?? 0,
      failed: countsRow.failed_count ?? 0,
      skipped: countsRow.skipped_count ?? 0
    },
    total,
    page,
    pageSize: PAGE_SIZE
  };
}
