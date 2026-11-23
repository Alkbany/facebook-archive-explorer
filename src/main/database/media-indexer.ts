import type { DatabaseSync } from 'node:sqlite';
import { readArchiveBinaryPrefix } from '../import/discovery/read-archive-file';
import { readImageDimensions } from './image-dimensions';
import { readMp4DurationMs } from './video-duration';

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
 * Enriches a small batch of indexed images using only a bounded header prefix.
 * Large image files are supported without loading their full contents.
 */
export async function indexDiscoveredImageDimensions(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string
): Promise<number> {
  const candidates = database.prepare(`
    SELECT assets.relative_path AS relativePath
    FROM media_assets AS assets
    WHERE assets.snapshot_id = ? AND assets.media_kind = 'image'
      AND assets.width IS NULL AND assets.height IS NULL
    ORDER BY relative_path
    LIMIT 50
  `).all(snapshotId) as Array<{ relativePath: string }>;
  const update = database.prepare(`
    UPDATE media_assets SET width = ?, height = ?
    WHERE snapshot_id = ? AND relative_path = ? AND media_kind = 'image'
  `);
  let indexed = 0;
  for (const item of candidates) {
    try {
      const bytes = await readArchiveBinaryPrefix(archiveRoot, item.relativePath, 256 * 1024);
      const dimensions = readImageDimensions(bytes);
      if (!dimensions || dimensions.width < 1 || dimensions.height < 1) continue;
      update.run(dimensions.width, dimensions.height, snapshotId, item.relativePath);
      indexed += 1;
    } catch {
      // Metadata is optional; unreadable or unsupported media must not fail archive discovery.
    }
  }
  return indexed;
}


const attemptedVideoDurationScans = new WeakMap<DatabaseSync, Map<string, Set<string>>>();

/**
 * Reads MP4/MOV/M4V movie headers for up to 10 previously unseen video assets
 * each time the gallery is opened. A bounded 2 MiB prefix avoids loading video
 * payloads into memory. Unsupported containers and late movie headers remain
 * unavailable rather than causing an unbounded read.
 */
export async function indexDiscoveredVideoDurations(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string
): Promise<number> {
  let snapshots = attemptedVideoDurationScans.get(database);
  if (!snapshots) {
    snapshots = new Map<string, Set<string>>();
    attemptedVideoDurationScans.set(database, snapshots);
  }
  let attempted = snapshots.get(snapshotId);
  if (!attempted) {
    attempted = new Set<string>();
    snapshots.set(snapshotId, attempted);
  }

  const candidates = database.prepare(`
    SELECT relative_path AS relativePath
    FROM media_assets
    WHERE snapshot_id = ? AND media_kind = 'video' AND duration_ms IS NULL
      AND (
        lower(relative_path) LIKE '%.mp4'
        OR lower(relative_path) LIKE '%.mov'
        OR lower(relative_path) LIKE '%.m4v'
      )
    ORDER BY relative_path COLLATE NOCASE
  `).all(snapshotId) as Array<{ relativePath: string }>;

  const update = database.prepare(`
    UPDATE media_assets SET duration_ms = ?
    WHERE snapshot_id = ? AND relative_path = ? AND media_kind = 'video'
      AND duration_ms IS NULL
  `);

  let indexed = 0;
  let scanned = 0;
  for (const item of candidates) {
    if (attempted.has(item.relativePath)) continue;
    attempted.add(item.relativePath);
    scanned += 1;
    try {
      const prefix = await readArchiveBinaryPrefix(archiveRoot, item.relativePath, 2 * 1024 * 1024);
      const durationMs = readMp4DurationMs(prefix);
      if (durationMs !== null) {
        update.run(durationMs, snapshotId, item.relativePath);
        indexed += 1;
      }
    } catch {
      // Optional media metadata must never prevent the media gallery from opening.
    }
    if (scanned >= 10) break;
  }
  return indexed;
}
