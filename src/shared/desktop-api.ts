import type { MessageConversationSummary, MessageMediaGalleryItem, MessageRecordSummary } from './archive/messages';
import type { ArchiveMediaGalleryItem } from './archive/media';
import type { ArchiveSearchResult, SearchExportResult } from './archive/search';
import type { ArchiveComparisonReport } from './archive/comparison';
import type {
  ArchiveInspectionReport,
  ArchiveInspectionView,
  ArchiveSnapshotSummary,
  FriendsImportSectionResult,
  PostsImportSectionResult,
  CommentsImportSectionResult,
  CommentActivitySummary,
  PostRecordSummary,
  MessagesImportSectionResult,
  ReactionsImportSectionResult,
  ReactionRecordSummary,
  PhotoAlbumRecordSummary,
  PhotoAlbumDetailView,
  ImportAllSupportedDataResult,
  ImportIssueReport,
  ImportCoverageReport,
  ImportProgressEvent
} from './archive/inspection';

export interface AppInfo {
  appName: string;
  appVersion: string;
  platform: string;
}

export type DirectorySelectionResult =
  | { status: 'cancelled' }
  | { status: 'selected'; folderName: string; accountName: string };

export type DatabaseBackupExportResult =
  | { status: 'cancelled' }
  | { status: 'saved'; fileName: string; pagesCopied: number; sizeBytes: number };

export type DatabaseBackupRestoreResult = { status: 'cancelled' | 'restarting' };

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  exportLocalDatabaseBackup: 'database:export-backup',
  restoreLocalDatabaseBackup: 'database:restore-backup',
  selectBackupDirectory: 'archive:select-directory',
  inspectSelectedBackup: 'archive:inspect-selected',
  listArchiveSnapshots: 'archive:list-snapshots',
  listImportIssuesForSelectedBackup: 'archive:list-import-issues',
  getImportCoverageForSelectedBackup: 'archive:get-import-coverage',
  importProgress: 'archive:import-progress',
  openSavedSnapshot: 'archive:open-saved-snapshot',
  importFriendsForSelectedBackup: 'archive:import-friends',
  importAllSupportedDataForSelectedBackup: 'archive:import-all-supported-data',
  importPostsForSelectedBackup: 'archive:import-posts',
  importCommentsForSelectedBackup: 'archive:import-comments',
  listCommentsForSelectedBackup: 'archive:list-comments',
  listPostsForSelectedBackup: 'archive:list-posts',
  importMessagesForSelectedBackup: 'archive:import-messages',
  importReactionsForSelectedBackup: 'archive:import-reactions',
  listReactionsForSelectedBackup: 'archive:list-reactions',
  listPhotoAlbumsForSelectedBackup: 'archive:list-photo-albums',
  getPhotoAlbumDetailForSelectedBackup: 'archive:get-photo-album-detail',
  listMessagesForSelectedBackup: 'archive:list-messages',
  listMessageMediaForSelectedBackup: 'archive:list-message-media',
  getMessagesForSelectedConversation: 'archive:get-conversation-messages',
  getMessageMediaPreview: 'archive:get-message-media-preview',
  listMediaForSelectedBackup: 'archive:list-media',
  searchRecordsForSelectedBackup: 'archive:search-records',
  exportSearchResultsForSelectedBackup: 'archive:export-search-results',
  compareArchiveSnapshots: 'archive:compare-snapshots'
} as const;

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>;
  exportLocalDatabaseBackup(): Promise<DatabaseBackupExportResult>;
  restoreLocalDatabaseBackup(): Promise<DatabaseBackupRestoreResult>;
  selectBackupDirectory(accountName: string): Promise<DirectorySelectionResult>;
  inspectSelectedBackup(): Promise<ArchiveInspectionReport>;
  listArchiveSnapshots(): Promise<ArchiveSnapshotSummary[]>;
  listImportIssuesForSelectedBackup(): Promise<ImportIssueReport>;
  getImportCoverageForSelectedBackup(): Promise<ImportCoverageReport>;
  onImportProgress(listener: (progress: ImportProgressEvent) => void): () => void;
  openSavedSnapshot(snapshotId: string): Promise<ArchiveInspectionView>;
  importFriendsForSelectedBackup(): Promise<FriendsImportSectionResult>;
  importAllSupportedDataForSelectedBackup(): Promise<ImportAllSupportedDataResult>;
  importPostsForSelectedBackup(): Promise<PostsImportSectionResult>;
  listPostsForSelectedBackup(): Promise<PostRecordSummary[]>;
  importCommentsForSelectedBackup(): Promise<CommentsImportSectionResult>;
  listCommentsForSelectedBackup(): Promise<CommentActivitySummary[]>;
  importMessagesForSelectedBackup(): Promise<MessagesImportSectionResult>;
  importReactionsForSelectedBackup(): Promise<ReactionsImportSectionResult>;
  listReactionsForSelectedBackup(): Promise<ReactionRecordSummary[]>;
  listPhotoAlbumsForSelectedBackup(): Promise<PhotoAlbumRecordSummary[]>;
  getPhotoAlbumDetailForSelectedBackup(albumRecordId: number): Promise<PhotoAlbumDetailView>;
  listMessagesForSelectedBackup(): Promise<MessageConversationSummary[]>;
  listMessageMediaForSelectedBackup(): Promise<MessageMediaGalleryItem[]>;
  getMessagesForSelectedConversation(sourceFileId: number): Promise<MessageRecordSummary[]>;
  getMessageMediaPreview(mediaAssetId: number): Promise<string>;
  listMediaForSelectedBackup(): Promise<ArchiveMediaGalleryItem[]>;
  searchRecordsForSelectedBackup(query: string, sectionKey: string | null): Promise<ArchiveSearchResult[]>;
  exportSearchResultsForSelectedBackup(query: string, sectionKey: string | null): Promise<SearchExportResult>;
  compareArchiveSnapshots(baselineSnapshotId: string, comparedSnapshotId: string): Promise<ArchiveComparisonReport>;
}
