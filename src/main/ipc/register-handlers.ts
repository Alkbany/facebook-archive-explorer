import { app, dialog, ipcMain } from 'electron';
import { basename, extname } from 'node:path';
import { realpath, stat, writeFile } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import { IPC_CHANNELS, type AppInfo, type DirectorySelectionResult } from '../../shared/desktop-api';
import type { ArchiveInspectionView } from '../../shared/archive/inspection';
import {
  beginDiscoverySession,
  completeDiscoverySession,
  failDiscoverySession,
  getArchiveSnapshotOpenDetails,
  getOrCreateAccount,
  insertDiscoveredFiles,
  listArchiveSnapshots
} from '../database/archive-repository';
import { inspectArchiveDirectory } from '../import/discovery/inventory';
import { inspectArchiveZip } from '../import/discovery/zip-inventory';
import { importFriendsSection } from '../import/pipeline/friends-importer';
import { importAllSupportedData } from '../import/pipeline/import-all';
import { importPostsSection } from '../import/pipeline/posts-importer';
import { importCommentsSection } from '../import/pipeline/comments-importer';
import { listPostRecords, listCommentActivities } from '../database/activity-repository';
import { importMessagesSection } from '../import/pipeline/messages-importer';
import { importReactionsSection } from '../import/pipeline/reactions-importer';
import { listReactionRecords } from '../database/activity-repository';
import { getMessageConversation, listMessageConversations, listMessageMediaGallery, listArchiveMediaGallery } from '../database/messages-repository';
import { getMessageMediaPreview } from '../database/media-preview';
import { indexDiscoveredMediaAssets } from '../database/media-indexer';
import { searchArchiveRecords } from '../database/search-repository';
import { compareArchiveSnapshots } from '../database/comparison-repository';
import { exportDatabaseBackup, restoreDatabaseBackup, validateDatabaseBackup } from '../database/backup';

let selectedBackupDirectory: string | null = null;
let selectedBackupKind: 'directory' | 'zip' | null = null;
let selectedAccountId: string | null = null;
let selectedSnapshotId: string | null = null;

export function getSelectedSnapshotId(): string | null { return selectedSnapshotId; }

export function registerIpcHandlers(
  database: DatabaseSync,
  databasePath: string,
  supportedSchemaVersion: number
): void {
  ipcMain.handle(IPC_CHANNELS.exportLocalDatabaseBackup, async () => {
    const selection = await dialog.showSaveDialog({
      title: 'Export application database backup',
      defaultPath: 'facebook-archive-explorer-backup.sqlite',
      buttonLabel: 'Export backup',
      filters: [{ name: 'SQLite database backup', extensions: ['sqlite', 'sqlite3', 'db'] }]
    });
    if (selection.canceled || !selection.filePath) return { status: 'cancelled' as const };

    const exported = await exportDatabaseBackup(database, selection.filePath, supportedSchemaVersion);
    return { status: 'saved' as const, ...exported };
  });

  ipcMain.handle(IPC_CHANNELS.restoreLocalDatabaseBackup, async () => {
    const selection = await dialog.showOpenDialog({
      title: 'Choose an application database backup',
      buttonLabel: 'Validate backup',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'SQLite database backup', extensions: ['sqlite', 'sqlite3', 'db'] }]
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      return { status: 'cancelled' as const };
    }

    const selectedPath = selection.filePaths[0];
    await validateDatabaseBackup(selectedPath, supportedSchemaVersion);
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: 'Restore application database?',
      message: 'This will replace the current local archive library and restart the application.',
      detail: 'The current database is preserved as a recovery copy. This backup contains archive indexes and imported records, not the original Facebook export folders, ZIP files, or media. Those original files must remain at their existing paths.',
      buttons: ['Restore and restart', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) return { status: 'cancelled' as const };

    try {
      await restoreDatabaseBackup(database, selectedPath, databasePath, supportedSchemaVersion);
    } catch (error) {
      if (!database.isOpen) {
        app.relaunch();
        app.exit(1);
        return { status: 'restarting' as const };
      }
      throw error;
    }

    app.relaunch();
    app.exit(0);
    return { status: 'restarting' as const };
  });

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
        title: 'Choose your Facebook export folder or ZIP file',
        buttonLabel: 'Select backup',
        properties: ['openDirectory', 'openFile', 'dontAddToRecent'],
        filters: [{ name: 'Facebook ZIP archive', extensions: ['zip'] }]
      });

      if (result.canceled || result.filePaths.length === 0) {
        selectedBackupDirectory = null;
        selectedBackupKind = null;
        selectedAccountId = null;
        selectedSnapshotId = null;
        return { status: 'cancelled' };
      }

      selectedBackupDirectory = null;
      selectedBackupKind = null;
      selectedAccountId = null;
      selectedSnapshotId = null;
      const selectedPath = result.filePaths[0];
      const selectedStats = await stat(selectedPath);
      if (selectedStats.isDirectory()) {
        selectedBackupKind = 'directory';
      } else if (selectedStats.isFile() && extname(selectedPath).toLocaleLowerCase() === '.zip') {
        selectedBackupKind = 'zip';
      } else {
        throw new Error('Choose a Facebook export folder or a .zip archive.');
      }
      selectedBackupDirectory = selectedPath;
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

  ipcMain.handle(IPC_CHANNELS.openSavedSnapshot, async (_event, requestedSnapshotId: unknown): Promise<ArchiveInspectionView> => {
    if (typeof requestedSnapshotId !== 'string' || !requestedSnapshotId.trim()) {
      throw new Error('Choose a saved backup to open.');
    }
    const snapshot = getArchiveSnapshotOpenDetails(database, requestedSnapshotId);
    if (!snapshot) throw new Error('The selected backup inventory no longer exists in the local database.');

    let verifiedRoot: string;
    try {
      verifiedRoot = await realpath(snapshot.sourcePath);
      const rootStats = await stat(verifiedRoot);
      const isZip = snapshot.sourceKind === 'zip';
      const validSource = isZip
        ? rootStats.isFile() && extname(verifiedRoot).toLocaleLowerCase() === '.zip'
        : rootStats.isDirectory();
      if (!validSource) throw new Error('The backup source type has changed.');
    } catch {
      throw new Error('The original backup folder or ZIP file is unavailable. It may have been moved, renamed, or disconnected.');
    }

    selectedBackupDirectory = verifiedRoot;
    selectedBackupKind = snapshot.sourceKind;
    selectedAccountId = snapshot.accountId;
    selectedSnapshotId = snapshot.id;
    return {
      archiveName: snapshot.backupName,
      inspectedAt: snapshot.createdAt,
      snapshotId: snapshot.id,
      accountId: snapshot.accountId,
      totalFiles: snapshot.totalFiles,
      totalDirectories: null,
      filesByFormat: snapshot.filesByFormat,
      sectionFileCounts: snapshot.sectionFileCounts,
      noDataSections: snapshot.noDataSections,
      skippedSymlinks: null,
      unreadableDirectories: null,
      truncated: null
    };
  });

  ipcMain.handle(IPC_CHANNELS.inspectSelectedBackup, async () => {
    if (!selectedBackupDirectory || !selectedAccountId) {
      throw new Error('Select a backup folder or ZIP file before inspecting it.');
    }

    selectedSnapshotId = null;
    const sourcePath = selectedBackupDirectory;
    const sourceKind = selectedBackupKind ?? 'directory';
    const archiveName = sourceKind === 'zip' ? basename(sourcePath, extname(sourcePath)) : basename(sourcePath);
    const session = beginDiscoverySession(database, selectedAccountId, archiveName, sourcePath, sourceKind);

    try {
      const discoveryOptions = {
        snapshotId: session.snapshotId,
        accountId: session.accountId,
        onFilesFound: (files: Parameters<typeof insertDiscoveredFiles>[2]) =>
          insertDiscoveredFiles(database, session.snapshotId, files)
      };
      const report = sourceKind === 'zip'
        ? await inspectArchiveZip(sourcePath, discoveryOptions)
        : await inspectArchiveDirectory(sourcePath, discoveryOptions);

      completeDiscoverySession(database, session, report.totalFiles);
      indexDiscoveredMediaAssets(database, session.snapshotId);
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

  ipcMain.handle(IPC_CHANNELS.listMediaForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before browsing media.');
    indexDiscoveredMediaAssets(database, selectedSnapshotId);
    return listArchiveMediaGallery(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.searchRecordsForSelectedBackup, (_event, query: unknown, sectionKey: unknown) => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before searching the archive.');
    if (typeof query !== 'string' || !(sectionKey === null || typeof sectionKey === 'string')) {
      throw new Error('Invalid search request.');
    }
    return searchArchiveRecords(database, selectedSnapshotId, query, sectionKey);
  });

  ipcMain.handle(IPC_CHANNELS.exportSearchResultsForSelectedBackup, async (_event, query: unknown, sectionKey: unknown) => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before exporting search results.');
    if (typeof query !== 'string' || !(sectionKey === null || typeof sectionKey === 'string')) {
      throw new Error('Invalid export request.');
    }
    const snapshotId = selectedSnapshotId;
    const results = searchArchiveRecords(database, snapshotId, query, sectionKey);
    const save = await dialog.showSaveDialog({
      title: 'Export archive search results',
      defaultPath: 'facebook-archive-search-results.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (save.canceled || !save.filePath) return { status: 'cancelled' as const };
    const payload = {
      exportedAt: new Date().toISOString(),
      snapshotId,
      query: query.trim(),
      sectionKey,
      records: results
    };
    await writeFile(save.filePath, JSON.stringify(payload, null, 2), { encoding: 'utf8', flag: 'w' });
    return { status: 'saved' as const, fileName: basename(save.filePath), recordsExported: results.length };
  });

  ipcMain.handle(IPC_CHANNELS.compareArchiveSnapshots, (_event, baselineId: unknown, comparedId: unknown) => {
    if (typeof baselineId !== 'string' || typeof comparedId !== 'string') {
      throw new Error('Choose two saved backup snapshots.');
    }
    return compareArchiveSnapshots(database, baselineId, comparedId);
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

  ipcMain.handle(IPC_CHANNELS.listCommentsForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing comments.');
    return listCommentActivities(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.importCommentsForSelectedBackup, async () => {
    if (!selectedBackupDirectory || !selectedSnapshotId) throw new Error('Inspect an archive folder before importing Comments data.');
    return importCommentsSection(database, selectedSnapshotId, selectedBackupDirectory);
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

  ipcMain.handle(IPC_CHANNELS.importAllSupportedDataForSelectedBackup, async () => {
    if (!selectedBackupDirectory || !selectedSnapshotId) {
      throw new Error('Inspect an archive folder before importing supported data.');
    }
    return importAllSupportedData(database, selectedSnapshotId, selectedBackupDirectory);
  });

  ipcMain.handle(IPC_CHANNELS.importFriendsForSelectedBackup, async () => {
    if (!selectedBackupDirectory || !selectedSnapshotId) {
      throw new Error('Inspect an archive folder before importing Friends data.');
    }

    return importFriendsSection(database, selectedSnapshotId, selectedBackupDirectory);
  });
}
