import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type DesktopApi } from '../shared/desktop-api';

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  selectBackupDirectory: (accountName) =>
    ipcRenderer.invoke(IPC_CHANNELS.selectBackupDirectory, accountName),
  inspectSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.inspectSelectedBackup),
  listArchiveSnapshots: () => ipcRenderer.invoke(IPC_CHANNELS.listArchiveSnapshots),
  importFriendsForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importFriendsForSelectedBackup),
  importMessagesForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.importMessagesForSelectedBackup),
  listMessagesForSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.listMessagesForSelectedBackup),
  getMessagesForSelectedConversation: (sourceFileId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getMessagesForSelectedConversation, sourceFileId),
  getMessageImagePreview: (mediaAssetId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getMessageImagePreview, mediaAssetId)
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
