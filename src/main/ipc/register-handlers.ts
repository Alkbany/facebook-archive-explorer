import { app, dialog, ipcMain, shell } from 'electron';
import { basename, extname, join } from 'node:path';
import { realpath, stat, writeFile } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import { IPC_CHANNELS, type AppInfo, type DirectorySelectionResult } from '../../shared/desktop-api';
import { normalizeSafeExternalUrl } from '../../shared/text/safe-external-url';
import type { ArchiveFileStatus, ArchiveInspectionView, FriendDirectoryFilter, ImportProgressEvent } from '../../shared/archive/inspection';
import type { ArchiveComparisonChangeKind, ArchiveComparisonExportFormat } from '../../shared/archive/comparison';
import type { ArchiveMediaGalleryFilter } from '../../shared/archive/media';
import type { ArchiveSearchMode } from '../../shared/archive/search';
import { getArchiveSection } from '../../shared/archive/section-registry';
import type { AiAssistantComparisonSelection, AiAssistantHistoryMessage } from '../../shared/archive/assistant';
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
import { importAllSupportedData, importPhotosAndVideosSection } from '../import/pipeline/import-all';
import { importEventsJsonSection } from '../import/pipeline/events-json-importer';
import { importMarketplaceJsonSection } from '../import/pipeline/marketplace-json-importer';
import { importSavedItemsJsonSection } from '../import/pipeline/saved-items-json-importer';
import { listMarketplaceListings } from '../database/marketplace-repository';
import { listSavedItems } from '../database/saved-items-repository';
import { importPostsSection } from '../import/pipeline/posts-importer';
import { importCommentsSection } from '../import/pipeline/comments-importer';
import { listPostRecords, listCommentActivities, listPhotoAlbums, getPhotoAlbumDetail, listEventRecords } from '../database/activity-repository';
import { importMessagesSection } from '../import/pipeline/messages-importer';
import { importReactionsSection } from '../import/pipeline/reactions-importer';
import { listReactionRecords } from '../database/activity-repository';
import { listFriendDirectory } from '../database/friends-repository';
import { listArchiveFiles } from '../database/archive-files-repository';
import { listFallbackArchiveRecords, listFallbackRecordSections } from '../database/fallback-records-repository';
import { getMessageConversation, listMessageConversations, listMessageMediaGallery, listArchiveMediaGallery } from '../database/messages-repository';
import { getMessageMediaPreview } from '../database/media-preview';
import { indexDiscoveredImageDimensions, indexDiscoveredMediaAssets, indexDiscoveredVideoDurations } from '../database/media-indexer';
import { searchArchiveRecords } from '../database/search-repository';
import { MAX_ARCHIVE_SEARCH_OFFSET } from '../../shared/archive/search';
import { getArchiveSearchSettings, setAiAssistantEnabled, setIncludeMessagesInGlobalSearch, setSemanticSearchEnabled } from '../database/search-settings-repository';
import { createSemanticQueryEmbedding, getSemanticSearchStatus, processSemanticIndexQueue, retryFailedSemanticJobs, searchSemanticArchiveRecords } from '../database/semantic-search-service';
import { askLocalArchiveAssistant, getAiAssistantStatus, prepareAiAssistant } from '../database/ai-assistant-service';
import { compareArchiveSnapshots, listArchiveComparisonChanges } from '../database/comparison-repository';
import { exportDatabaseBackup, restoreDatabaseBackup, validateDatabaseBackup } from '../database/backup';
import { listImportIssues } from '../database/import-issues-repository';
import { getImportCoverage } from '../database/import-coverage-repository';
import { assertNoImportInProgress, pauseActiveImport, resumeActiveImport, runExclusiveImport as runExclusiveImportLock } from './import-operation-lock';

let selectedBackupDirectory: string | null = null;
let selectedBackupKind: 'directory' | 'zip' | null = null;
let selectedAccountId: string | null = null;
let selectedSnapshotId: string | null = null;

export function getSelectedSnapshotId(): string | null { return selectedSnapshotId; }

function getSemanticModelCacheDirectory(): string {
  return join(app.getPath('userData'), 'models');
}

function getAiAssistantModelCacheDirectory(): string {
  return join(app.getPath('userData'), 'models');
}

export function registerIpcHandlers(
  database: DatabaseSync,
  databasePath: string,
  supportedSchemaVersion: number
): void {
  ipcMain.handle(IPC_CHANNELS.openExternalUrl, async (_event, candidate: unknown) => {
    const safeUrl = normalizeSafeExternalUrl(candidate);
    if (!safeUrl) {
      throw new Error('Only valid HTTP and HTTPS links can be opened.');
    }
    await shell.openExternal(safeUrl);
  });

  async function runExclusiveImport<T>(importName: string, operation: () => Promise<T>): Promise<T> {
    return runExclusiveImportLock(importName, async () => {
      const result = await operation();
      if (getSemanticSearchStatus(database).enabled) {
        try {
          await processSemanticIndexQueue(database, getSemanticModelCacheDirectory());
        } catch {
          // Semantic indexing is recoverable and must not turn a successful archive import into a failure.
        }
      }
      return result;
    });
  }
  ipcMain.handle(IPC_CHANNELS.exportLocalDatabaseBackup, async () => {
    assertNoImportInProgress('export the application database');
    const selection = await dialog.showSaveDialog({
      title: 'Export application database backup',
      defaultPath: 'facebook-archive-explorer-backup.sqlite',
      buttonLabel: 'Export backup',
      filters: [{ name: 'SQLite database backup', extensions: ['sqlite', 'sqlite3', 'db'] }]
    });
    if (selection.canceled || !selection.filePath) return { status: 'cancelled' as const };

    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: 'Export an unencrypted database backup?',
      message: 'The SQLite backup will contain imported archive records and personal metadata.',
      detail: 'This file is not encrypted or password-protected. Anyone who can open it may be able to read its contents. Save it in a private location and do not share it unless you intend to share the archive data.',
      buttons: ['Export database', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) return { status: 'cancelled' as const };

    const exported = await exportDatabaseBackup(database, selection.filePath, supportedSchemaVersion);
    return { status: 'saved' as const, ...exported };
  });

  ipcMain.handle(IPC_CHANNELS.restoreLocalDatabaseBackup, async () => {
    assertNoImportInProgress('restore the application database');
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
    const backupInfo = await validateDatabaseBackup(selectedPath, supportedSchemaVersion);
    const sizeMb = (backupInfo.sizeBytes / (1024 * 1024)).toFixed(1);
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: 'Restore application database?',
      message: 'This will replace the current local archive library and restart the application.',
      detail: 'Selected backup: ' + backupInfo.accounts.toLocaleString() + ' accounts, ' + backupInfo.snapshots.toLocaleString() + ' archive snapshots, ' + backupInfo.records.toLocaleString() + ' imported records (' + sizeMb + ' MB).\n\nThe current database is preserved as a recovery copy. The selected file is an unencrypted SQLite database. It contains archive indexes and imported records, not the original Facebook export folders, ZIP files, or media. Those original files must remain at their existing paths.',
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

  ipcMain.handle(IPC_CHANNELS.pauseImport, () => pauseActiveImport());
  ipcMain.handle(IPC_CHANNELS.resumeImport, () => resumeActiveImport());

  ipcMain.handle(IPC_CHANNELS.getAppInfo, (): AppInfo => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    platform: process.platform
  }));

  ipcMain.handle(
    IPC_CHANNELS.selectBackupDirectory,
    async (_event, requestedAccountName: unknown): Promise<DirectorySelectionResult> => {
      assertNoImportInProgress('select a different backup');
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

  ipcMain.handle(IPC_CHANNELS.listImportIssuesForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Open a backup before viewing its import report.');
    return listImportIssues(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.getImportCoverageForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Open a backup before viewing its import coverage.');
    return getImportCoverage(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.openSavedSnapshot, async (_event, requestedSnapshotId: unknown): Promise<ArchiveInspectionView> => {
    assertNoImportInProgress('open a different backup');
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
    assertNoImportInProgress('inspect a backup');
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

  ipcMain.handle(IPC_CHANNELS.listArchiveFilesForSelectedBackup, (_event, status: unknown, sectionKey: unknown, query: unknown, page: unknown) => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before browsing its files.');
    const validStatuses = ['all', 'discovered', 'queued', 'processing', 'completed', 'empty', 'unsupported', 'failed', 'skipped'];
    if (typeof status !== 'string' || !validStatuses.includes(status)) {
      throw new Error('Invalid archive file status filter.');
    }
    if (typeof sectionKey !== 'string' || (sectionKey !== 'all' && !/^[a-z0-9_]{1,80}$/u.test(sectionKey))) {
      throw new Error('Invalid archive file section filter.');
    }
    if (typeof query !== 'string' || query.length > 120) {
      throw new Error('Invalid archive file search.');
    }
    if (!Number.isSafeInteger(page) || (page as number) < 1) {
      throw new Error('Invalid archive file page.');
    }
    return listArchiveFiles(database, selectedSnapshotId, status as ArchiveFileStatus, sectionKey, query, page as number);
  });

  ipcMain.handle(IPC_CHANNELS.listFallbackRecordSectionsForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before browsing preserved fallback records.');
    return listFallbackRecordSections(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.listFallbackArchiveRecordsForSelectedBackup, (_event, sectionKey: unknown, page: unknown, query: unknown = '') => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before browsing preserved fallback records.');
    if (typeof sectionKey !== 'string' || !/^[a-z0-9_]{1,80}$/u.test(sectionKey)) {
      throw new Error('Invalid fallback archive section.');
    }
    if (!Number.isSafeInteger(page) || (page as number) < 1) {
      throw new Error('Invalid fallback archive page.');
    }
    if (typeof query !== 'string' || query.length > 120) {
      throw new Error('Invalid fallback archive search.');
    }
    return listFallbackArchiveRecords(database, selectedSnapshotId, sectionKey, page as number, query);
  });

  ipcMain.handle(IPC_CHANNELS.listFriendsDirectoryForSelectedBackup, (_event, filter: unknown, query: unknown, page: unknown) => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing Friends data.');
    const validFilters = ['all', 'friend', 'received', 'sent', 'rejected', 'removed'];
    if (typeof filter !== 'string' || !validFilters.includes(filter)) {
      throw new Error('Invalid Friends directory filter.');
    }
    if (typeof query !== 'string' || query.length > 100) {
      throw new Error('Invalid Friends directory search.');
    }
    if (!Number.isSafeInteger(page) || (page as number) < 1) {
      throw new Error('Invalid Friends directory page.');
    }
    return listFriendDirectory(database, selectedSnapshotId, filter as FriendDirectoryFilter, query, page as number);
  });

  ipcMain.handle(IPC_CHANNELS.listMessagesForSelectedBackup, (_event, requestedPage: unknown = 1, searchQuery: unknown = '') => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing conversations.');
    if (!Number.isSafeInteger(requestedPage) || (requestedPage as number) < 1 || (requestedPage as number) > 1_000_000) {
      throw new Error('Invalid conversation-list page.');
    }
    if (typeof searchQuery !== 'string' || searchQuery.length > 100) {
      throw new Error('Invalid conversation-list search query.');
    }
    return listMessageConversations(database, selectedSnapshotId, requestedPage as number, searchQuery);
  });

  ipcMain.handle(IPC_CHANNELS.listMessageMediaForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before browsing message attachments.');
    return listMessageMediaGallery(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.listMediaForSelectedBackup, async (_event, filter: unknown, page: unknown, query: unknown, pageSize: unknown) => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before browsing media.');
    const allowedFilters: ArchiveMediaGalleryFilter[] = ['all', 'image', 'sticker', 'video', 'audio'];
    if (typeof filter !== 'string' || !allowedFilters.includes(filter as ArchiveMediaGalleryFilter)) {
      throw new Error('Invalid media gallery filter.');
    }
    if (!Number.isSafeInteger(page) || (page as number) < 1 || (page as number) > 1_000_000) {
      throw new Error('Invalid media gallery page.');
    }
    if (typeof query !== 'string' || query.length > 180) {
      throw new Error('Invalid media gallery search query.');
    }
    if (pageSize !== undefined && ![50, 100, 250].includes(pageSize as number)) {
      throw new Error('Invalid media gallery page size.');
    }
    indexDiscoveredMediaAssets(database, selectedSnapshotId);
    if (selectedBackupDirectory) {
      await indexDiscoveredImageDimensions(database, selectedSnapshotId, selectedBackupDirectory);
      await indexDiscoveredVideoDurations(database, selectedSnapshotId, selectedBackupDirectory);
    }
    return listArchiveMediaGallery(database, selectedSnapshotId, filter as ArchiveMediaGalleryFilter, page as number, query, pageSize as number | undefined);
  });

  ipcMain.handle(IPC_CHANNELS.getArchiveSearchSettings, () => getArchiveSearchSettings(database));

  ipcMain.handle(IPC_CHANNELS.setIncludeMessagesInGlobalSearch, async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid message-search setting.');
    const settings = setIncludeMessagesInGlobalSearch(database, enabled);
    if (settings.semanticSearchEnabled) {
      void processSemanticIndexQueue(database, getSemanticModelCacheDirectory()).catch(() => undefined);
    }
    return settings;
  });

  ipcMain.handle(IPC_CHANNELS.getSemanticSearchStatus, () => getSemanticSearchStatus(database));

  ipcMain.handle(IPC_CHANNELS.setSemanticSearchEnabled, async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid Semantic Search setting.');
    setSemanticSearchEnabled(database, enabled);
    if (enabled) {
      void processSemanticIndexQueue(database, getSemanticModelCacheDirectory()).catch(() => undefined);
    }
    return getSemanticSearchStatus(database);
  });

  ipcMain.handle(IPC_CHANNELS.retrySemanticIndexing, async () => {
    if (!getSemanticSearchStatus(database).enabled) throw new Error('Enable Semantic Search before retrying its index.');
    retryFailedSemanticJobs(database);
    void processSemanticIndexQueue(database, getSemanticModelCacheDirectory()).catch(() => undefined);
    return getSemanticSearchStatus(database);
  });

  ipcMain.handle(IPC_CHANNELS.getAiAssistantStatus, () => getAiAssistantStatus(database));

  ipcMain.handle(IPC_CHANNELS.setAiAssistantEnabled, (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid AI Assistant setting.');
    setAiAssistantEnabled(database, enabled);
    if (enabled) {
      void prepareAiAssistant(database, getAiAssistantModelCacheDirectory()).catch(() => undefined);
    }
    return getAiAssistantStatus(database);
  });

  ipcMain.handle(IPC_CHANNELS.askArchiveAssistant, async (
    _event, question: unknown, sectionKey: unknown, history: unknown, comparison: unknown
  ) => {
    let comparisonSelection: AiAssistantComparisonSelection | null = null;
    if (comparison !== undefined && comparison !== null) {
      if (
        typeof comparison !== 'object' || Array.isArray(comparison) ||
        !('baselineSnapshotId' in comparison) || !('comparedSnapshotId' in comparison) ||
        typeof comparison.baselineSnapshotId !== 'string' || comparison.baselineSnapshotId.length > 128 ||
        typeof comparison.comparedSnapshotId !== 'string' || comparison.comparedSnapshotId.length > 128
      ) {
        throw new Error('Invalid assistant backup comparison selection.');
      }
      comparisonSelection = {
        baselineSnapshotId: comparison.baselineSnapshotId,
        comparedSnapshotId: comparison.comparedSnapshotId
      };
      compareArchiveSnapshots(database, comparisonSelection.baselineSnapshotId, comparisonSelection.comparedSnapshotId);
    }
    const assistantSnapshotId = comparisonSelection?.baselineSnapshotId ?? selectedSnapshotId;
    if (!assistantSnapshotId) throw new Error('Inspect a backup before asking the archive assistant.');
    if (
      typeof question !== 'string' || question.trim().length < 2 || question.length > 2_000 ||
      !(sectionKey === null || typeof sectionKey === 'string') ||
      !Array.isArray(history) || history.length > 12
    ) {
      throw new Error('Invalid archive assistant request.');
    }
    if (typeof sectionKey === 'string' && !getArchiveSection(sectionKey)) {
      throw new Error('The requested archive section is not recognized.');
    }
    const safeHistory: AiAssistantHistoryMessage[] = history.map((item: unknown) => {
      if (
        typeof item !== 'object' || item === null ||
        !('role' in item) || !('content' in item) ||
        (item.role !== 'user' && item.role !== 'assistant') ||
        typeof item.content !== 'string' || item.content.length > 4_000
      ) {
        throw new Error('Invalid assistant conversation history.');
      }
      return { role: item.role, content: item.content };
    });
    return askLocalArchiveAssistant(
      database,
      assistantSnapshotId,
      question,
      getAiAssistantModelCacheDirectory(),
      sectionKey,
      safeHistory,
      comparisonSelection?.comparedSnapshotId ?? null
    );
  });

  ipcMain.handle(IPC_CHANNELS.searchRecordsForSelectedBackup, async (
    _event, query: unknown, sectionKey: unknown, mode: unknown, threshold: unknown, dateFrom: unknown, dateTo: unknown, offset: unknown
  ) => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before searching the archive.');
    if (
      typeof query !== 'string' ||
      !(sectionKey === null || typeof sectionKey === 'string') ||
      !(mode === undefined || mode === 'exact' || mode === 'fuzzy' || mode === 'semantic') ||
      !(threshold === undefined || (typeof threshold === 'number' && Number.isFinite(threshold))) ||
      !(dateFrom === undefined || dateFrom === null || typeof dateFrom === 'string') ||
      !(dateTo === undefined || dateTo === null || typeof dateTo === 'string') ||
      !(offset === undefined || (typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0 && offset <= MAX_ARCHIVE_SEARCH_OFFSET))
    ) {
      throw new Error('Invalid search request.');
    }
    const searchMode = (mode ?? 'exact') as ArchiveSearchMode;
    const resultOffset = (offset ?? 0) as number;
    if (searchMode === 'semantic') {
      if (!getSemanticSearchStatus(database).enabled) {
        throw new Error('Enable Semantic Search before using semantic queries.');
      }
      const vector = await createSemanticQueryEmbedding(query, getSemanticModelCacheDirectory());
      return searchSemanticArchiveRecords(
        database, selectedSnapshotId, vector, sectionKey, undefined,
        dateFrom as string | null | undefined ?? null,
        dateTo as string | null | undefined ?? null,
        resultOffset
      );
    }
    return searchArchiveRecords(
      database,
      selectedSnapshotId,
      query,
      sectionKey,
      searchMode,
      threshold === undefined ? 0.8 : threshold as number,
      dateFrom as string | null | undefined ?? null,
      dateTo as string | null | undefined ?? null,
      resultOffset
    );
  });

  ipcMain.handle(IPC_CHANNELS.exportSearchResultsForSelectedBackup, async (
    _event, query: unknown, sectionKey: unknown, mode: unknown, threshold: unknown, dateFrom: unknown, dateTo: unknown, offset: unknown
  ) => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before exporting search results.');
    if (
      typeof query !== 'string' ||
      !(sectionKey === null || typeof sectionKey === 'string') ||
      !(mode === undefined || mode === 'exact' || mode === 'fuzzy' || mode === 'semantic') ||
      !(threshold === undefined || (typeof threshold === 'number' && Number.isFinite(threshold))) ||
      !(dateFrom === undefined || dateFrom === null || typeof dateFrom === 'string') ||
      !(dateTo === undefined || dateTo === null || typeof dateTo === 'string') ||
      !(offset === undefined || (typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0 && offset <= MAX_ARCHIVE_SEARCH_OFFSET))
    ) {
      throw new Error('Invalid export request.');
    }
    const searchMode = (mode ?? 'exact') as ArchiveSearchMode;
    const similarityThreshold = threshold === undefined ? 0.8 : threshold as number;
    const resultOffset = (offset ?? 0) as number;
    const snapshotId = selectedSnapshotId;
    if (searchMode === 'semantic' && !getSemanticSearchStatus(database).enabled) {
      throw new Error('Enable Semantic Search before exporting semantic results.');
    }
    const results = searchMode === 'semantic'
      ? searchSemanticArchiveRecords(
          database,
          snapshotId,
          await createSemanticQueryEmbedding(query, getSemanticModelCacheDirectory()),
          sectionKey,
          undefined,
          dateFrom as string | null | undefined ?? null,
          dateTo as string | null | undefined ?? null,
          resultOffset
        )
      : searchArchiveRecords(
          database, snapshotId, query, sectionKey, searchMode, similarityThreshold,
          dateFrom as string | null | undefined ?? null,
          dateTo as string | null | undefined ?? null,
          resultOffset
        );
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
      mode: searchMode,
      similarityThreshold,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      offset: resultOffset,
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

  ipcMain.handle(IPC_CHANNELS.listArchiveComparisonChanges, (
    _event,
    baselineId: unknown,
    comparedId: unknown,
    filter: unknown,
    sectionKey: unknown,
    query: unknown,
    page: unknown
  ) => {
    if (typeof baselineId !== 'string' || typeof comparedId !== 'string') {
      throw new Error('Choose two saved backup snapshots.');
    }
    if (typeof filter !== 'string' || typeof sectionKey !== 'string' || typeof query !== 'string') {
      throw new Error('Invalid detailed comparison filter.');
    }
    if (!Number.isSafeInteger(page) || (page as number) < 1) {
      throw new Error('Invalid detailed comparison page.');
    }
    return listArchiveComparisonChanges(
      database,
      baselineId,
      comparedId,
      filter as ArchiveComparisonChangeKind,
      sectionKey,
      query,
      page as number
    );
  });

  ipcMain.handle(IPC_CHANNELS.exportArchiveComparisonChanges, async (
    _event,
    baselineId: unknown,
    comparedId: unknown,
    filter: unknown,
    sectionKey: unknown,
    query: unknown,
    format: unknown
  ) => {
    if (typeof baselineId !== 'string' || typeof comparedId !== 'string') {
      throw new Error('Choose two saved backup snapshots.');
    }
    if (typeof filter !== 'string' || typeof sectionKey !== 'string' || typeof query !== 'string') {
      throw new Error('Invalid comparison export filters.');
    }
    if (format !== 'csv' && format !== 'json') {
      throw new Error('Choose CSV or JSON for the comparison export.');
    }

    const exportFormat = format as ArchiveComparisonExportFormat;
    const firstPage = listArchiveComparisonChanges(
      database, baselineId, comparedId, filter as ArchiveComparisonChangeKind, sectionKey, query, 1, 1000
    );
    const maximumExportRecords = 100000;
    if (firstPage.total > maximumExportRecords) {
      throw new Error('This comparison contains more than 100,000 matching changes. Narrow the filters before exporting.');
    }

    const changes = [...firstPage.changes];
    const pageCount = Math.ceil(firstPage.total / firstPage.pageSize);
    for (let page = 2; page <= pageCount; page += 1) {
      const nextPage = listArchiveComparisonChanges(
        database, baselineId, comparedId, filter as ArchiveComparisonChangeKind, sectionKey, query, page, 1000
      );
      changes.push(...nextPage.changes);
    }

    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: 'Export private archive comparison?',
      message: 'The comparison file contains imported archive text and is not encrypted.',
      detail: 'Depending on the selected sections and filters, it may include private message text and other personal activity. Save it in a private location and do not share it unless you intend to share this information.',
      buttons: ['Continue to save', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) return { status: 'cancelled' as const };

    const save = await dialog.showSaveDialog({
      title: 'Export detailed backup comparison',
      defaultPath: 'facebook-archive-comparison.' + exportFormat,
      filters: [exportFormat === 'csv'
        ? { name: 'CSV spreadsheet', extensions: ['csv'] }
        : { name: 'JSON data', extensions: ['json'] }]
    });
    if (save.canceled || !save.filePath) return { status: 'cancelled' as const };

    let content: string;
    if (exportFormat === 'json') {
      content = JSON.stringify({
        exportedAt: new Date().toISOString(),
        baselineSnapshotId: baselineId,
        comparedSnapshotId: comparedId,
        filter,
        sectionKey,
        query: query.trim(),
        totalChanges: firstPage.total,
        changes
      }, null, 2);
    } else {
      const headers = [
        'changeKind', 'sectionKey', 'sourcePath', 'sourceCardIndex',
        'previousRecordType', 'previousTitle', 'previousBody', 'previousDateRaw',
        'comparedRecordType', 'comparedTitle', 'comparedBody', 'comparedDateRaw'
      ];
      const csvCell = (value: unknown): string => {
        const raw = value === null || value === undefined ? '' : String(value);
        const spreadsheetSafe = /^[\s]*[=+\-@]/u.test(raw) ? "'" + raw : raw;
        return '"' + spreadsheetSafe.replace(/"/gu, '""') + '"';
      };
      content = [
        headers.map(csvCell).join(','),
        ...changes.map((change) => headers.map((key) => csvCell(change[key as keyof typeof change])).join(','))
      ].join('\r\n');
    }

    await writeFile(save.filePath, content, { encoding: 'utf8', flag: 'w' });
    return {
      status: 'saved' as const,
      fileName: basename(save.filePath),
      recordsExported: changes.length,
      format: exportFormat
    };
  });

  ipcMain.handle(IPC_CHANNELS.getMessagesForSelectedConversation, (_event, sourceFileId: unknown, requestedPage: unknown, searchQuery: unknown = '') => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing conversations.');
    if (!Number.isSafeInteger(sourceFileId) || (sourceFileId as number) < 1) {
      throw new Error('Invalid conversation selection.');
    }
    if (requestedPage !== undefined && (!Number.isSafeInteger(requestedPage) || (requestedPage as number) < 1)) {
      throw new Error('Invalid conversation page.');
    }
    if (typeof searchQuery !== 'string' || searchQuery.length > 120) {
      throw new Error('Invalid conversation search query.');
    }
    return getMessageConversation(database, selectedSnapshotId, sourceFileId as number, (requestedPage ?? 1) as number, searchQuery);
  });

  ipcMain.handle(IPC_CHANNELS.getMessageMediaPreview, async (_event, mediaAssetId: unknown) => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before previewing attachments.');
    if (!Number.isSafeInteger(mediaAssetId) || (mediaAssetId as number) < 1) {
      throw new Error('Invalid attachment selection.');
    }
    return getMessageMediaPreview(database, selectedSnapshotId, mediaAssetId as number);
  });

  ipcMain.handle(IPC_CHANNELS.listPhotoAlbumsForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing photo albums.');
    return listPhotoAlbums(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.getPhotoAlbumDetailForSelectedBackup, (_event, requestedAlbumRecordId: unknown) => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing photo album details.');
    if (!Number.isSafeInteger(requestedAlbumRecordId) || (requestedAlbumRecordId as number) < 1) {
      throw new Error('Invalid photo album selection.');
    }
    return getPhotoAlbumDetail(database, selectedSnapshotId, requestedAlbumRecordId as number);
  });

  ipcMain.handle(IPC_CHANNELS.listEventsForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before opening Events.');
    return listEventRecords(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.importEventsForSelectedBackup, async (event) => {
    if (!selectedSnapshotId || !selectedBackupDirectory) {
      throw new Error('Select a local backup before importing Events.');
    }
    const snapshotId = selectedSnapshotId;
    const archiveRoot = selectedBackupDirectory;
    return runExclusiveImport('Events', () =>
      importEventsJsonSection(database, snapshotId, archiveRoot, (progress: ImportProgressEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.importProgress, progress);
      })
    );
  });

  ipcMain.handle(IPC_CHANNELS.listMarketplaceForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before opening Marketplace.');
    return listMarketplaceListings(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.importMarketplaceForSelectedBackup, async (event) => {
    if (!selectedSnapshotId || !selectedBackupDirectory) {
      throw new Error('Select a local backup before importing Marketplace listings.');
    }
    const snapshotId = selectedSnapshotId;
    const archiveRoot = selectedBackupDirectory;
    return runExclusiveImport('Marketplace listings', () =>
      importMarketplaceJsonSection(database, snapshotId, archiveRoot, (progress: ImportProgressEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.importProgress, progress);
      })
    );
  });

  ipcMain.handle(IPC_CHANNELS.listSavedItemsForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before opening Saved Items.');
    return listSavedItems(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.importSavedItemsForSelectedBackup, async (event) => {
    if (!selectedSnapshotId || !selectedBackupDirectory) {
      throw new Error('Select a local backup before importing Saved Items.');
    }
    const snapshotId = selectedSnapshotId;
    const archiveRoot = selectedBackupDirectory;
    return runExclusiveImport('Saved Items', () =>
      importSavedItemsJsonSection(database, snapshotId, archiveRoot, (progress: ImportProgressEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.importProgress, progress);
      })
    );
  });

  ipcMain.handle(IPC_CHANNELS.listPostsForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing posts.');
    return listPostRecords(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.importPostsForSelectedBackup, async (event) => {
    const archiveRoot = selectedBackupDirectory;
    const snapshotId = selectedSnapshotId;
    if (!archiveRoot || !snapshotId) throw new Error('Inspect an archive folder before importing Posts data.');
    return runExclusiveImport('Posts', () => importPostsSection(database, snapshotId, archiveRoot, (progress: ImportProgressEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.importProgress, progress);
    }));
  });

  ipcMain.handle(IPC_CHANNELS.listCommentsForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing comments.');
    return listCommentActivities(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.importCommentsForSelectedBackup, async (event) => {
    const archiveRoot = selectedBackupDirectory;
    const snapshotId = selectedSnapshotId;
    if (!archiveRoot || !snapshotId) throw new Error('Inspect an archive folder before importing Comments data.');
    return runExclusiveImport('Comments', () => importCommentsSection(database, snapshotId, archiveRoot, (progress: ImportProgressEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.importProgress, progress);
    }));
  });

  ipcMain.handle(IPC_CHANNELS.listReactionsForSelectedBackup, () => {
    if (!selectedSnapshotId) throw new Error('Inspect a backup before viewing reactions.');
    return listReactionRecords(database, selectedSnapshotId);
  });

  ipcMain.handle(IPC_CHANNELS.importReactionsForSelectedBackup, async (event) => {
    const archiveRoot = selectedBackupDirectory;
    const snapshotId = selectedSnapshotId;
    if (!archiveRoot || !snapshotId) throw new Error('Inspect an archive folder before importing Likes & Reactions data.');
    return runExclusiveImport('Likes & Reactions', () => importReactionsSection(database, snapshotId, archiveRoot, (progress: ImportProgressEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.importProgress, progress);
    }));
  });

  ipcMain.handle(IPC_CHANNELS.importMessagesForSelectedBackup, async (event) => {
    const archiveRoot = selectedBackupDirectory;
    const snapshotId = selectedSnapshotId;
    if (!archiveRoot || !snapshotId) {
      throw new Error('Inspect an archive folder before importing Messages data.');
    }
    return runExclusiveImport('Messages', () => importMessagesSection(database, snapshotId, archiveRoot, (progress: ImportProgressEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.importProgress, progress);
    }));
  });

  ipcMain.handle(IPC_CHANNELS.importAllSupportedDataForSelectedBackup, async (event) => {
    const archiveRoot = selectedBackupDirectory;
    const snapshotId = selectedSnapshotId;
    if (!archiveRoot || !snapshotId) {
      throw new Error('Inspect an archive folder before importing supported data.');
    }
    return runExclusiveImport('Import All', () => importAllSupportedData(
      database,
      snapshotId,
      archiveRoot,
      (progress: ImportProgressEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.importProgress, progress);
      },
      async () => {
        if (getSemanticSearchStatus(database).enabled) {
          try {
            await processSemanticIndexQueue(database, getSemanticModelCacheDirectory());
          } catch {
            // Semantic indexing is a recoverable side task and never aborts archive import.
          }
        }
      }
    ));
  });

  ipcMain.handle(IPC_CHANNELS.importPhotosAndVideosForSelectedBackup, async (event) => {
    const archiveRoot = selectedBackupDirectory;
    const snapshotId = selectedSnapshotId;
    if (!archiveRoot || !snapshotId) {
      throw new Error('Inspect an archive folder before importing Photos & Videos data.');
    }
    return runExclusiveImport('Photos & Videos', () =>
      importPhotosAndVideosSection(database, snapshotId, archiveRoot, (progress: ImportProgressEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.importProgress, progress);
      })
    );
  });

  ipcMain.handle(IPC_CHANNELS.importFriendsForSelectedBackup, async (event) => {
    const archiveRoot = selectedBackupDirectory;
    const snapshotId = selectedSnapshotId;
    if (!archiveRoot || !snapshotId) {
      throw new Error('Inspect an archive folder before importing Friends data.');
    }

    return runExclusiveImport('Friends', () => importFriendsSection(database, snapshotId, archiveRoot, (progress: ImportProgressEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.importProgress, progress);
    }));
  });
}
