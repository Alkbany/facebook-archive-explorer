import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { resolveArchivePath } from './safe-path';
import { getZipEntrySize, openZipEntryReadStream, readZipEntryBuffer, ZipArchiveError } from './zip-archive';

export type ArchiveReadErrorCode =
  | 'INVALID_RELATIVE_PATH'
  | 'FILE_NOT_FOUND'
  | 'SYMLINK_NOT_ALLOWED'
  | 'NOT_A_FILE'
  | 'FILE_TOO_LARGE'
  | 'PATH_OUTSIDE_ARCHIVE';

export class ArchiveReadError extends Error {
  constructor(public readonly code: ArchiveReadErrorCode) {
    super(code);
    this.name = 'ArchiveReadError';
  }
}

export async function resolveSafeArchiveFile(archiveRoot: string, relativePath: string, maxBytes: number) {
  const canonicalRoot = await realpath(archiveRoot);
  const safePath = resolveArchivePath(canonicalRoot, relativePath);
  if (!safePath.ok) {
    throw new ArchiveReadError(safePath.reason === 'outside_root' ? 'PATH_OUTSIDE_ARCHIVE' : 'INVALID_RELATIVE_PATH');
  }
  const segments = safePath.relativePath.split('/');
  let currentPath = canonicalRoot;
  let finalStats;
  for (let index = 0; index < segments.length; index += 1) {
    currentPath = join(currentPath, segments[index]);
    try { finalStats = await lstat(currentPath); }
    catch { throw new ArchiveReadError('FILE_NOT_FOUND'); }
    if (finalStats.isSymbolicLink()) throw new ArchiveReadError('SYMLINK_NOT_ALLOWED');
    const last = index === segments.length - 1;
    if (!last && !finalStats.isDirectory()) throw new ArchiveReadError('NOT_A_FILE');
    if (last && !finalStats.isFile()) throw new ArchiveReadError('NOT_A_FILE');
  }
  const canonicalFile = await realpath(currentPath);
  const resolvedRelativePath = relative(canonicalRoot, canonicalFile);
  if (!resolvedRelativePath || resolvedRelativePath === '..' || resolvedRelativePath.startsWith(`..${sep}`)) {
    throw new ArchiveReadError('PATH_OUTSIDE_ARCHIVE');
  }
  if (!finalStats || finalStats.size > maxBytes) throw new ArchiveReadError('FILE_TOO_LARGE');
  return canonicalFile;
}

async function readZipEntry(
  archivePath: string,
  relativePath: string,
  maxBytes: number
): Promise<Buffer> {
  try {
    return await readZipEntryBuffer(archivePath, relativePath, maxBytes);
  } catch (error) {
    if (error instanceof ZipArchiveError) throw new ArchiveReadError(error.code);
    throw error;
  }
}

/** Reads a UTF-8 text file from a directory archive or a ZIP entry. */
export async function readArchiveUtf8File(archiveRoot: string, relativePath: string, maxBytes = 50 * 1024 * 1024): Promise<string> {
  let sourceStats;
  try { sourceStats = await stat(archiveRoot); } catch { sourceStats = null; }
  if (sourceStats?.isFile() && extname(archiveRoot).toLocaleLowerCase() === '.zip') {
    return (await readZipEntry(archiveRoot, relativePath, maxBytes)).toString('utf8');
  }
  const filePath = await resolveSafeArchiveFile(archiveRoot, relativePath, maxBytes);
  return readFile(filePath, 'utf8');
}


/**
 * Reads only the first bytes of a media file. ZIP entries are streamed from
 * the original archive; deflated entries are decompressed only up to the
 * requested prefix. This avoids loading entire high-resolution photos.
 */
export async function readArchiveBinaryPrefix(
  archiveRoot: string,
  relativePath: string,
  maxBytes = 1024 * 1024
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) {
    throw new RangeError('The archive binary prefix limit must be between 1 byte and 16 MiB.');
  }

  let sourceStats;
  try { sourceStats = await stat(archiveRoot); } catch { sourceStats = null; }
  if (sourceStats?.isFile() && extname(archiveRoot).toLocaleLowerCase() === '.zip') {
    try {
      const size = await getZipEntrySize(archiveRoot, relativePath);
      if (size === 0) return Buffer.alloc(0);
      const range = await openZipEntryReadStream(archiveRoot, relativePath, 0, Math.min(size, maxBytes) - 1);
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for await (const chunk of range.stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.length;
          if (total > maxBytes) throw new ArchiveReadError('FILE_TOO_LARGE');
          chunks.push(buffer);
        }
      } finally {
        range.close();
      }
      return Buffer.concat(chunks, total);
    } catch (error) {
      if (error instanceof ZipArchiveError) throw new ArchiveReadError(error.code);
      throw error;
    }
  }

  const filePath = await resolveSafeArchiveFile(archiveRoot, relativePath, Number.POSITIVE_INFINITY);
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) throw new ArchiveReadError('NOT_A_FILE');
  const bytesToRead = Math.min(fileStats.size, maxBytes);
  if (bytesToRead === 0) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const stream = createReadStream(filePath, { start: 0, end: bytesToRead - 1 });
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new ArchiveReadError('FILE_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

/** Reads bounded binary data from a directory archive or ZIP entry. */
export async function readArchiveBinaryFile(archiveRoot: string, relativePath: string, maxBytes: number): Promise<Buffer> {
  let sourceStats;
  try { sourceStats = await stat(archiveRoot); } catch { sourceStats = null; }
  if (sourceStats?.isFile() && extname(archiveRoot).toLocaleLowerCase() === '.zip') {
    return await readZipEntry(archiveRoot, relativePath, maxBytes);
  }
  const filePath = await resolveSafeArchiveFile(archiveRoot, relativePath, maxBytes);
  return readFile(filePath);
}

/**
 * Reads only the final bytes of a media file. This is useful for ISO-BMFF
 * files whose moov metadata is stored after the media payload. ZIP entries
 * remain streamed and are never extracted.
 */
export async function readArchiveBinarySuffix(
  archiveRoot: string,
  relativePath: string,
  maxBytes = 1024 * 1024
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) {
    throw new RangeError('The archive binary suffix limit must be between 1 byte and 16 MiB.');
  }

  let sourceStats;
  try { sourceStats = await stat(archiveRoot); } catch { sourceStats = null; }
  if (sourceStats?.isFile() && extname(archiveRoot).toLocaleLowerCase() === '.zip') {
    try {
      const size = await getZipEntrySize(archiveRoot, relativePath);
      if (size === 0) return Buffer.alloc(0);
      const start = Math.max(0, size - maxBytes);
      const range = await openZipEntryReadStream(archiveRoot, relativePath, start, size - 1);
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for await (const chunk of range.stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.length;
          if (total > maxBytes) throw new ArchiveReadError('FILE_TOO_LARGE');
          chunks.push(buffer);
        }
      } finally {
        range.close();
      }
      return Buffer.concat(chunks, total);
    } catch (error) {
      if (error instanceof ZipArchiveError) throw new ArchiveReadError(error.code);
      throw error;
    }
  }

  const filePath = await resolveSafeArchiveFile(archiveRoot, relativePath, Number.POSITIVE_INFINITY);
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) throw new ArchiveReadError('NOT_A_FILE');
  const bytesToRead = Math.min(fileStats.size, maxBytes);
  if (bytesToRead === 0) return Buffer.alloc(0);
  const start = fileStats.size - bytesToRead;
  const chunks: Buffer[] = [];
  let total = 0;
  const stream = createReadStream(filePath, { start, end: fileStats.size - 1 });
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new ArchiveReadError('FILE_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

