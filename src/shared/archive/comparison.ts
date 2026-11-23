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


export type ArchiveComparisonChangeKind = 'all' | 'added' | 'removed' | 'changed';

export interface ArchiveComparisonChangeItem {
  changeKind: Exclude<ArchiveComparisonChangeKind, 'all'>;
  sectionKey: string;
  sourcePath: string;
  sourceCardIndex: number;
  previousRecordType: string | null;
  previousTitle: string | null;
  previousBody: string | null;
  previousDateRaw: string | null;
  comparedRecordType: string | null;
  comparedTitle: string | null;
  comparedBody: string | null;
  comparedDateRaw: string | null;
}

export interface ArchiveComparisonChangesPage {
  changes: ArchiveComparisonChangeItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type ArchiveComparisonExportFormat = 'csv' | 'json';

export type ArchiveComparisonExportResult =
  | { status: 'cancelled' }
  | { status: 'saved'; fileName: string; recordsExported: number; format: ArchiveComparisonExportFormat };
