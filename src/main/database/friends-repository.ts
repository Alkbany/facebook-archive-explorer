import type { DatabaseSync } from 'node:sqlite';
import type {
  FriendDirectoryFilter,
  FriendDirectoryRecord,
  FriendDirectoryView,
  FriendRecordType
} from '../../shared/archive/inspection';

const PAGE_SIZE = 100;
const FRIEND_RECORD_TYPES: readonly FriendRecordType[] = [
  'friend',
  'received',
  'sent',
  'rejected',
  'removed'
];

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&');
}

/**
 * Lists friend records without exposing contact_info_raw, which is deliberately
 * kept out of global search and is not needed for the directory view.
 */
export function listFriendDirectory(
  database: DatabaseSync,
  snapshotId: string,
  filter: FriendDirectoryFilter = 'all',
  query = '',
  requestedPage = 1
): FriendDirectoryView {
  if (typeof snapshotId !== 'string' || !snapshotId.trim()) {
    throw new Error('A selected backup is required to list friends.');
  }
  if (filter !== 'all' && !FRIEND_RECORD_TYPES.includes(filter)) {
    throw new Error('The selected Friends filter is not supported.');
  }
  if (typeof query !== 'string' || query.length > 100) {
    throw new Error('Friends search must contain no more than 100 characters.');
  }
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    throw new Error('The Friends page number is invalid.');
  }

  const countsRow = database.prepare(`
    SELECT
      COUNT(*) AS all,
      SUM(CASE WHEN record_type = 'friend' THEN 1 ELSE 0 END) AS friends,
      SUM(CASE WHEN record_type = 'received' THEN 1 ELSE 0 END) AS received,
      SUM(CASE WHEN record_type = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN record_type = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN record_type = 'removed' THEN 1 ELSE 0 END) AS removed
    FROM records
    WHERE snapshot_id = ? AND section_key = 'friends'
  `).get(snapshotId) as {
    all: number;
    friends: number | null;
    received: number | null;
    sent: number | null;
    rejected: number | null;
    removed: number | null;
  };

  const conditions = [
    'records.snapshot_id = ?',
    "records.section_key = 'friends'"
  ];
  const parameters: Array<string | number> = [snapshotId];

  if (filter !== 'all') {
    conditions.push('records.record_type = ?');
    parameters.push(filter);
  }

  const normalizedQuery = query.trim();
  if (normalizedQuery) {
    const pattern = `%${escapeLikePattern(normalizedQuery)}%`;
    conditions.push(`(
      COALESCE(records.title, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR COALESCE(records.event_time_raw, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
      OR source.relative_path LIKE ? ESCAPE '\\' COLLATE NOCASE
    )`);
    parameters.push(pattern, pattern, pattern);
  }

  const whereClause = conditions.join(' AND ');
  const totalRow = database.prepare(`
    SELECT COUNT(*) AS total
    FROM records
    INNER JOIN source_files AS source
      ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE ${whereClause}
  `).get(...parameters) as { total: number };

  const total = totalRow.total;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * PAGE_SIZE;

  const records = database.prepare(`
    SELECT
      records.id AS id,
      records.title AS nameRaw,
      records.record_type AS recordType,
      records.event_time_raw AS dateRaw,
      source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex
    FROM records
    INNER JOIN source_files AS source
      ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE ${whereClause}
    ORDER BY records.title COLLATE NOCASE, source.relative_path COLLATE NOCASE,
      records.source_record_index ASC
    LIMIT ? OFFSET ?
  `).all(...parameters, PAGE_SIZE, offset) as unknown as FriendDirectoryRecord[];

  return {
    records,
    counts: {
      all: countsRow.all,
      friends: countsRow.friends ?? 0,
      received: countsRow.received ?? 0,
      sent: countsRow.sent ?? 0,
      rejected: countsRow.rejected ?? 0,
      removed: countsRow.removed ?? 0
    },
    total,
    page,
    pageSize: PAGE_SIZE
  };
}
