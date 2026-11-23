import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { resolveArchivePath } from './safe-path';
import { readZipEntryBuffer, ZipArchiveError } from './zip-archive';

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
  try {
    const sourceStats = await stat(archiveRoot);
    if (sourceStats.isFile() && extname(archiveRoot).toLocaleLowerCase() === '.zip') {
      return (await readZipEntry(archiveRoot, relativePath, maxBytes)).toString('utf8');
    }
  } catch {
    // Let the directory reader below report a stable, safe ArchiveReadError.
  }
  const filePath = await resolveSafeArchiveFile(archiveRoot, relativePath, maxBytes);
  return readFile(filePath, 'utf8');
}

/** Reads bounded binary data from a directory archive or ZIP entry. */
export async function readArchiveBinaryFile(archiveRoot: string, relativePath: string, maxBytes: number): Promise<Buffer> {
  try {
    const sourceStats = await stat(archiveRoot);
    if (sourceStats.isFile() && extname(archiveRoot).toLocaleLowerCase() === '.zip') {
      return await readZipEntry(archiveRoot, relativePath, maxBytes);
    }
  } catch {
    // Let the directory reader below report a stable, safe ArchiveReadError.
  }
  const filePath = await resolveSafeArchiveFile(archiveRoot, relativePath, maxBytes);
  return readFile(filePath);
}
