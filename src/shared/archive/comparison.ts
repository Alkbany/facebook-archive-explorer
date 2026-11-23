export interface ArchiveComparisonSection {
  sectionKey: string;
  added: number;
  removed: number;
  changed: number;
}
export interface ArchiveComparisonReport {
  baseline: { id: string; backupName: string; createdAt: string; files: number; records: number };
  compared: { id: string; backupName: string; createdAt: string; files: number; records: number };
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  sections: ArchiveComparisonSection[];
}
