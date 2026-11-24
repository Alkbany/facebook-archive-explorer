import type { DatabaseSync } from 'node:sqlite';
import { readArchiveBinaryPrefix, readArchiveBinarySuffix } from '../import/discovery/read-archive-file';
import { readImageDimensions } from './image-dimensions';
import { readMp4DurationMs, readMp4DurationMsFromTail } from './video-duration';

/** Indexes discovered image, video, and audio paths without opening or copying media bytes. */
export function indexDiscoveredMediaAssets(database: DatabaseSync, snapshotId: string): number {
  const result = database.prepare(`
    INSERT INTO media_assets (snapshot_id, source_file_id, relative_path, media_kind, file_size_bytes, created_at)
    SELECT snapshot_id, id, relative_path, detected_format, file_size_bytes, ?
    FROM source_files
    WHERE snapshot_id = ? AND detected_format IN ('image', 'video', 'audio')
    ON CONFLICT(snapshot_id, relative_path) DO UPDATE SET
      source_file_id = excluded.source_file_id,
      media_kind = excluded.media_kind,
      file_size_bytes = excluded.file_size_bytes
  `).run(new Date().toISOString(), snapshotId);
  return Number(result.changes);
}

/**
 * Enriches at most 50 indexed images per gallery open using a bounded header
 * prefix. Every attempted path is marked in SQLite, so unsupported files do
 * not block later batches and progress survives application restarts.
 */
export async function indexDiscoveredImageDimensions(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string
): Promise<number> {
  const candidates = database.prepare(`
    SELECT relative_path AS relativePath
    FROM media_assets
    WHERE snapshot_id = ? AND media_kind = 'image'
      AND width IS NULL AND height IS NULL
      AND metadata_scan_attempted = 0
    ORDER BY relative_path COLLATE NOCASE
    LIMIT 50
  `).all(snapshotId) as Array<{ relativePath: string }>;
  const updateDimensions = database.prepare(`
    UPDATE media_assets
    SET width = ?, height = ?, metadata_scan_attempted = 1
    WHERE snapshot_id = ? AND relative_path = ? AND media_kind = 'image'
  `);
  const markAttempted = database.prepare(`
    UPDATE media_assets SET metadata_scan_attempted = 1
    WHERE snapshot_id = ? AND relative_path = ? AND media_kind = 'image'
  `);

  let indexed = 0;
  for (const item of candidates) {
    try {
      const bytes = await readArchiveBinaryPrefix(archiveRoot, item.relativePath, 256 * 1024);
      const dimensions = readImageDimensions(bytes);
      if (dimensions && dimensions.width > 0 && dimensions.height > 0) {
        updateDimensions.run(dimensions.width, dimensions.height, snapshotId, item.relativePath);
        indexed += 1;
      } else {
        markAttempted.run(snapshotId, item.relativePath);
      }
    } catch {
      // Metadata is optional; unreadable or unsupported media must not fail archive discovery.
      markAttempted.run(snapshotId, item.relativePath);
    }
  }
  return indexed;
}

/**
 * Reads up to 10 previously unscanned MP4/MOV/M4V assets per gallery open.
 * A 2 MiB prefix handles fast-start files; a 2 MiB suffix handles common
 * files with moov at the end. Attempt state is persisted in SQLite so one
 * batch is processed only once, including across application restarts.
 */
export async function indexDiscoveredVideoDurations(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string
): Promise<number> {
  const candidates = database.prepare(`
    SELECT relative_path AS relativePath
    FROM media_assets
    WHERE snapshot_id = ? AND media_kind = 'video'
      AND duration_ms IS NULL AND metadata_scan_attempted = 0
      AND (
        lower(relative_path) LIKE '%.mp4'
        OR lower(relative_path) LIKE '%.mov'
        OR lower(relative_path) LIKE '%.m4v'
      )
    ORDER BY relative_path COLLATE NOCASE
    LIMIT 10
  `).all(snapshotId) as Array<{ relativePath: string }>;

  const update = database.prepare(`
    UPDATE media_assets
    SET duration_ms = COALESCE(?, duration_ms), metadata_scan_attempted = 1
    WHERE snapshot_id = ? AND relative_path = ? AND media_kind = 'video'
  `);

  let indexed = 0;
  for (const item of candidates) {
    let durationMs: number | null = null;
    try {
      const prefix = await readArchiveBinaryPrefix(archiveRoot, item.relativePath, 2 * 1024 * 1024);
      durationMs = readMp4DurationMs(prefix);
      if (durationMs === null) {
        const suffix = await readArchiveBinarySuffix(archiveRoot, item.relativePath, 2 * 1024 * 1024);
        durationMs = readMp4DurationMsFromTail(suffix);
      }
    } catch {
      // Optional media metadata must never prevent the media gallery from opening.
    }
    update.run(durationMs, snapshotId, item.relativePath);
    if (durationMs !== null) indexed += 1;
  }
  return indexed;
}
