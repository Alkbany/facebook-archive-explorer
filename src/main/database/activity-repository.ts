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
