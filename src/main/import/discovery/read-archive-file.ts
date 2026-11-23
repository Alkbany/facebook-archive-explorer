import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { resolveArchivePath } from './safe-path';

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

/**
 * Reads a UTF-8 text file beneath the selected archive root.
 * Every path component is checked with lstat so symlinks are never followed.
 */
export async function readArchiveUtf8File(
  archiveRoot: string,
  relativePath: string,
  maxBytes = 50 * 1024 * 1024
): Promise<string> {
  const canonicalRoot = await realpath(archiveRoot);
  const safePath = resolveArchivePath(canonicalRoot, relativePath);

  if (!safePath.ok) {
    throw new ArchiveReadError(
      safePath.reason === 'outside_root' ? 'PATH_OUTSIDE_ARCHIVE' : 'INVALID_RELATIVE_PATH'
    );
  }

  const segments = safePath.relativePath.split('/');
  let currentPath = canonicalRoot;
  let finalStats;

  for (let index = 0; index < segments.length; index += 1) {
    currentPath = join(currentPath, segments[index]);

    try {
      finalStats = await lstat(currentPath);
    } catch {
      throw new ArchiveReadError('FILE_NOT_FOUND');
    }

    if (finalStats.isSymbolicLink()) {
      throw new ArchiveReadError('SYMLINK_NOT_ALLOWED');
    }

    const isLastSegment = index === segments.length - 1;
    if (!isLastSegment && !finalStats.isDirectory()) {
      throw new ArchiveReadError('NOT_A_FILE');
    }

    if (isLastSegment && !finalStats.isFile()) {
      throw new ArchiveReadError('NOT_A_FILE');
    }
  }

  const canonicalFile = await realpath(currentPath);
  const resolvedRelativePath = relative(canonicalRoot, canonicalFile);

  if (
    resolvedRelativePath.length === 0 ||
    resolvedRelativePath === '..' ||
    resolvedRelativePath.startsWith(`..${sep}`)
  ) {
    throw new ArchiveReadError('PATH_OUTSIDE_ARCHIVE');
  }

  if (!finalStats || finalStats.size > maxBytes) {
    throw new ArchiveReadError('FILE_TOO_LARGE');
  }

  return readFile(canonicalFile, 'utf8');
}
