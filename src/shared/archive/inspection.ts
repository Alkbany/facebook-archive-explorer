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

export interface ArchiveSnapshotSummary {
  id: string;
  accountName: string;
  backupName: string;
  status: string;
  createdAt: string;
  filesDiscovered: number;
  recordsImported: number;
}

export interface FriendsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

export interface ReactionsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

export interface ReactionRecordSummary {
  id: number;
  sourceFileId: number;
  sourcePath: string;
  sourceCardIndex: number;
  reactionType: string | null;
  descriptionRaw: string | null;
  dateRaw: string | null;
}

export interface MessagesImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
  mediaReferences: number;
}
