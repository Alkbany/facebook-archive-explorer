import type { DatabaseSync } from 'node:sqlite';
import type { ImportIssueReport } from '../../shared/archive/inspection';

const MAX_ISSUES = 500;

/** Returns safe, source-linked diagnostics for one backup without exposing raw payload data. */
export function listImportIssues(
  database: DatabaseSync,
  snapshotId: string,
  requestedLimit = 250
): ImportIssueReport {
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(MAX_ISSUES, Math.max(1, requestedLimit))
    : 250;

  const totalRow = database.prepare(`
    SELECT COUNT(*) AS total
    FROM import_issues AS issues
    INNER JOIN import_runs AS runs ON runs.id = issues.import_run_id
    WHERE runs.snapshot_id = ?
  `).get(snapshotId) as { total: number };

  const severityRows = database.prepare(`
    SELECT issues.severity AS severity, COUNT(*) AS count
    FROM import_issues AS issues
    INNER JOIN import_runs AS runs ON runs.id = issues.import_run_id
    WHERE runs.snapshot_id = ?
    GROUP BY issues.severity
  `).all(snapshotId) as Array<{ severity: string; count: number }>;

  const counts = { info: 0, warning: 0, error: 0 };
  for (const row of severityRows) {
    if (row.severity === 'info' || row.severity === 'warning' || row.severity === 'error') {
      counts[row.severity] = row.count;
    }
  }

  const items = database.prepare(`
    SELECT
      issues.id AS id,
      issues.severity AS severity,
      issues.issue_code AS issueCode,
      issues.safe_message AS safeMessage,
      files.file_name AS sourceFileName,
      files.relative_path AS sourcePath,
      CAST(json_extract(issues.context_json, '$.sourceCardIndex') AS INTEGER) AS sourceCardIndex,
      issues.created_at AS createdAt
    FROM import_issues AS issues
    INNER JOIN import_runs AS runs ON runs.id = issues.import_run_id
    LEFT JOIN source_files AS files ON files.id = issues.source_file_id
    WHERE runs.snapshot_id = ?
    ORDER BY issues.created_at DESC, issues.id DESC
    LIMIT ?
  `).all(snapshotId, limit) as ImportIssueReport['items'];

  return {
    items,
    total: totalRow.total,
    hasMore: totalRow.total > items.length,
    counts
  };
}
