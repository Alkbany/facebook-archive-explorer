import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import type { DatabaseSync } from 'node:sqlite';
import { protocol } from 'electron';
import { resolveSafeArchiveFile } from '../import/discovery/read-archive-file';
import { parseSingleByteRange } from './media-range';
import { getZipEntrySize, openZipEntryReadStream } from '../import/discovery/zip-archive';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.3gp': 'video/3gpp', '.3gpp': 'video/3gpp', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac'
};

export function registerArchiveMediaProtocol(
  database: DatabaseSync,
  getSelectedSnapshotId: () => string | null
): void {
  protocol.handle('archive-media', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'media' || !/^\/\d+$/u.test(url.pathname) || request.method !== 'GET') {
        return new Response('Not found', { status: 404 });
      }
      const mediaAssetId = Number(url.pathname.slice(1));
      if (!Number.isSafeInteger(mediaAssetId) || mediaAssetId < 1) return new Response('Not found', { status: 404 });
      const snapshotId = getSelectedSnapshotId();
      if (!snapshotId) return new Response('No selected backup', { status: 404 });
      const row = database.prepare(`
        SELECT assets.relative_path AS relativePath, assets.media_kind AS mediaKind,
          snapshots.source_path AS sourcePath, snapshots.source_kind AS sourceKind
        FROM media_assets AS assets
        INNER JOIN archive_snapshots AS snapshots ON snapshots.id = assets.snapshot_id
        WHERE assets.id = ? AND assets.snapshot_id = ?
      `).get(mediaAssetId, snapshotId) as { relativePath: string; mediaKind: string; sourcePath: string; sourceKind: 'directory' | 'zip' } | undefined;
      if (!row) return new Response('Not found', { status: 404 });

      const mimeType = MIME_BY_EXTENSION[extname(row.relativePath).toLowerCase()];
      const expectedKind = mimeType?.startsWith('video/') ? 'video' : mimeType?.startsWith('audio/') ? 'audio' : null;
      if (!mimeType || !expectedKind || row.mediaKind !== expectedKind) return new Response('Unsupported media', { status: 415 });

      let filePath: string | null = null;
      let fileSize: number;
      if (row.sourceKind === 'zip') {
        fileSize = await getZipEntrySize(row.sourcePath, row.relativePath);
      } else {
        filePath = await resolveSafeArchiveFile(row.sourcePath, row.relativePath, Number.POSITIVE_INFINITY);
        const fileStats = await stat(filePath);
        if (!fileStats.isFile()) return new Response(null, { status: 404 });
        fileSize = fileStats.size;
      }
      if (fileSize < 1) return new Response(null, { status: 404 });
      const range = parseSingleByteRange(request.headers.get('range'), fileSize);
      if (range === 'invalid') {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${fileSize}`, 'Accept-Ranges': 'bytes' } });
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? fileSize - 1;
      const stream = row.sourceKind === 'zip'
        ? (await openZipEntryReadStream(row.sourcePath, row.relativePath, range ? start : undefined, range ? end : undefined)).stream
        : createReadStream(filePath!, { start, end });
      const headers = new Headers({
        'Content-Type': mimeType,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      });
      if (range) headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
    } catch {
      return new Response('Media unavailable', { status: 404 });
    }
  });
}
