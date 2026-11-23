import { app, dialog, ipcMain } from 'electron';
import { basename } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { IPC_CHANNELS, type AppInfo, type DirectorySelectionResult } from '../../shared/desktop-api';
import {
  beginDiscoverySession,
  completeDiscoverySession,
  failDiscoverySession,
  getOrCreateAccount,
  insertDiscoveredFiles,\n  listArchiveSnapshots
} from '../database/archive-repository';
import { inspectArchiveDirectory } from '../import/discovery/inventory';

let selectedBackupDirectory: string | null = null;
let selectedAccountId: string | null = null;

export function registerIpcHandlers(database: DatabaseSync): void {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, (): AppInfo => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    platform: process.platform
  }));

  ipcMain.handle(
    IPC_CHANNELS.selectBackupDirectory,
    async (_event, requestedAccountName: unknown): Promise<DirectorySelectionResult> => {
      if (typeof requestedAccountName !== 'string') {
        throw new Error('Enter an account label before selecting a backup.');
      }

      const accountName = requestedAccountName.trim().replace(/\s+/gu, ' ');
      if (!accountName || accountName.length > 100 || /[\u0000-\u001F\u007F]/u.test(accountName)) {
        throw new Error('Account label must contain 1 to 100 printable characters.');
      }

      const result = await dialog.showOpenDialog({
        title: 'Choose your Facebook export folder',
        buttonLabel: 'Select folder',
        properties: ['openDirectory', 'dontAddToRecent']
      });

      if (result.canceled || result.filePaths.length === 0) {
        selectedBackupDirectory = null;
        selectedAccountId = null;
        return { status: 'cancelled' };
      }

      selectedBackupDirectory = result.filePaths[0];
      selectedAccountId = getOrCreateAccount(database, accountName);

      return {
        status: 'selected',
        folderName: basename(selectedBackupDirectory),
        accountName
      };
    }
  );

  ipcMain.handle(IPC_CHANNELS.listArchiveSnapshots, () => listArchiveSnapshots(database));\n\n  ipcMain.handle(IPC_CHANNELS.inspectSelectedBackup, async () => {
    if (!selectedBackupDirectory || !selectedAccountId) {
      throw new Error('Select an archive folder before inspecting it.');
    }

    const sourcePath = selectedBackupDirectory;
    const archiveName = basename(sourcePath);
    const session = beginDiscoverySession(database, selectedAccountId, archiveName, sourcePath);

    try {
      const report = await inspectArchiveDirectory(sourcePath, {
        snapshotId: session.snapshotId,
        accountId: session.accountId,
        onFilesFound: (files) => insertDiscoveredFiles(database, session.snapshotId, files)
      });

      completeDiscoverySession(database, session, report.totalFiles);
      return report;
    } catch (error) {
      failDiscoverySession(database, session);
      throw error;
    }
  });
}
