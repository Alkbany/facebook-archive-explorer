import { app, dialog, ipcMain } from 'electron';
import { IPC_CHANNELS, type AppInfo, type DirectorySelectionResult } from '../../shared/desktop-api';

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, (): AppInfo => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    platform: process.platform
  }));

  ipcMain.handle(
    IPC_CHANNELS.selectBackupDirectory,
    async (): Promise<DirectorySelectionResult> => {
      const result = await dialog.showOpenDialog({
        title: 'Choose your Facebook export folder',
        buttonLabel: 'Select folder',
        properties: ['openDirectory', 'dontAddToRecent']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { status: 'cancelled' };
      }

      return { status: 'selected', absolutePath: result.filePaths[0] };
    }
  );
}
