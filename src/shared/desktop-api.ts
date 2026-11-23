export interface AppInfo {
  appName: string;
  appVersion: string;
  platform: string;
}

export type DirectorySelectionResult =
  | { status: 'cancelled' }
  | { status: 'selected'; absolutePath: string };

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  selectBackupDirectory: 'archive:select-directory'
} as const;

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>;
  selectBackupDirectory(): Promise<DirectorySelectionResult>;
}
