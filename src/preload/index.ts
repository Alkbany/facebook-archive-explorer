import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type DesktopApi } from '../shared/desktop-api';
import type { ImportProgressEvent } from '../shared/archive/inspection';

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  exportLocalDatabaseBackup: () => ipcRenderer.invoke(IPC_CHANNELS.exportLocalDatabaseBackup),
  restoreLocalDatabaseBackup: () => ipcRenderer.invoke(IPC_CHANNELS.restoreLocalDatabaseBackup),
  selectBackupDirectory: (accountName) =>
    ipcRenderer.invoke(IPC_CHANNELS.selectBackupDirectory, accountName),
  inspectSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.inspectSelectedBackup),
  listArchiveSnapshots: () => ipcRenderer.invoke(IPC_CHANNELS.listArchiveSnapshots),
  listImportIssuesForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listImportIssuesForSelectedBackup),
  getImportCoverageForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.getImportCoverageForSelectedBackup),
  listFallbackRecordSectionsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listFallbackRecordSectionsForSelectedBackup),
  listFallbackArchiveRecordsForSelectedBackup: (sectionKey, page, query = '') => ipcRenderer.invoke(IPC_CHANNELS.listFallbackArchiveRecordsForSelectedBackup, sectionKey, page, query),
  pauseImport: () => ipcRenderer.invoke(IPC_CHANNELS.pauseImport),
  resumeImport: () => ipcRenderer.invoke(IPC_CHANNELS.resumeImport),
  onImportProgress: (listener) => {
    const wrappedListener = (_event: unknown, value: unknown) => {
      if (typeof value !== 'object' || value === null) return;
      listener(value as ImportProgressEvent);
    };
    ipcRenderer.on(IPC_CHANNELS.importProgress, wrappedListener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.importProgress, wrappedListener);
  },
  openSavedSnapshot: (snapshotId) => ipcRenderer.invoke(IPC_CHANNELS.openSavedSnapshot, snapshotId),
  importFriendsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importFriendsForSelectedBackup),
  listFriendsDirectoryForSelectedBackup: (filter, query, page) =>
    ipcRenderer.invoke(IPC_CHANNELS.listFriendsDirectoryForSelectedBackup, filter, query, page),
  listArchiveFilesForSelectedBackup: (status, sectionKey, query, page) =>
    ipcRenderer.invoke(IPC_CHANNELS.listArchiveFilesForSelectedBackup, status, sectionKey, query, page),
  importAllSupportedDataForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importAllSupportedDataForSelectedBackup),
  importPhotosAndVideosForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importPhotosAndVideosForSelectedBackup),
  importPostsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importPostsForSelectedBackup),
  importCommentsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importCommentsForSelectedBackup),
  listCommentsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listCommentsForSelectedBackup),
  listPostsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listPostsForSelectedBackup),
  importMessagesForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importMessagesForSelectedBackup),
  importReactionsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importReactionsForSelectedBackup),
  listReactionsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listReactionsForSelectedBackup),
  listPhotoAlbumsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listPhotoAlbumsForSelectedBackup),
  getPhotoAlbumDetailForSelectedBackup: (albumRecordId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getPhotoAlbumDetailForSelectedBackup, albumRecordId),
  listMessagesForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listMessagesForSelectedBackup),
  listMessageMediaForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listMessageMediaForSelectedBackup),
  getMessagesForSelectedConversation: (sourceFileId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getMessagesForSelectedConversation, sourceFileId),
  getMessageMediaPreview: (mediaAssetId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getMessageMediaPreview, mediaAssetId),
  listMediaForSelectedBackup: (filter, page, query, pageSize) => ipcRenderer.invoke(IPC_CHANNELS.listMediaForSelectedBackup, filter, page, query, pageSize),
  getArchiveSearchSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getArchiveSearchSettings),
  setIncludeMessagesInGlobalSearch: (enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.setIncludeMessagesInGlobalSearch, enabled),
  getSemanticSearchStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getSemanticSearchStatus),
  setSemanticSearchEnabled: (enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.setSemanticSearchEnabled, enabled),
  retrySemanticIndexing: () => ipcRenderer.invoke(IPC_CHANNELS.retrySemanticIndexing),
  getAiAssistantStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getAiAssistantStatus),
  setAiAssistantEnabled: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.setAiAssistantEnabled, enabled),
  askArchiveAssistant: (question, sectionKey, history) =>
    ipcRenderer.invoke(IPC_CHANNELS.askArchiveAssistant, question, sectionKey, history),
  searchRecordsForSelectedBackup: (query, sectionKey, mode, similarityThreshold) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchRecordsForSelectedBackup, query, sectionKey, mode, similarityThreshold),
  exportSearchResultsForSelectedBackup: (query, sectionKey, mode, similarityThreshold) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportSearchResultsForSelectedBackup, query, sectionKey, mode, similarityThreshold),
  compareArchiveSnapshots: (baselineSnapshotId, comparedSnapshotId) =>
    ipcRenderer.invoke(IPC_CHANNELS.compareArchiveSnapshots, baselineSnapshotId, comparedSnapshotId),
  listArchiveComparisonChanges: (baselineSnapshotId, comparedSnapshotId, filter, sectionKey, query, page) =>
    ipcRenderer.invoke(IPC_CHANNELS.listArchiveComparisonChanges, baselineSnapshotId, comparedSnapshotId, filter, sectionKey, query, page),
  exportArchiveComparisonChanges: (baselineSnapshotId, comparedSnapshotId, filter, sectionKey, query, format) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportArchiveComparisonChanges, baselineSnapshotId, comparedSnapshotId, filter, sectionKey, query, format)
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
