import { readdir, realpath } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import type { ArchiveInspectionReport } from '../../../shared/archive/inspection';
import { getArchiveSection } from '../../../shared/archive/section-registry';

const MAX_ENTRIES = 100_000;
const MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic',
  '.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.mp3',
  '.m4a', '.aac', '.wav', '.ogg', '.opus', '.pdf'
]);

function sectionForPath(relativePath: string): string {
  const segments = relativePath.split(/[\\/]/u);
  if (segments.length === 1) return 'root';
  const firstSegment = segments[0];
  return getArchiveSection(firstSegment)?.key ?? firstSegment;
}

function formatForFile(fileName: string): keyof ArchiveInspectionReport['filesByFormat'] {
  const extension = extname(fileName).toLocaleLowerCase();
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.json') return 'json';
  if (MEDIA_EXTENSIONS.has(extension)) return 'media';
  return 'other';
}

/**
 * Inventories names and file types only. It does not read file contents,
 * follow symlinks, extract ZIPs, or modify the selected source directory.
 */
export async function inspectArchiveDirectory(
  selectedDirectory: string
): Promise<ArchiveInspectionReport> {
  const root = await realpath(selectedDirectory);
  const stack = [root];
  const report: ArchiveInspectionReport = {
    archiveName: basename(root),
    inspectedAt: new Date().toISOString(),
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

  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    if (!currentDirectory) continue;

    let entries: Dirent[];
    try {
      entries = await readdir(currentDirectory, { withFileTypes: true });
    } catch {
      report.unreadableDirectories += 1;
      continue;
    }

    for (const entry of entries) {
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

      report.totalFiles += 1;
      const sectionKey = sectionForPath(relativePath);
      report.sectionFileCounts[sectionKey] = (report.sectionFileCounts[sectionKey] ?? 0) + 1;
      report.filesByFormat[formatForFile(entry.name)] += 1;

      if (entry.name.toLocaleLowerCase() === 'no-data.txt') {
        noDataSections.add(sectionKey);
      }
    }
  }

  report.noDataSections = [...noDataSections].sort();
  return report;
}
