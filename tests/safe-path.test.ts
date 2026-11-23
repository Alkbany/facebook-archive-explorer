import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { resolveArchivePath } from '../src/main/import/discovery/safe-path';

describe('resolveArchivePath', () => {
  const root = resolve('test-archive');

  it('resolves a normal relative path inside the archive', () => {
    const result = resolveArchivePath(root, 'messages/inbox/thread-1/index.html');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relativePath).toBe('messages/inbox/thread-1/index.html');
      expect(result.absolutePath.startsWith(root)).toBe(true);
    }
  });

  it('normalizes Windows separators on every platform', () => {
    const result = resolveArchivePath(root, 'photos\\album\\image.jpg');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.relativePath).toBe('photos/album/image.jpg');
  });

  it('rejects parent-directory traversal', () => {
    expect(resolveArchivePath(root, '../outside/secret.html')).toEqual({
      ok: false,
      reason: 'outside_root'
    });
  });

  it('rejects absolute POSIX and Windows paths', () => {
    expect(resolveArchivePath(root, '/private/secret.html')).toEqual({
      ok: false,
      reason: 'absolute_path'
    });
    expect(resolveArchivePath(root, 'C:\\Users\\someone\\secret.html')).toEqual({
      ok: false,
      reason: 'absolute_path'
    });
  });

  it('rejects empty paths and the archive root itself', () => {
    expect(resolveArchivePath(root, '')).toEqual({ ok: false, reason: 'empty_path' });
    expect(resolveArchivePath(root, '.')).toEqual({ ok: false, reason: 'outside_root' });
  });

  it('rejects NUL bytes', () => {
    expect(resolveArchivePath(root, 'folder/invalid\0name.html')).toEqual({
      ok: false,
      reason: 'invalid_path'
    });
  });
});
