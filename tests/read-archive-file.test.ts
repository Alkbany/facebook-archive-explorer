import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArchiveReadError, readArchiveUtf8File } from '../src/main/import/discovery/read-archive-file';

describe('readArchiveUtf8File', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'archive-reader-test-'));
    outside = await mkdtemp(join(tmpdir(), 'archive-reader-outside-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('reads a text file inside the archive', async () => {
    await mkdir(join(root, 'friends'), { recursive: true });
    await writeFile(join(root, 'friends', 'friends.html'), '<html>synthetic</html>');

    await expect(readArchiveUtf8File(root, 'friends/friends.html'))
      .resolves.toBe('<html>synthetic</html>');
  });

  it('rejects parent traversal and absolute paths', async () => {
    await expect(readArchiveUtf8File(root, '../outside.html'))
      .rejects.toMatchObject({ code: 'PATH_OUTSIDE_ARCHIVE' });
    await expect(readArchiveUtf8File(root, join(outside, 'secret.html')))
      .rejects.toBeInstanceOf(ArchiveReadError);
  });

  it('rejects symbolic links instead of following them', async () => {
    const outsideFile = join(outside, 'secret.html');
    await writeFile(outsideFile, '<html>outside</html>');
    await symlink(outsideFile, join(root, 'linked.html'));

    await expect(readArchiveUtf8File(root, 'linked.html'))
      .rejects.toMatchObject({ code: 'SYMLINK_NOT_ALLOWED' });
  });

  it('rejects files above the configured size limit', async () => {
    await writeFile(join(root, 'large.html'), '1234567890');

    await expect(readArchiveUtf8File(root, 'large.html', 5))
      .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });
});
