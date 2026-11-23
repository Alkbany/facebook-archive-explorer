export interface ArchiveInspectionReport {
  archiveName: string;
  inspectedAt: string;
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
