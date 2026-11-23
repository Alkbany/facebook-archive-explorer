import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type DesktopApi } from '../shared/desktop-api';

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  selectBackupDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectBackupDirectory),
  inspectSelectedBackup: () => ipcRenderer.invoke(IPC_CHANNELS.inspectSelectedBackup)
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
