import { app, dialog, ipcMain } from 'electron';
import { basename } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { IPC_CHANNELS, type AppInfo, type DirectorySelectionResult } from '../../shared/desktop-api';
import {
  beginDiscoverySession,
  completeDiscoverySession,
  failDiscoverySession,
  getOrCreateAccount,
  insertDiscoveredFiles,
  listArchiveSnapshots
} from '../database/archive-repository';
import { inspectArchiveDirectory } from '../import/discovery/inventory';
import { importFriendsSection } from '../import/pipeline/friends-importer';
import { importPostsSection } from '../import/pipeline/posts-importer';
import { listPostRecords } from '../database/activity-repository';
import { importMessagesSection } from '../import/pipeline/messages-importer';
import { importReactionsSection } from '../import/pipeline/reactions-importer';
import { listReactionRecords } from '../database/activity-repository';
import { getMessageConversation, listMessageConversations, listMessageMediaGallery } from '../database/messages-repository';
import { getMessageMediaPreview } from '../database/media-preview';

let selectedBackupDirectory: string | null = null;
let selectedAccountId: string | null = null;
let selectedSnapshotId: string | null = null;

export function getSelectedSnapshotId(): string | null { return selectedSnapshotId; }

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
        selectedSnapshotId = null;
        return { status: 'cancelled' };
      }

      selectedBackupDirectory = result.filePaths[0];
      selectedAccountId = getOrCreateAccount(database, accountName);
      selectedSnapshotId = null;

      return {
        status: 'selected',
        folderName: basename(selectedBackupDirectory),
        accountName
      };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.listArchiveSnapshots,
    () => listArchiveSnapshots(database)
  );

  ipcMain.handle(IPC_CHANNELS.inspectSelectedBackup, async () => {
    if (!selectedBackupDirectory || !selectedAccountId) {
      throw new Error('Select an archive folder before inspecting it.');
    }

    selectedSnapshotId = null;
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
      selectedSnapshotId = session.snapshotId;
      return report;
    } catch (error) {
      failDiscoverySession(database, session);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.listMessagesForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing conversations.');
    return listMessageConversations(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.listMessageMediaForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before browsing message attachments.');
    return listMessageMediaGallery(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.getMessagesForSelectedConversation, (_event, sourceFileId: unknown) => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing conversations.');
    if (!Number.isSafeInteger(sourceFileId) || (sourceFileId as number) < 1) {
      throw new Error('Invalid conversation selection.');
    }
    return getMessageConversation(database, selectedSnapshotId, sourceFileId as number);
  });

  ipcMain.handle(IPC_CHANNELS.getMessageMediaPreview, async (_event, mediaAssetId: unknown) => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before previewing attachments.');
    if (!Number.isSafeInteger(mediaAssetId) || (mediaAssetId as number) < 1) {
      throw new Error('Invalid attachment selection.');
    }
    return getMessageMediaPreview(database, selectedSnapshotId, mediaAssetId as number);
  });

  ipcMain.handle(IPC_CHANNELS.listPostsForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing posts.');
    return listPostRecords(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.importPostsForSelectedBackup, async () => {
    if (!selectedBackupDirectory || !selectedSnapshotId) throw new Error('Inspect an archive folder before importing Posts data.');
    return importPostsSection(database, selectedSnapshotId, selectedBackupDirectory);
  });

  ipcMain.handle(IPC_CHANNELS.listReactionsForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing reactions.');
    return listReactionRecords(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.importReactionsForSelectedBackup, async () => {
    if (!selectedBackupDirectory || !selectedSnapshotId) throw new Error('Inspect an archive folder before importing Likes & Reactions data.');
    return importReactionsSection(database, selectedSnapshotId, selectedBackupDirectory);
  });

  ipcMain.handle(IPC_CHANNELS.importMessagesForSelectedBackup, async () => {
    if (!selectedBackupDirectory || !selectedSnapshotId) {
      throw new Error('Inspect an archive folder before importing Messages data.');
    }
    return importMessagesSection(database, selectedSnapshotId, selectedBackupDirectory);
  });

  ipcMain.handle(IPC_CHANNELS.importFriendsForSelectedBackup, async () => {
    if (!selectedBackupDirectory || !selectedSnapshotId) {
      throw new Error('Inspect an archive folder before importing Friends data.');
    }

    return importFriendsSection(database, selectedSnapshotId, selectedBackupDirectory);
  });
}
