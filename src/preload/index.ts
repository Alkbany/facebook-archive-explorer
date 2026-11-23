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
  importAllSupportedDataForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importAllSupportedDataForSelectedBackup),
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
  listMediaForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listMediaForSelectedBackup),
  searchRecordsForSelectedBackup: (query, sectionKey) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchRecordsForSelectedBackup, query, sectionKey),
  exportSearchResultsForSelectedBackup: (query, sectionKey) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportSearchResultsForSelectedBackup, query, sectionKey),
  compareArchiveSnapshots: (baselineSnapshotId, comparedSnapshotId) =>
    ipcRenderer.invoke(IPC_CHANNELS.compareArchiveSnapshots, baselineSnapshotId, comparedSnapshotId)
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
