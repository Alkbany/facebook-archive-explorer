import type { DatabaseSync } from 'node:sqlite';
import type { ReactionRecordSummary } from '../../shared/archive/inspection';

export function listReactionRecords(database: DatabaseSync, snapshotId: string): ReactionRecordSummary[] {
  return database.prepare(`
    SELECT records.id AS id, records.source_file_id AS sourceFileId,
      source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex,
      records.title AS reactionType, records.body_text AS descriptionRaw,
      records.event_time_raw AS dateRaw
    FROM records
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE records.snapshot_id = ? AND records.section_key = 'likes_and_reactions'
    ORDER BY source.relative_path COLLATE NOCASE, records.source_record_index ASC
    LIMIT 1000
  `).all(snapshotId) as unknown as ReactionRecordSummary[];
}

export function listPostRecords(database: DatabaseSync, snapshotId: string): import('../../shared/archive/inspection').PostRecordSummary[] {
  return database.prepare(`
    SELECT records.id AS id, source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex,
      records.title AS authorRaw, records.body_text AS bodyRaw,
      records.event_time_raw AS dateRaw,
      COUNT(record_media.media_asset_id) AS mediaCount
    FROM records
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    LEFT JOIN record_media ON record_media.record_id = records.id
    WHERE records.snapshot_id = ? AND records.section_key = 'posts'
    GROUP BY records.id
    ORDER BY source.relative_path COLLATE NOCASE, records.source_record_index ASC
    LIMIT 1000
  `).all(snapshotId) as unknown as import('../../shared/archive/inspection').PostRecordSummary[];
}

 
export function listCommentActivities(database: DatabaseSync, snapshotId: string): import('../../shared/archive/inspection').CommentActivitySummary[] {
  return database.prepare(`
    SELECT records.id AS id, source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex,
      records.title AS activityRaw, records.body_text AS bodyRaw,
      json_extract(records.payload_json, '$.group_raw') AS groupRaw,
      records.event_time_raw AS dateRaw
    FROM records
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE records.snapshot_id = ? AND records.section_key = 'comments'
    ORDER BY source.relative_path COLLATE NOCASE, records.source_record_index ASC
    LIMIT 2000
  `).all(snapshotId) as unknown as import('../../shared/archive/inspection').CommentActivitySummary[];
}
