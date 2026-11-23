import type { DatabaseSync } from 'node:sqlite';
import { extname } from 'node:path';
import { readArchiveBinaryFile } from '../import/discovery/read-archive-file';

const MAX_IMAGE_PREVIEW_BYTES = 4 * 1024 * 1024;
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
};

export async function getMessageImagePreview(database: DatabaseSync, snapshotId: string, mediaAssetId: number): Promise<string> {
  if (!Number.isSafeInteger(mediaAssetId) || mediaAssetId < 1) throw new Error('Invalid media selection.');
  const row = database.prepare(`
    SELECT assets.relative_path AS relativePath, assets.media_kind AS mediaKind,
      snapshots.source_path AS sourcePath
    FROM media_assets AS assets
    INNER JOIN archive_snapshots AS snapshots ON snapshots.id = assets.snapshot_id
    WHERE assets.id = ? AND assets.snapshot_id = ?
  `).get(mediaAssetId, snapshotId) as { relativePath: string; mediaKind: string; sourcePath: string } | undefined;
  if (!row) throw new Error('The selected attachment does not belong to this backup.');
  if (row.mediaKind !== 'image' && row.mediaKind !== 'sticker') throw new Error('Only image attachments can be previewed.');
  const mimeType = IMAGE_MIME_BY_EXTENSION[extname(row.relativePath).toLocaleLowerCase()];
  if (!mimeType) throw new Error('This image format is not supported for preview.');
  const bytes = await readArchiveBinaryFile(row.sourcePath, row.relativePath, MAX_IMAGE_PREVIEW_BYTES);
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}
