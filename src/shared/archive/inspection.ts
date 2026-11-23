export type DetectedArchiveFormat = 'html' | 'json' | 'text' | 'image' | 'video' | 'audio' | 'other' | 'unknown';

export interface DiscoveredArchiveFile {
  relativePath: string;
  fileName: string;
  sectionKey: string;
  detectedFormat: DetectedArchiveFormat;
}

export interface ArchiveInspectionReport {
  archiveName: string;
  inspectedAt: string;
  snapshotId: string;
  accountId: string;
  totalFiles: number;
  totalDirectories: number;
  filesByFormat: {
    html: number;
    json: number;
    media: number;
    other: number;
  };
  sectionFileCounts: Record<string, number>;
  noDataSections: string[];
  skippedSymlinks: number;
  unreadableDirectories: number;
  truncated: boolean;
}
