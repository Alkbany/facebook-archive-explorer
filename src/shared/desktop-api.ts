import type { MessageConversationSummary, MessageMediaGalleryItem, MessageRecordSummary } from './archive/messages';
import type {
  ArchiveInspectionReport,
  ArchiveSnapshotSummary,
  FriendsImportSectionResult,
  PostsImportSectionResult,
  PostRecordSummary,
  MessagesImportSectionResult,
  ReactionsImportSectionResult,
  ReactionRecordSummary
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
  importPostsForSelectedBackup: 'archive:import-posts',
  listPostsForSelectedBackup: 'archive:list-posts',
  importMessagesForSelectedBackup: 'archive:import-messages',
  importReactionsForSelectedBackup: 'archive:import-reactions',
  listReactionsForSelectedBackup: 'archive:list-reactions',
  listMessagesForSelectedBackup: 'archive:list-messages',
  listMessageMediaForSelectedBackup: 'archive:list-message-media',
  getMessagesForSelectedConversation: 'archive:get-conversation-messages',
  getMessageMediaPreview: 'archive:get-message-media-preview'
} as const;

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>;
  selectBackupDirectory(accountName: string): Promise<DirectorySelectionResult>;
  inspectSelectedBackup(): Promise<ArchiveInspectionReport>;
  listArchiveSnapshots(): Promise<ArchiveSnapshotSummary[]>;
  importFriendsForSelectedBackup(): Promise<FriendsImportSectionResult>;
  importPostsForSelectedBackup(): Promise<PostsImportSectionResult>;
  listPostsForSelectedBackup(): Promise<PostRecordSummary[]>;
  importMessagesForSelectedBackup(): Promise<MessagesImportSectionResult>;
  importReactionsForSelectedBackup(): Promise<ReactionsImportSectionResult>;
  listReactionsForSelectedBackup(): Promise<ReactionRecordSummary[]>;
  listMessagesForSelectedBackup(): Promise<MessageConversationSummary[]>;
  listMessageMediaForSelectedBackup(): Promise<MessageMediaGalleryItem[]>;
  getMessagesForSelectedConversation(sourceFileId: number): Promise<MessageRecordSummary[]>;
  getMessageMediaPreview(mediaAssetId: number): Promise<string>;
}
