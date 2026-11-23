import { app, dialog, ipcMain } from 'electron';
import { basename } from 'node:path';
import { IPC_CHANNELS, type AppInfo, type DirectorySelectionResult } from '../../shared/desktop-api';
import { inspectArchiveDirectory } from '../import/discovery/inventory';

let selectedBackupDirectory: string | null = null;

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
        selectedBackupDirectory = null;
        return { status: 'cancelled' };
      }

      selectedBackupDirectory = result.filePaths[0];
      return {
        status: 'selected',
        folderName: basename(selectedBackupDirectory)
      };
    }
  );

  ipcMain.handle(IPC_CHANNELS.inspectSelectedBackup, async () => {
    if (!selectedBackupDirectory) {
      throw new Error('Select an archive folder before inspecting it.');
    }

    return inspectArchiveDirectory(selectedBackupDirectory);
  });
}
