import { basename, extname } from 'node:path';
import type {
  ArchiveInspectionReport,
  DetectedArchiveFormat,
  DiscoveredArchiveFile
} from '../../../shared/archive/inspection';
import type { ArchiveInventoryOptions } from './inventory';
import { getSectionKeyForArchivePath } from './section-path';
import {
  forEachZipEntry,
  getSafeZipEntryPath,
  isZipDirectoryEntry,
  isZipSymbolicLinkEntry
} from './zip-archive';

const MAX_ENTRIES = 100_000;
const BATCH_SIZE = 500;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.tif', '.tiff', '.jfif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.3gp', '.3gpp']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac']);

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

/** Inventories the ZIP central directory without extracting entries or reading their contents. */
export async function inspectArchiveZip(
  selectedZipPath: string,
  options: ArchiveInventoryOptions
): Promise<ArchiveInspectionReport> {
  const report: ArchiveInspectionReport = {
    archiveName: basename(selectedZipPath, extname(selectedZipPath)),
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
  const maxEntries = Number.isSafeInteger(options.maxEntries)
    ? Math.max(1, Math.min(MAX_ENTRIES, options.maxEntries as number))
    : MAX_ENTRIES;
  const batchSize = Number.isSafeInteger(options.batchSize)
    ? Math.max(1, Math.min(5_000, options.batchSize as number))
    : BATCH_SIZE;
  let batch: DiscoveredArchiveFile[] = [];
  const flushBatch = () => {
    if (batch.length === 0) return;
    options.onFilesFound?.(batch);
    batch = [];
  };

  const iteration = await forEachZipEntry(selectedZipPath, (entry) => {
    if (isZipSymbolicLinkEntry(entry)) {
      report.skippedSymlinks += 1;
      return;
    }
    if (isZipDirectoryEntry(entry)) {
      report.totalDirectories += 1;
      return;
    }

    const relativePath = getSafeZipEntryPath(entry);
    const fileName = basename(relativePath);
    const sectionKey = getSectionKeyForArchivePath(relativePath);
    const detectedFormat = detectFormat(fileName);
    report.totalFiles += 1;
    report.sectionFileCounts[sectionKey] = (report.sectionFileCounts[sectionKey] ?? 0) + 1;

    if (detectedFormat === 'html') report.filesByFormat.html += 1;
    else if (detectedFormat === 'json') report.filesByFormat.json += 1;
    else if (['image', 'video', 'audio'].includes(detectedFormat)) report.filesByFormat.media += 1;
    else report.filesByFormat.other += 1;

    if (fileName.toLocaleLowerCase() === 'no-data.txt') noDataSections.add(sectionKey);
    batch.push({ relativePath, fileName, sectionKey, detectedFormat, fileSizeBytes: entry.uncompressedSize });
    if (batch.length >= batchSize) flushBatch();
  }, maxEntries);

  flushBatch();
  report.truncated = iteration.truncated;
  report.noDataSections = [...noDataSections].sort();
  return report;
}
