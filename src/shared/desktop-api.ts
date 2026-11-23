import type {
  ArchiveInspectionReport,
  ArchiveSnapshotSummary
} from './archive/inspection';

export interface AppInfo {
  appName: string;
  appVersion: string;
  platform: string;
}

export type DirectorySelectionResult =
  | { status: 'cancelled' }
  | { status: 'selected'; folderName: string; accountName: string };

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  selectBackupDirectory: 'archive:select-directory',
  inspectSelectedBackup: 'archive:inspect-selected',
  listArchiveSnapshots: 'archive:list-snapshots'
} as const;

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>;
  selectBackupDirectory(accountName: string): Promise<DirectorySelectionResult>;
  inspectSelectedBackup(): Promise<ArchiveInspectionReport>;
  listArchiveSnapshots(): Promise<ArchiveSnapshotSummary[]>;
}
