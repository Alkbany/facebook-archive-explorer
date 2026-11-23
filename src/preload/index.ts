import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type DesktopApi } from '../shared/desktop-api';

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  selectBackupDirectory: (accountName) =>
    ipcRenderer.invoke(IPC_CHANNELS.selectBackupDirectory, accountName),
  inspectSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.inspectSelectedBackup),
  listArchiveSnapshots: () => ipcRenderer.invoke(IPC_CHANNELS.listArchiveSnapshots),
  importFriendsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importFriendsForSelectedBackup),
  importPostsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importPostsForSelectedBackup),
  listPostsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listPostsForSelectedBackup),
  importMessagesForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importMessagesForSelectedBackup),
  importReactionsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importReactionsForSelectedBackup),
  listReactionsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listReactionsForSelectedBackup),
  listMessagesForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listMessagesForSelectedBackup),
  listMessageMediaForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listMessageMediaForSelectedBackup),
  getMessagesForSelectedConversation: (sourceFileId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getMessagesForSelectedConversation, sourceFileId),
  getMessageMediaPreview: (mediaAssetId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getMessageMediaPreview, mediaAssetId)
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
