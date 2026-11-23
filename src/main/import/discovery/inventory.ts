import { opendir, realpath } from 'node:fs/promises';
import type { Dir } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import type {
  ArchiveInspectionReport,
  DetectedArchiveFormat,
  DiscoveredArchiveFile
} from '../../../shared/archive/inspection';
import { getArchiveSection } from '../../../shared/archive/section-registry';

const MAX_ENTRIES = 100_000;
const BATCH_SIZE = 500;
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.tif', '.tiff', '.jfif'
]);
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.3gp', '.3gpp'
]);
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac'
]);

export interface ArchiveInventoryOptions {
  snapshotId: string;
  accountId: string;
  onFileFound?: (file: DiscoveredArchiveFile) => void;
}

function sectionForPath(relativePath: string): string {
  const segments = relativePath.split(/[\\/]/u);
  if (segments.length === 1) return 'root';
  const firstSegment = segments[0];
  return getArchiveSection(firstSegment)?.key ?? firstSegment;
}

function detectFormat(fileName: string): DetectedArchiveFormat {
  const extension = extname(fileName).toLocaleLowerCase();
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.json') return 'json';
  if (extension === '.txt') return 'text';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  return 'other';
}

/**
 * Inventories names and file types only. It does not read file contents,
 * follow symlinks, extract ZIPs, or modify the selected source directory.
 * Directory entries are streamed and discovered file metadata is delivered
 * in batches by the caller. The total number of entries is bounded for safety.
 */
export async function inspectArchiveDirectory(
  selectedDirectory: string,
  options: ArchiveInventoryOptions
): Promise<ArchiveInspectionReport> {
  const root = await realpath(selectedDirectory);
  const stack = [root];
  const report: ArchiveInspectionReport = {
    archiveName: basename(root),
    inspectedAt: new Date().toISOString(),
    snapshotId: options.snapshotId,
    accountId: options.accountId,
    totalFiles: 0,
    totalDirectories: 0,
    filesByFormat: { html: 0, json: 0, media: 0, other: 0 },
    sectionFileCounts: {},
    noDataSections: [],
    skippedSymlinks: 0,
    unreadableDirectories: 0,
    truncated: false
  };
  const noDataSections = new Set<string>();
  let visitedEntries = 0;
  let batch: DiscoveredArchiveFile[] = [];

  const flushBatch = () => {
    if (batch.length === 0) return;
    options.onFileFound?.(batch as DiscoveredArchiveFile[] [number]);
    batch = [];
  };

  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    if (!currentDirectory) continue;

    let directory: Dir;
    try {
      directory = await opendir(currentDirectory);
    } catch {
      report.unreadableDirectories += 1;
      continue;
    }

    try {
      for await (const entry of directory) {
        visitedEntries += 1;
        if (visitedEntries > MAX_ENTRIES) {
          report.truncated = true;
          stack.length = 0;
          break;
        }

        if (entry.isSymbolicLink()) {
          report.skippedSymlinks += 1;
          continue;
        }

        const absolutePath = join(currentDirectory, entry.name);
        const relativePath = relative(root, absolutePath).split(sep).join('/');

        if (entry.isDirectory()) {
          report.totalDirectories += 1;
          stack.push(absolutePath);
          continue;
        }

        if (!entry.isFile()) continue;

        const sectionKey = sectionForPath(relativePath);
        const detectedFormat = detectFormat(entry.name);
        report.totalFiles += 1;
        report.sectionFileCounts[sectionKey] = (report.sectionFileCounts[sectionKey] ?? 0) + 1;

        if (detectedFormat === 'html') report.filesByFormat.html += 1;
        else if (detectedFormat === 'json') report.filesByFormat.json += 1;
        else if (detectedFormat === 'image' || detectedFormat === 'video' || detectedFormat === 'audio') {
          report.filesByFormat.media += 1;
        } else {
          report.filesByFormat.other += 1;
        }

        if (entry.name.toLocaleLowerCase() === 'no-data.txt') {
          noDataSections.add(sectionKey);
        }

        batch.push({
          relativePath,
          fileName: entry.name,
          sectionKey,
          detectedFormat
        });

        if (batch.length >= BATCH_SIZE) flushBatch();
      }
    } catch {
      report.unreadableDirectories += 1;
    }
  }

  flushBatch();
  report.noDataSections = [...noDataSections].sort();
  return report;
}
