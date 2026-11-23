import type { DatabaseSync } from 'node:sqlite';

/** Indexes discovered image, video, and audio paths without opening or copying media bytes. */
export function indexDiscoveredMediaAssets(database: DatabaseSync, snapshotId: string): number {
  const result = database.prepare(`
    INSERT INTO media_assets (snapshot_id, source_file_id, relative_path, media_kind, created_at)
    SELECT snapshot_id, id, relative_path, detected_format, ?
    FROM source_files
    WHERE snapshot_id = ? AND detected_format IN ('image', 'video', 'audio')
    ON CONFLICT(snapshot_id, relative_path) DO UPDATE SET
      source_file_id = excluded.source_file_id,
      media_kind = excluded.media_kind
  `).run(new Date().toISOString(), snapshotId);
  return Number(result.changes);
}
