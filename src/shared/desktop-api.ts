import type { MessageConversationSummary, MessageRecordSummary } from './archive/messages';
import type {
  ArchiveInspectionReport,
  ArchiveSnapshotSummary,
  FriendsImportSectionResult,
  MessagesImportSectionResult
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
  listArchiveSnapshots: 'archive:list-snapshots',
  importFriendsForSelectedBackup: 'archive:import-friends',
  importMessagesForSelectedBackup: 'archive:import-messages',
  listMessagesForSelectedBackup: 'archive:list-messages',
  getMessagesForSelectedConversation: 'archive:get-conversation-messages',
  getMessageMediaPreview: 'archive:get-message-media-preview'
} as const;

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>;
  selectBackupDirectory(accountName: string): Promise<DirectorySelectionResult>;
  inspectSelectedBackup(): Promise<ArchiveInspectionReport>;
  listArchiveSnapshots(): Promise<ArchiveSnapshotSummary[]>;
  importFriendsForSelectedBackup(): Promise<FriendsImportSectionResult>;
  importMessagesForSelectedBackup(): Promise<MessagesImportSectionResult>;
  listMessagesForSelectedBackup(): Promise<MessageConversationSummary[]>;
  getMessagesForSelectedConversation(sourceFileId: number): Promise<MessageRecordSummary[]>;
  getMessageMediaPreview(mediaAssetId: number): Promise<string>;
}
