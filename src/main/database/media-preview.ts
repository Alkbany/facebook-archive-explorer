import type { DatabaseSync } from 'node:sqlite';
import { extname } from 'node:path';
import { readArchiveBinaryFile } from '../import/discovery/read-archive-file';

const MAX_IMAGE_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_VIDEO_PREVIEW_BYTES = 24 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg'
};

export async function getMessageMediaPreview(database: DatabaseSync, snapshotId: string, mediaAssetId: number): Promise<string> {
  if (!Number.isSafeInteger(mediaAssetId) || mediaAssetId < 1) throw new Error('Invalid media selection.');
  const row = database.prepare(`
    SELECT assets.relative_path AS relativePath, assets.media_kind AS mediaKind,
      snapshots.source_path AS sourcePath
    FROM media_assets AS assets
    INNER JOIN archive_snapshots AS snapshots ON snapshots.id = assets.snapshot_id
    WHERE assets.id = ? AND assets.snapshot_id = ?
  `).get(mediaAssetId, snapshotId) as { relativePath: string; mediaKind: string; sourcePath: string } | undefined;
  if (!row) throw new Error('The selected attachment does not belong to this backup.');

  const extension = extname(row.relativePath).toLocaleLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) throw new Error('This media format is not supported for preview.');

  const isImage = row.mediaKind === 'image' || row.mediaKind === 'sticker';
  const isVideo = row.mediaKind === 'video';
  const isAudio = row.mediaKind === 'audio';
  if (!isImage && !isVideo && !isAudio) throw new Error('This attachment type cannot be previewed.');
  if (isImage && !mimeType.startsWith('image/')) throw new Error('The image extension does not match its media type.');
  if (isVideo && !mimeType.startsWith('video/')) throw new Error('The video extension does not match its media type.');
  if (isAudio && !mimeType.startsWith('audio/')) throw new Error('The audio extension does not match its media type.');

  const maxBytes = isImage ? MAX_IMAGE_PREVIEW_BYTES : MAX_AUDIO_VIDEO_PREVIEW_BYTES;
  const bytes = await readArchiveBinaryFile(row.sourcePath, row.relativePath, maxBytes);
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}
