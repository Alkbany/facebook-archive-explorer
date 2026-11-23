import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectArchiveDirectory } from '../src/main/import/discovery/inventory';

describe('inspectArchiveDirectory', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'archive-explorer-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('counts files by format, classifies sections, and emits metadata in batches', async () => {
    await mkdir(join(root, 'following_and_followers'), { recursive: true });
    await mkdir(join(root, 'photos_and_videos'), { recursive: true });
    await mkdir(join(root, 'profile_information'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<html>synthetic index</html>');
    await writeFile(join(root, 'following_and_followers', 'followers.html'), '<html>synthetic followers</html>');
    await writeFile(join(root, 'photos_and_videos', 'sample.jpg'), 'synthetic-media');
    await writeFile(join(root, 'profile_information', 'profile.json'), '{}');

    const discovered: string[] = [];
    const report = await inspectArchiveDirectory(root, {
      snapshotId: 'snapshot-test',
      accountId: 'account-test',
      onFilesFound: (files) => discovered.push(...files.map((file) => file.relativePath))
    });

    expect(report.snapshotId).toBe('snapshot-test');
    expect(report.accountId).toBe('account-test');
    expect(report.totalFiles).toBe(4);
    expect(report.totalDirectories).toBe(3);
    expect(report.filesByFormat).toEqual({ html: 2, json: 1, media: 1, other: 0 });
    expect(report.sectionFileCounts.following_and_followers).toBe(1);
    expect(report.sectionFileCounts.photos_and_videos).toBe(1);
    expect(report.sectionFileCounts.profile_information).toBe(1);
    expect(report.sectionFileCounts.root).toBe(1);
    expect(discovered).toHaveLength(4);
    expect(discovered).toContain('index.html');
    expect(report.truncated).toBe(false);
  });

  it('emits predictable metadata batches without loading file contents', async () => {
    for (let index = 0; index < 5; index += 1) {
      await writeFile(join(root, 'file-' + index + '.html'), '<html>synthetic ' + index + '</html>');
    }

    const batchSizes: number[] = [];
    const report = await inspectArchiveDirectory(root, {
      snapshotId: 'snapshot-batches',
      accountId: 'account-batches',
      batchSize: 2,
      onFilesFound: (files) => batchSizes.push(files.length)
    });

    expect(report.totalFiles).toBe(5);
    expect(report.truncated).toBe(false);
    expect(batchSizes).toEqual([2, 2, 1]);
  });

  it('honors a reduced entry cap and marks the inventory as truncated', async () => {
    for (let index = 0; index < 5; index += 1) {
      await writeFile(join(root, 'capped-' + index + '.html'), '<html>synthetic</html>');
    }

    const discovered: string[] = [];
    const report = await inspectArchiveDirectory(root, {
      snapshotId: 'snapshot-capped',
      accountId: 'account-capped',
      maxEntries: 3,
      onFilesFound: (files) => discovered.push(...files.map((file) => file.relativePath))
    });

    expect(report.totalFiles).toBe(3);
    expect(discovered).toHaveLength(3);
    expect(report.truncated).toBe(true);
  });

  it('records explicit no-data markers without treating them as parsed content', async () => {
    await mkdir(join(root, 'location'), { recursive: true });
    await mkdir(join(root, 'your_places'), { recursive: true });
    await writeFile(join(root, 'location', 'no-data.txt'), '');
    await writeFile(join(root, 'your_places', 'no-data.txt'), '');

    const discoveredFormats: string[] = [];
    const report = await inspectArchiveDirectory(root, {
      snapshotId: 'snapshot-test',
      accountId: 'account-test',
      onFilesFound: (files) => discoveredFormats.push(...files.map((file) => file.detectedFormat))
    });

    expect(report.totalFiles).toBe(2);
    expect(report.noDataSections).toEqual(['location', 'your_places']);
    expect(report.filesByFormat.other).toBe(2);
    expect(discoveredFormats).toEqual(['text', 'text']);
  });
});
