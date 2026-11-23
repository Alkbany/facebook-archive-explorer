import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';

export type SafePathResult =
  | { ok: true; absolutePath: string; relativePath: string }
  | { ok: false; reason: 'empty_path' | 'invalid_path' | 'absolute_path' | 'outside_root' };

/**
 * Resolve an archive-relative path without allowing it to escape the selected
 * archive root. Callers must additionally reject symlinks after filesystem
 * resolution when opening real files.
 */
export function resolveArchivePath(rootPath: string, archivePath: string): SafePathResult {
  if (!archivePath) return { ok: false, reason: 'empty_path' };
  if (archivePath.includes('\0')) return { ok: false, reason: 'invalid_path' };

  // Reject POSIX, Windows, UNC, and drive-relative paths regardless of host OS.
  if (
    isAbsolute(archivePath) ||
    win32.isAbsolute(archivePath) ||
    /^[a-zA-Z]:/.test(archivePath) ||
    archivePath.startsWith('\\\\')
  ) {
    return { ok: false, reason: 'absolute_path' };
  }

  const root = resolve(rootPath);
  const portablePath = archivePath.replace(/[\\/]+/gu, sep);
  const absolutePath = resolve(root, portablePath);
  const relativePath = relative(root, absolutePath);

  if (
    relativePath.length === 0 ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return { ok: false, reason: 'outside_root' };
  }

  return {
    ok: true,
    absolutePath,
    relativePath: relativePath.split(sep).join('/')
  };
}
