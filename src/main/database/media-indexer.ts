import type { DatabaseSync } from 'node:sqlite';
import { readArchiveBinaryPrefix } from '../import/discovery/read-archive-file';
import { readImageDimensions } from './image-dimensions';

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
