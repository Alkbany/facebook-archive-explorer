import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { inspectArchiveZip } from '../src/main/import/discovery/zip-inventory';
import { getZipEntrySize, openZipEntryReadStream, readZipEntryBuffer } from '../src/main/import/discovery/zip-archive';
import { readArchiveBinaryFile, readArchiveUtf8File } from '../src/main/import/discovery/read-archive-file';

interface ZipFixtureEntry { name: string; content: Buffer; externalAttributes?: number; compressionMethod?: 0 | 8; }

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeDeflatedZip(entries: ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name, 'utf8');
    const data = item.content;
    const compressionMethod = item.compressionMethod ?? 8;
    const compressed = compressionMethod === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(item.externalAttributes ?? 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBytes, end]);
}

describe('ZIP archive reader and inventory', () => {
  it('reads a bounded entry without extracting the archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-zip-read-'));
    try {
      const zipPath = join(root, 'sample.zip');
      await writeFile(zipPath, makeDeflatedZip([
        { name: 'posts/your_posts.html', content: Buffer.from('<html>synthetic</html>') },
        { name: 'photos_and_videos/stored.mp4', content: Buffer.from('stored-media-range'), compressionMethod: 0 }
      ]));
      await expect(readZipEntryBuffer(zipPath, 'posts/your_posts.html', 1024))
        .resolves.toEqual(Buffer.from('<html>synthetic</html>'));
      await expect(readZipEntryBuffer(zipPath, 'posts/your_posts.html', 4))
        .rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
      await expect(readArchiveUtf8File(zipPath, 'posts/your_posts.html', 1024))
        .resolves.toBe('<html>synthetic</html>');
      await expect(readArchiveBinaryFile(zipPath, 'posts/your_posts.html', 1024))
        .resolves.toEqual(Buffer.from('<html>synthetic</html>'));
      await expect(getZipEntrySize(zipPath, 'posts/your_posts.html')).resolves.toBe(22);
      const opened = await openZipEntryReadStream(zipPath, 'posts/your_posts.html', 1, 5);
      const rangeChunks: Buffer[] = [];
      for await (const chunk of opened.stream) rangeChunks.push(Buffer.from(chunk));
      opened.close();
      expect(Buffer.concat(rangeChunks)).toEqual(Buffer.from('html>'));

      const storedRange = await openZipEntryReadStream(zipPath, 'photos_and_videos/stored.mp4', 2, 8);
      const storedChunks: Buffer[] = [];
      for await (const chunk of storedRange.stream) storedChunks.push(Buffer.from(chunk));
      storedRange.close();
      expect(Buffer.concat(storedChunks)).toEqual(Buffer.from('ored-me'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('batches ZIP inventory entries and respects a reduced entry cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-zip-batches-'));
    try {
      const zipPath = join(root, 'bounded.zip');
      await writeFile(zipPath, makeDeflatedZip(
        Array.from({ length: 5 }, (_, index) => ({
          name: 'posts/post-' + index + '.html',
          content: Buffer.from('<html>synthetic</html>')
        }))
      ));

      const batchSizes: number[] = [];
      const report = await inspectArchiveZip(zipPath, {
        snapshotId: 'snapshot-zip-batches',
        accountId: 'account-zip-batches',
        maxEntries: 3,
        batchSize: 2,
        onFilesFound: (files) => batchSizes.push(files.length)
      });

      expect(report.totalFiles).toBe(3);
      expect(report.truncated).toBe(true);
      expect(batchSizes).toEqual([2, 1]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal paths even when they are inside a ZIP central directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-zip-path-'));
    try {
      const zipPath = join(root, 'unsafe.zip');
      await writeFile(zipPath, makeDeflatedZip([
        { name: '../outside.html', content: Buffer.from('unsafe') }
      ]));
      await expect(inspectArchiveZip(zipPath, { snapshotId: 's', accountId: 'a' }))
        .rejects.toMatchObject({ code: 'INVALID_RELATIVE_PATH' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('inventories ZIP files by section and format without reading their payloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-zip-inventory-'));
    try {
      const zipPath = join(root, 'facebook-export.zip');
      await writeFile(zipPath, makeDeflatedZip([
        { name: 'friends/friends.html', content: Buffer.from('synthetic html') },
        { name: 'posts/your_posts.json', content: Buffer.from('{}') },
        { name: 'photos_and_videos/photo.jpg', content: Buffer.from('not-decoded-media') },
        { name: 'location/no-data.txt', content: Buffer.alloc(0) },
        { name: 'messages/', content: Buffer.alloc(0) }
      ]));
      const discovered: string[] = [];
      const discoveredSizes = new Map<string, number | null | undefined>();
      const report = await inspectArchiveZip(zipPath, {
        snapshotId: 'snapshot-zip',
        accountId: 'account-zip',
        onFilesFound: (files) => {
          discovered.push(...files.map((file) => file.relativePath));
          for (const file of files) discoveredSizes.set(file.relativePath, file.fileSizeBytes);
        }
      });
      expect(report.archiveName).toBe('facebook-export');
      expect(report.totalFiles).toBe(4);
      expect(report.totalDirectories).toBe(1);
      expect(report.filesByFormat).toEqual({ html: 1, json: 1, media: 1, other: 1 });
      expect(report.noDataSections).toEqual(['location']);
      expect(discovered).toEqual([
        'friends/friends.html',
        'posts/your_posts.json',
        'photos_and_videos/photo.jpg',
        'location/no-data.txt'
      ]);
      expect(discoveredSizes.get('friends/friends.html')).toBe(Buffer.byteLength('synthetic html'));
      expect(discoveredSizes.get('posts/your_posts.json')).toBe(2);
      expect(discoveredSizes.get('photos_and_videos/photo.jpg')).toBe(Buffer.byteLength('not-decoded-media'));
      expect(discoveredSizes.get('location/no-data.txt')).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
