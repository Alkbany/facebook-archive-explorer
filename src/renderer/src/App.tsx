import { useEffect, useState } from 'react';
import type {
  ArchiveInspectionView,
  ArchiveSnapshotSummary,
  ArchiveFileDirectoryView,
  ArchiveFileStatus,
  FriendsImportSectionResult,
  PostsImportSectionResult,
  CommentsImportSectionResult,
  CommentActivitySummary,
  EventRecordSummary,
  MarketplaceListingSummary,
  SavedItemSummary,
  PostRecordSummary,
  MessagesImportSectionResult,
  ReactionsImportSectionResult,
  ReactionRecordSummary,
  ImportAllSupportedDataResult,
  ImportIssueReport,
  ImportCoverageReport,
  ImportProgressEvent,
  PhotoAlbumRecordSummary,
  PhotoAlbumDetailView,
  PhotoAlbumsImportSectionResult,
  FriendDirectoryFilter,
  FriendDirectoryView,
  FallbackArchiveSectionSummary,
  FallbackArchiveRecordsPage
} from '../../shared/archive/inspection';
import { ARCHIVE_SECTIONS, getArchiveImportCapability } from '../../shared/archive/section-registry';
import { getGroupActivityMetadata } from '../../shared/archive/groups';
import type { MessageConversationSummary, MessageRecordSummary } from '../../shared/archive/messages';
import type { ArchiveMediaGalleryFilter, ArchiveMediaGalleryItem } from '../../shared/archive/media';
import { ARCHIVE_SEARCH_PAGE_SIZE, MAX_ARCHIVE_SEARCH_OFFSET, type ArchiveSearchMode, type ArchiveSearchResult, type SemanticSearchStatus } from '../../shared/archive/search';
import type { AiAssistantStatus, ArchiveAssistantAnswer, AiAssistantHistoryMessage } from '../../shared/archive/assistant';
import type {
  ArchiveComparisonReport,
  ArchiveComparisonChangeKind,
  ArchiveComparisonChangesPage,
  ArchiveComparisonExportFormat
} from '../../shared/archive/comparison';

const SECTION_TITLES = new Map([...ARCHIVE_SECTIONS.map((section) => [section.key, section.title] as const), ['json', 'Structured JSON'] as const, ['html_fallback', 'HTML fallback'] as const, ['text_fallback', 'Text fallback'] as const]);

const ARCHIVE_FILE_STATUS_LABELS: Record<Exclude<ArchiveFileStatus, 'all'>, string> = {
  discovered: 'Not processed',
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  empty: 'Empty',
  unsupported: 'Unsupported',
  failed: 'Failed',
  skipped: 'Skipped'
};

function isUtcDateInRange(value: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  if (from && timestamp < Date.parse(`${from}T00:00:00.000Z`)) return false;
  if (to && timestamp > Date.parse(`${to}T23:59:59.999Z`)) return false;
  return true;
}

function formatActivityDate(dateRaw: string | null, eventTimeUtc: string | null): string {
  if (!eventTimeUtc) return dateRaw ?? 'Date not provided';
  const date = new Date(eventTimeUtc);
  if (!Number.isFinite(date.getTime())) return dateRaw ?? 'Date not provided';
  const localDate = date.toLocaleString();
  return dateRaw
    ? localDate + ' local · Original: ' + dateRaw
    : localDate + ' local';
}

function ActivityDateFilters(props: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  return (
    <div className="activity-date-filters">
      <label>
        From
        <input type="date" value={props.from} max={props.to || undefined} onChange={(event) => props.onFromChange(event.target.value)} />
      </label>
      <label>
        To
        <input type="date" value={props.to} min={props.from || undefined} onChange={(event) => props.onToChange(event.target.value)} />
      </label>
      <span>Filters use normalized UTC dates; records with raw-only dates are excluded while a range is active.</span>
    </div>
  );
}

function formatFallbackPayload(
  payload: string,
  recordType: 'html_item' | 'json_item' | 'text_item'
): string {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (
      recordType === 'text_item' &&
      typeof parsed === 'object' &&
      parsed !== null &&
      'text' in parsed &&
      typeof parsed.text === 'string'
    ) {
      return parsed.text;
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return payload;
  }
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'Size not recorded';
  if (bytes < 1024) return bytes.toLocaleString() + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return value.toFixed(value >= 100 ? 0 : 1) + ' ' + units[unit];
}

const FRIEND_STATUS_LABELS: Record<FriendDirectoryView['records'][number]['recordType'], string> = {
  friend: 'Friend',
  received: 'Received request',
  sent: 'Sent request',
  rejected: 'Rejected request',
  removed: 'Removed friend'
};

function App() {
  const [version, setVersion] = useState('0.1.0');
  const [accountName, setAccountName] = useState('My Facebook account');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [inspection, setInspection] = useState<ArchiveInspectionView | null>(null);
  const [savedBackups, setSavedBackups] = useState<ArchiveSnapshotSummary[]>([]);
  const [importIssueReport, setImportIssueReport] = useState<ImportIssueReport | null>(null);
  const [isRefreshingImportIssues, setIsRefreshingImportIssues] = useState(false);
  const [importCoverage, setImportCoverage] = useState<ImportCoverageReport | null>(null);
  const [isRefreshingImportCoverage, setIsRefreshingImportCoverage] = useState(false);
  const [archiveFileDirectory, setArchiveFileDirectory] = useState<ArchiveFileDirectoryView | null>(null);
  const [archiveFileStatus, setArchiveFileStatus] = useState<ArchiveFileStatus>('all');
  const [archiveFileSection, setArchiveFileSection] = useState('all');
  const [archiveFileQuery, setArchiveFileQuery] = useState('');
  const [archiveFilePage, setArchiveFilePage] = useState(1);
  const [isLoadingArchiveFiles, setIsLoadingArchiveFiles] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressEvent | null>(null);
  const [isImportPaused, setIsImportPaused] = useState(false);
  const [fallbackSections, setFallbackSections] = useState<FallbackArchiveSectionSummary[]>([]);
  const [fallbackSectionKey, setFallbackSectionKey] = useState('');
  const [fallbackQuery, setFallbackQuery] = useState('');
  const [fallbackAppliedQuery, setFallbackAppliedQuery] = useState('');
  const [fallbackRecords, setFallbackRecords] = useState<FallbackArchiveRecordsPage | null>(null);
  const [isLoadingFallbackRecords, setIsLoadingFallbackRecords] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSection, setSearchSection] = useState('all');
  const [searchResults, setSearchResults] = useState<ArchiveSearchResult[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [searchMode, setSearchMode] = useState<ArchiveSearchMode>('exact');
  const [searchThreshold, setSearchThreshold] = useState(0.8);
  const [searchDateFrom, setSearchDateFrom] = useState('');
  const [searchDateTo, setSearchDateTo] = useState('');
  const [searchedDateFrom, setSearchedDateFrom] = useState('');
  const [searchedDateTo, setSearchedDateTo] = useState('');
  const [includeMessagesInGlobalSearch, setIncludeMessagesInGlobalSearch] = useState(false);
  const [isUpdatingMessageSearch, setIsUpdatingMessageSearch] = useState(false);
  const [semanticSearchStatus, setSemanticSearchStatus] = useState<SemanticSearchStatus | null>(null);
  const [isUpdatingSemanticSearch, setIsUpdatingSemanticSearch] = useState(false);
  const [aiAssistantStatus, setAiAssistantStatus] = useState<AiAssistantStatus | null>(null);
  const [isUpdatingAiAssistant, setIsUpdatingAiAssistant] = useState(false);
  const [assistantQuestion, setAssistantQuestion] = useState('');
  const [assistantSection, setAssistantSection] = useState('all');
  const [assistantConversation, setAssistantConversation] = useState<Array<{
    question: string;
    response: ArchiveAssistantAnswer;
  }>>([]);
  const [isAskingAssistant, setIsAskingAssistant] = useState(false);

  const [searchedMode, setSearchedMode] = useState<ArchiveSearchMode>('exact');
  const [searchedThreshold, setSearchedThreshold] = useState(0.8);
  const [isSearching, setIsSearching] = useState(false);
  const [searchExportStatus, setSearchExportStatus] = useState('');
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [searchedSection, setSearchedSection] = useState('all');
  const [comparisonBaselineId, setComparisonBaselineId] = useState('');
  const [comparisonTargetId, setComparisonTargetId] = useState('');
  const [comparisonReport, setComparisonReport] = useState<ArchiveComparisonReport | null>(null);
  const [comparisonChanges, setComparisonChanges] = useState<ArchiveComparisonChangesPage | null>(null);
  const [comparisonChangeFilter, setComparisonChangeFilter] = useState<ArchiveComparisonChangeKind>('all');
  const [comparisonChangeSection, setComparisonChangeSection] = useState('all');
  const [comparisonChangeQuery, setComparisonChangeQuery] = useState('');
  const [comparisonAppliedQuery, setComparisonAppliedQuery] = useState('');
  const [comparisonChangePage, setComparisonChangePage] = useState(1);
  const [isLoadingComparisonChanges, setIsLoadingComparisonChanges] = useState(false);
  const [comparisonExportFormat, setComparisonExportFormat] = useState<ArchiveComparisonExportFormat>('csv');
  const [comparisonExportStatus, setComparisonExportStatus] = useState('');
  const [isComparingBackups, setIsComparingBackups] = useState(false);
  const [friendsImport, setFriendsImport] = useState<FriendsImportSectionResult | null>(null);
  const [friendDirectory, setFriendDirectory] = useState<FriendDirectoryView | null>(null);
  const [friendTypeFilter, setFriendTypeFilter] = useState<FriendDirectoryFilter>('all');
  const [friendQuery, setFriendQuery] = useState('');
  const [friendPage, setFriendPage] = useState(1);
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);
  const [eventRecords, setEventRecords] = useState<EventRecordSummary[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isImportingEvents, setIsImportingEvents] = useState(false);
  const [marketplaceListings, setMarketplaceListings] = useState<MarketplaceListingSummary[]>([]);
  const [isLoadingMarketplace, setIsLoadingMarketplace] = useState(false);
  const [isImportingMarketplace, setIsImportingMarketplace] = useState(false);
  const [savedItems, setSavedItems] = useState<SavedItemSummary[]>([]);
  const [isLoadingSavedItems, setIsLoadingSavedItems] = useState(false);
  const [isImportingSavedItems, setIsImportingSavedItems] = useState(false);
  const [activeNavigation, setActiveNavigation] = useState('overview');
  const [postsImport, setPostsImport] = useState<PostsImportSectionResult | null>(null);
  const [postRecords, setPostRecords] = useState<PostRecordSummary[]>([]);
  const [postFilter, setPostFilter] = useState('');
  const [postDateFrom, setPostDateFrom] = useState('');
  const [postDateTo, setPostDateTo] = useState('');
  const [commentsImport, setCommentsImport] = useState<CommentsImportSectionResult | null>(null);
  const [commentRecords, setCommentRecords] = useState<CommentActivitySummary[]>([]);
  const [commentFilter, setCommentFilter] = useState('');
  const [commentDateFrom, setCommentDateFrom] = useState('');
  const [commentDateTo, setCommentDateTo] = useState('');
  const [isImportingComments, setIsImportingComments] = useState(false);
  const [isImportingPosts, setIsImportingPosts] = useState(false);
  const [messagesImport, setMessagesImport] = useState<MessagesImportSectionResult | null>(null);
  const [reactionsImport, setReactionsImport] = useState<ReactionsImportSectionResult | null>(null);
  const [photosImport, setPhotosImport] = useState<PhotoAlbumsImportSectionResult | null>(null);
  const [reactionRecords, setReactionRecords] = useState<ReactionRecordSummary[]>([]);
  const [reactionFilter, setReactionFilter] = useState('');
  const [reactionDateFrom, setReactionDateFrom] = useState('');
  const [reactionDateTo, setReactionDateTo] = useState('');
  const [isImportingReactions, setIsImportingReactions] = useState(false);
  const [isImportingPhotos, setIsImportingPhotos] = useState(false);
  const [isImportingMessages, setIsImportingMessages] = useState(false);
  const [conversations, setConversations] = useState<MessageConversationSummary[]>([]);
  const [conversationMessages, setConversationMessages] = useState<MessageRecordSummary[]>([]);
  const [mediaGallery, setMediaGallery] = useState<ArchiveMediaGalleryItem[]>([]);
  const [mediaTotal, setMediaTotal] = useState(0);
  const [mediaPage, setMediaPage] = useState(1);
  const [mediaPageSize, setMediaPageSize] = useState(100);
  const [mediaQuery, setMediaQuery] = useState('');
  const [mediaQueryInput, setMediaQueryInput] = useState('');
  const [isLoadingMedia, setIsLoadingMedia] = useState(false);
  const [photoAlbums, setPhotoAlbums] = useState<PhotoAlbumRecordSummary[]>([]);
  const [albumFilter, setAlbumFilter] = useState('');
  const [photoAlbumCovers, setPhotoAlbumCovers] = useState<Record<number, string>>({});
  const [photoAlbumCoverFailures, setPhotoAlbumCoverFailures] = useState<Record<number, boolean>>({});
  const [selectedPhotoAlbum, setSelectedPhotoAlbum] = useState<PhotoAlbumRecordSummary | null>(null);
  const [photoAlbumDetail, setPhotoAlbumDetail] = useState<PhotoAlbumDetailView | null>(null);
  const [isLoadingPhotoAlbum, setIsLoadingPhotoAlbum] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<ArchiveMediaGalleryFilter>('all');
  const [mediaViewMode, setMediaViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [conversationFilter, setConversationFilter] = useState('');
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [activeMedia, setActiveMedia] = useState<{ id: number; mediaKind: string; relativePath: string; dataUrl: string | null; streamUrl: string | null; loading: boolean; error: string | null } | null>(null);
  const [isImportingFriends, setIsImportingFriends] = useState(false);
  const [isImportingAll, setIsImportingAll] = useState(false);
  const [importAllSummary, setImportAllSummary] = useState<ImportAllSupportedDataResult['totals'] | null>(null);
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const [isExportingDatabase, setIsExportingDatabase] = useState(false);
  const [isRestoringDatabase, setIsRestoringDatabase] = useState(false);
  const [databaseBackupStatus, setDatabaseBackupStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isAnyImporting = isImportingAll || isImportingFriends || isImportingMessages || isImportingPosts || isImportingComments || isImportingReactions || isImportingPhotos || isImportingEvents || isImportingMarketplace || isImportingSavedItems;

  useEffect(() => {
    if (!isAnyImporting) setIsImportPaused(false);
  }, [isAnyImporting]);

  useEffect(() => {
    let cancelled = false;
    const visibleAlbums = photoAlbums.filter((album) =>
      [album.albumTitle, album.dateRaw, album.albumPath, album.sourcePath]
        .join(' ')
        .toLocaleLowerCase()
        .includes(albumFilter.trim().toLocaleLowerCase())
    ).slice(0, 8);
    const pendingAlbums = visibleAlbums.filter((album) =>
      album.coverAssetId !== null &&
      !photoAlbumCovers[album.id] &&
      !photoAlbumCoverFailures[album.id]
    );

    if (pendingAlbums.length > 0) {
      void Promise.all(pendingAlbums.map(async (album) => {
        try {
          return {
            albumId: album.id,
            dataUrl: await window.desktopApi.getMessageMediaPreview(album.coverAssetId as number)
          };
        } catch {
          return { albumId: album.id, dataUrl: null };
        }
      })).then((results) => {
        if (cancelled) return;
        const successful = results.filter((result): result is { albumId: number; dataUrl: string } => result.dataUrl !== null);
        const failed = results.filter((result) => result.dataUrl === null);
        if (successful.length > 0) {
          setPhotoAlbumCovers((current) => ({
            ...current,
            ...Object.fromEntries(successful.map((result) => [result.albumId, result.dataUrl]))
          }));
        }
        if (failed.length > 0) {
          setPhotoAlbumCoverFailures((current) => ({
            ...current,
            ...Object.fromEntries(failed.map((result) => [result.albumId, true]))
          }));
        }
      });
    }

    return () => { cancelled = true; };
  }, [photoAlbums, albumFilter, photoAlbumCovers, photoAlbumCoverFailures]);

  useEffect(() => window.desktopApi.onImportProgress(setImportProgress), []);

  useEffect(() => {
    if (!semanticSearchStatus?.enabled) return;
    const refresh = () => {
      void window.desktopApi.getSemanticSearchStatus()
        .then(setSemanticSearchStatus)
        .catch(() => undefined);
    };
    const interval = window.setInterval(refresh, 1_500);
    return () => window.clearInterval(interval);
  }, [semanticSearchStatus?.enabled]);

  useEffect(() => {
    if (!aiAssistantStatus?.enabled) return;
    const refresh = () => {
      void window.desktopApi.getAiAssistantStatus()
        .then(setAiAssistantStatus)
        .catch(() => undefined);
    };
    const interval = window.setInterval(refresh, 1_500);
    return () => window.clearInterval(interval);
  }, [aiAssistantStatus?.enabled]);

  useEffect(() => {
    void window.desktopApi.getAppInfo()
      .then((info) => setVersion(info.appVersion))
      .catch(() => setError('Could not read application information.'));

    void window.desktopApi.listArchiveSnapshots()
      .then(setSavedBackups)
      .catch(() => setError('Could not load saved backups from the local database.'));

    void window.desktopApi.getArchiveSearchSettings()
      .then((settings) => setIncludeMessagesInGlobalSearch(settings.includeMessagesInGlobalSearch))
      .catch(() => setError('Could not load local search privacy settings.'));
    void window.desktopApi.getSemanticSearchStatus()
      .then(setSemanticSearchStatus)
      .catch(() => setError('Could not load Semantic Search status.'));
    void window.desktopApi.getAiAssistantStatus()
      .then(setAiAssistantStatus)
      .catch(() => setError('Could not load AI Assistant status.'));
  }, []);

  async function chooseFolder() {
    setIsChoosingFolder(true);
    setError(null);
    setInspection(null);
    setImportIssueReport(null);
    setImportCoverage(null);
    setArchiveFileDirectory(null);
    setFallbackSections([]);
    setFallbackSectionKey('');
    setFallbackQuery('');
    setFallbackAppliedQuery('');
    setFallbackRecords(null);
    setArchiveFileStatus('all');
    setArchiveFileSection('all');
    setArchiveFileQuery('');
    setArchiveFilePage(1);
    setImportProgress(null);
    setSearchResults([]);
    setSearchQuery('');
    setSearchExportStatus('');
    setSearchedQuery(null);
    setSearchedSection('all');
    setComparisonReport(null);
    setMediaGallery([]);
    setMediaTotal(0);
    setMediaFilter('all');
    setMediaQuery('');
    setMediaQueryInput('');
    setMediaPage(1);
    setPhotoAlbums([]);
    setPhotoAlbumCovers({});
    setPhotoAlbumCoverFailures({});
    setAlbumFilter('');
    setSelectedPhotoAlbum(null);
    setPhotoAlbumDetail(null);
    setIsLoadingPhotoAlbum(false);
    setImportAllSummary(null);
    setPhotosImport(null);
    setFriendsImport(null);
    setFriendDirectory(null);
    setEventRecords([]);
    setMarketplaceListings([]);
    setSavedItems([]);
    setFriendTypeFilter('all');
    setFriendQuery('');
    setFriendPage(1);
    setPostsImport(null);
    setPostRecords([]);
    setPostFilter('');
    setMessagesImport(null);
    setReactionsImport(null);
    setReactionRecords([]);
    setReactionFilter('');
    setConversations([]);
    setConversationMessages([]);
    setMediaGallery([]);
    setMediaTotal(0);
    setMediaFilter('all');
    setMediaQuery('');
    setMediaQueryInput('');
    setMediaPage(1);
    setSelectedConversationId(null);
    setConversationFilter('');

    try {
      const selection = await window.desktopApi.selectBackupDirectory(accountName);
      if (selection.status === 'cancelled') return;

      setSelectedFolder(selection.folderName);
      setAccountName(selection.accountName);
      const report = await window.desktopApi.inspectSelectedBackup();
      setInspection(report);
      const [media, issues, coverage, backups, files] = await Promise.all([
        window.desktopApi.listMediaForSelectedBackup('all', 1, ''),
        window.desktopApi.listImportIssuesForSelectedBackup(),
        window.desktopApi.getImportCoverageForSelectedBackup(),
        window.desktopApi.listArchiveSnapshots(),
        window.desktopApi.listArchiveFilesForSelectedBackup('all', 'all', '', 1)
      ]);
      setMediaGallery(media.items);
      setMediaTotal(media.total);
      setMediaPage(media.page);
      setMediaPageSize(media.pageSize);
      setImportIssueReport(issues);
      setImportCoverage(coverage);
      setArchiveFileDirectory(files);
      setArchiveFilePage(files.page);
      setSavedBackups(backups);
    } catch {
      setError('The selected folder could not be inspected. Check that it is accessible and try again.');
    } finally {
      setIsChoosingFolder(false);
    }
  }


  async function openSavedBackup(snapshotId: string) {
    setIsChoosingFolder(true);
    setError(null);
    setInspection(null);
    setImportIssueReport(null);
    setImportCoverage(null);
    setArchiveFileDirectory(null);
    setFallbackQuery('');
    setFallbackAppliedQuery('');
    setArchiveFileStatus('all');
    setArchiveFileSection('all');
    setArchiveFileQuery('');
    setArchiveFilePage(1);
    setSearchResults([]);
    setSearchQuery('');
    setSearchExportStatus('');
    setSearchedQuery(null);
    setSearchedSection('all');
    setComparisonReport(null);
    setMediaGallery([]);
    setMediaTotal(0);
    setMediaFilter('all');
    setMediaQuery('');
    setMediaQueryInput('');
    setMediaPage(1);
    setPhotoAlbums([]);
    setPhotoAlbumCovers({});
    setPhotoAlbumCoverFailures({});
    setAlbumFilter('');
    setSelectedPhotoAlbum(null);
    setPhotoAlbumDetail(null);
    setIsLoadingPhotoAlbum(false);
    setImportAllSummary(null);
    setPhotosImport(null);
    setFriendsImport(null);
    setFriendDirectory(null);
    setFriendTypeFilter('all');
    setFriendQuery('');
    setFriendPage(1);
    setPostsImport(null);
    setPostRecords([]);
    setPostFilter('');
    setCommentsImport(null);
    setCommentRecords([]);
    setCommentFilter('');
    setMessagesImport(null);
    setReactionsImport(null);
    setReactionRecords([]);
    setReactionFilter('');
    setConversations([]);
    setConversationMessages([]);
    setSelectedConversationId(null);
    setConversationFilter('');
    setActiveMedia(null);
    setMediaFilter('all');
    setMediaQuery('');
    setMediaQueryInput('');
    setMediaPage(1);

    try {
      const report = await window.desktopApi.openSavedSnapshot(snapshotId);
      const saved = savedBackups.find((backup) => backup.id === snapshotId);
      setSelectedFolder(report.archiveName);
      if (saved) setAccountName(saved.accountName);
      setInspection(report);
      const [posts, comments, reactions, foundConversations, media, issues, coverage, albums, friends, files, fallback, events, marketplace, savedItems] = await Promise.all([
        window.desktopApi.listPostsForSelectedBackup(),
        window.desktopApi.listCommentsForSelectedBackup(),
        window.desktopApi.listReactionsForSelectedBackup(),
        window.desktopApi.listMessagesForSelectedBackup(),
        window.desktopApi.listMediaForSelectedBackup('all', 1, ''),
        window.desktopApi.listImportIssuesForSelectedBackup(),
        window.desktopApi.getImportCoverageForSelectedBackup(),
        window.desktopApi.listPhotoAlbumsForSelectedBackup(),
        window.desktopApi.listFriendsDirectoryForSelectedBackup('all', '', 1),
        window.desktopApi.listArchiveFilesForSelectedBackup('all', 'all', '', 1),
        window.desktopApi.listFallbackRecordSectionsForSelectedBackup(),
        window.desktopApi.listEventsForSelectedBackup(),
        window.desktopApi.listMarketplaceForSelectedBackup(),
        window.desktopApi.listSavedItemsForSelectedBackup()
      ]);
      setPostRecords(posts);
      setCommentRecords(comments);
      setReactionRecords(reactions);
      setConversations(foundConversations);
      setMediaGallery(media.items);
      setMediaTotal(media.total);
      setMediaPage(media.page);
      setPhotoAlbums(albums);
      setFriendDirectory(friends);
      setFriendPage(friends.page);
      setImportIssueReport(issues);
      setImportCoverage(coverage);
      setArchiveFileDirectory(files);
      setArchiveFilePage(files.page);
      setFallbackSections(fallback);
      setEventRecords(events);
      setMarketplaceListings(marketplace);
      setSavedItems(savedItems);
      if (fallback.length > 0) await loadFallbackArchiveRecords(fallback[0].sectionKey, 1);
      if (foundConversations.length > 0) await loadConversation(foundConversations[0].sourceFileId);
    } catch {
      setInspection(null);
      setError('Could not reopen this saved backup. Its original folder may have been moved, renamed, or disconnected. Select the original folder or ZIP again to create a fresh inventory.');
    } finally {
      setIsChoosingFolder(false);
    }
  }

  async function openPhotoAlbum(album: PhotoAlbumRecordSummary) {
    setSelectedPhotoAlbum(album);
    setPhotoAlbumDetail(null);
    setIsLoadingPhotoAlbum(true);
    try {
      const detail = await window.desktopApi.getPhotoAlbumDetailForSelectedBackup(album.id);
      setPhotoAlbumDetail(detail);
    } catch {
      setError('This photo album could not be opened from the selected backup.');
    } finally {
      setIsLoadingPhotoAlbum(false);
    }
  }

  function closePhotoAlbum() {
    setSelectedPhotoAlbum(null);
    setPhotoAlbumDetail(null);
    setIsLoadingPhotoAlbum(false);
  }

  async function loadFallbackArchiveRecords(
    sectionKey: string,
    page: number,
    query = fallbackAppliedQuery
  ) {
    const appliedQuery = query.trim().slice(0, 120);
    setIsLoadingFallbackRecords(true);
    setFallbackSectionKey(sectionKey);
    setFallbackAppliedQuery(appliedQuery);
    try {
      const result = await window.desktopApi.listFallbackArchiveRecordsForSelectedBackup(sectionKey, page, appliedQuery);
      setFallbackRecords(result);
    } catch {
      setFallbackRecords(null);
      setError('The preserved archive records could not be loaded.');
    } finally {
      setIsLoadingFallbackRecords(false);
    }
  }

  async function loadMediaGallery(
    filter: ArchiveMediaGalleryFilter = mediaFilter,
    page: number = mediaPage,
    query: string = mediaQuery,
    pageSize: number = mediaPageSize
  ) {
    setIsLoadingMedia(true);
    try {
      const boundedQuery = query.trim().slice(0, 180);
      const result = await window.desktopApi.listMediaForSelectedBackup(filter, page, boundedQuery, pageSize);
      setMediaGallery(result.items);
      setMediaTotal(result.total);
      setMediaPage(result.page);
      setMediaPageSize(result.pageSize);
      setMediaFilter(filter);
      setMediaQuery(boundedQuery);
      setMediaQueryInput(boundedQuery);
    } catch {
      setError('The local media index could not be refreshed.');
    } finally {
      setIsLoadingMedia(false);
    }
  }

  async function refreshMediaGallery() {
    await loadMediaGallery(mediaFilter, mediaPage, mediaQuery);
  }

  async function refreshImportIssues() {
    setIsRefreshingImportIssues(true);
    try {
      setImportIssueReport(await window.desktopApi.listImportIssuesForSelectedBackup());
    } catch {
      setError('The import diagnostics report could not be refreshed.');
    } finally {
      setIsRefreshingImportIssues(false);
    }
  }

  async function refreshImportCoverage() {
    setIsRefreshingImportCoverage(true);
    try {
      const [coverage, files] = await Promise.all([
        window.desktopApi.getImportCoverageForSelectedBackup(),
        window.desktopApi.listArchiveFilesForSelectedBackup(archiveFileStatus, archiveFileSection, archiveFileQuery, archiveFilePage)
      ]);
      setImportCoverage(coverage);
      setArchiveFileDirectory(files);
      setArchiveFilePage(files.page);
    } catch {
      setError('The archive import coverage could not be refreshed.');
    } finally {
      setIsRefreshingImportCoverage(false);
    }
  }

  async function runArchiveSearch(page = 1) {
    const requestedPage = Math.max(1, Math.floor(page));
    const resultOffset = (requestedPage - 1) * ARCHIVE_SEARCH_PAGE_SIZE;
    const query = searchQuery;
    const section = searchSection === 'all' ? null : searchSection;
    setIsSearching(true);
    setSearchExportStatus('');
    setSearchedQuery(null);
    setError(null);
    try {
      const effectiveMode = searchSection === 'messages' && !includeMessagesInGlobalSearch ? 'exact' : searchMode;
      const results = await window.desktopApi.searchRecordsForSelectedBackup(
        query, section, effectiveMode, searchThreshold,
        searchDateFrom || null, searchDateTo || null, resultOffset
      );
      setSearchPage(requestedPage);
      setSearchResults(results);
      setSearchedQuery(query);
      setSearchedSection(searchSection);
      setSearchedMode(effectiveMode);
      setSearchedThreshold(searchThreshold);
      setSearchedDateFrom(searchDateFrom);
      setSearchedDateTo(searchDateTo);
    } catch {
      setSearchResults([]);
      setError('Search could not be completed. Try a shorter search phrase.');
    } finally {
      setIsSearching(false);
    }
  }

  async function updateMessageSearchSetting(enabled: boolean) {
    setIsUpdatingMessageSearch(true);
    setError(null);
    try {
      const settings = await window.desktopApi.setIncludeMessagesInGlobalSearch(enabled);
      setIncludeMessagesInGlobalSearch(settings.includeMessagesInGlobalSearch);
      if (!enabled && searchMode === 'semantic') setSearchMode('exact');
      if (!settings.includeMessagesInGlobalSearch && searchSection === 'messages' && searchMode === 'fuzzy') setSearchMode('exact');
      setSearchResults([]);
      setSearchedQuery(null);
      setSearchExportStatus('');
    } catch {
      setError('The message-search privacy setting could not be updated.');
    } finally {
      setIsUpdatingMessageSearch(false);
    }
  }

  async function updateSemanticSearchSetting(enabled: boolean) {
    setIsUpdatingSemanticSearch(true);
    setError(null);
    try {
      const status = await window.desktopApi.setSemanticSearchEnabled(enabled);
      setSemanticSearchStatus(status);
      setSearchResults([]);
      setSearchedQuery(null);
      setSearchExportStatus('');
    } catch {
      setError('Semantic Search could not be enabled or disabled.');
      const status = await window.desktopApi.getSemanticSearchStatus().catch(() => null);
      if (status) setSemanticSearchStatus(status);
    } finally {
      setIsUpdatingSemanticSearch(false);
    }
  }

  async function retrySemanticIndexing() {
    setIsUpdatingSemanticSearch(true);
    setError(null);
    try {
      const status = await window.desktopApi.retrySemanticIndexing();
      setSemanticSearchStatus(status);
    } catch {
      setError('Semantic indexing could not be restarted.');
    } finally {
      setIsUpdatingSemanticSearch(false);
    }
  }

  async function updateAiAssistantSetting(enabled: boolean) {
    setIsUpdatingAiAssistant(true);
    setError(null);
    try {
      const status = await window.desktopApi.setAiAssistantEnabled(enabled);
      setAiAssistantStatus(status);
      if (!enabled) setAssistantConversation([]);
    } catch {
      setError('The local AI Assistant setting could not be updated.');
      const status = await window.desktopApi.getAiAssistantStatus().catch(() => null);
      if (status) setAiAssistantStatus(status);
    } finally {
      setIsUpdatingAiAssistant(false);
    }
  }

  async function retryAiAssistantModel() {
    setIsUpdatingAiAssistant(true);
    setError(null);
    try {
      const status = await window.desktopApi.setAiAssistantEnabled(true);
      setAiAssistantStatus(status);
    } catch {
      setError('The local AI Assistant model could not be prepared.');
    } finally {
      setIsUpdatingAiAssistant(false);
    }
  }

  async function askArchiveAssistant() {
    const question = assistantQuestion.trim();
    if (question.length < 2 || !aiAssistantStatus?.enabled) return;
    setIsAskingAssistant(true);
    setError(null);
    try {
      const history: AiAssistantHistoryMessage[] = assistantConversation
        .slice(-6)
        .flatMap((turn) => [
          { role: 'user' as const, content: turn.question },
          { role: 'assistant' as const, content: turn.response.answer }
        ]);
      const response = await window.desktopApi.askArchiveAssistant(
        question,
        assistantSection === 'all' ? null : assistantSection,
        history
      );
      setAssistantConversation((current) => [...current, { question, response }].slice(-8));
      setAssistantQuestion('');
    } catch {
      setError('The local assistant could not complete this question. Check its model status and try again.');
      const status = await window.desktopApi.getAiAssistantStatus().catch(() => null);
      if (status) setAiAssistantStatus(status);
    } finally {
      setIsAskingAssistant(false);
    }
  }

  async function openAssistantSource(source: ArchiveAssistantAnswer['citations'][number]) {
    await loadArchiveFiles('all', 'all', source.sourcePath, 1);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => navigateToSection('files', 'archive-files-workspace'));
    });
  }

  async function exportArchiveSearch() {
    if (searchedQuery === null) return;
    setSearchExportStatus('');
    setError(null);
    try {
      const result = await window.desktopApi.exportSearchResultsForSelectedBackup(
        searchedQuery, searchedSection === 'all' ? null : searchedSection, searchedMode, searchedThreshold,
        searchedDateFrom || null, searchedDateTo || null, (searchPage - 1) * ARCHIVE_SEARCH_PAGE_SIZE
      );
      setSearchExportStatus(result.status === 'saved'
        ? `Saved ${result.recordsExported} records to ${result.fileName}.`
        : 'Export cancelled.');
    } catch {
      setError('Search results could not be exported.');
    }
  }

  async function exportLocalDatabaseBackup() {
    setIsExportingDatabase(true);
    setDatabaseBackupStatus('');
    setError(null);
    try {
      const result = await window.desktopApi.exportLocalDatabaseBackup();
      setDatabaseBackupStatus(result.status === 'saved'
        ? `Exported ${result.fileName} · ${(result.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
        : 'Database backup export cancelled.');
    } catch {
      setError('The application database backup could not be exported. Finish any active import and try again.');
    } finally {
      setIsExportingDatabase(false);
    }
  }

  async function restoreLocalDatabaseBackup() {
    setIsRestoringDatabase(true);
    setDatabaseBackupStatus('Choose a database backup to validate.');
    setError(null);
    try {
      const result = await window.desktopApi.restoreLocalDatabaseBackup();
      setDatabaseBackupStatus(result.status === 'restarting'
        ? 'Restoring the selected database and restarting…'
        : 'Database restore cancelled.');
    } catch {
      setDatabaseBackupStatus('');
      setError('The selected file could not be restored. The current local archive database has been left unchanged.');
    } finally {
      setIsRestoringDatabase(false);
    }
  }

  async function loadComparisonChanges(
    baselineId: string,
    comparedId: string,
    filter: ArchiveComparisonChangeKind,
    sectionKey: string,
    query: string,
    page: number
  ) {
    setIsLoadingComparisonChanges(true);
    setComparisonChangeFilter(filter);
    setComparisonChangeSection(sectionKey);
    setComparisonChangeQuery(query);
    setComparisonChangePage(page);
    setComparisonExportStatus('');
    try {
      const result = await window.desktopApi.listArchiveComparisonChanges(
        baselineId, comparedId, filter, sectionKey, query, page
      );
      setComparisonChanges(result);
      setComparisonAppliedQuery(query);
      setComparisonChangePage(result.page);
    } catch {
      setComparisonChanges(null);
      setError('The detailed comparison could not be loaded. Run the comparison again and retry.');
    } finally {
      setIsLoadingComparisonChanges(false);
    }
  }

  async function exportComparisonChanges() {
    setComparisonExportStatus('');
    setError(null);
    try {
      const result = await window.desktopApi.exportArchiveComparisonChanges(
        comparisonBaselineId,
        comparisonTargetId,
        comparisonChangeFilter,
        comparisonChangeSection,
        comparisonAppliedQuery,
        comparisonExportFormat
      );
      setComparisonExportStatus(result.status === 'saved'
        ? result.recordsExported.toLocaleString() + ' changes exported to ' + result.fileName
        : 'Comparison export cancelled.');
    } catch {
      setError('The comparison could not be exported. Narrow the filters and try again.');
    }
  }

  async function compareBackups() {
    setIsComparingBackups(true);
    setComparisonReport(null);
    setComparisonChanges(null);
    setComparisonChangeFilter('all');
    setComparisonChangeSection('all');
    setComparisonChangeQuery('');
    setComparisonAppliedQuery('');
    setComparisonChangePage(1);
    setComparisonExportStatus('');
    setError(null);
    try {
      const report = await window.desktopApi.compareArchiveSnapshots(comparisonBaselineId, comparisonTargetId);
      setComparisonReport(report);
      await loadComparisonChanges(comparisonBaselineId, comparisonTargetId, 'all', 'all', '', 1);
    } catch {
      setError('These backups could not be compared. Choose two different backups belonging to the same account.');
    } finally {
      setIsComparingBackups(false);
    }
  }

  async function importPosts() {
    setIsImportingPosts(true);
    setError(null);
    try {
      const result = await window.desktopApi.importPostsForSelectedBackup();
      setPostsImport(result);
      setPostRecords(await window.desktopApi.listPostsForSelectedBackup());
      await refreshMediaGallery();
      await refreshImportIssues();
      await refreshImportCoverage();
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch {
      setError('Posts data could not be imported. Check the local import report.');
    } finally {
      setIsImportingPosts(false);
    }
  }

  async function importComments() {
    setIsImportingComments(true);
    setError(null);
    try {
      const result = await window.desktopApi.importCommentsForSelectedBackup();
      setCommentsImport(result);
      setCommentRecords(await window.desktopApi.listCommentsForSelectedBackup());
      await refreshMediaGallery();
      await refreshImportIssues();
      await refreshImportCoverage();
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch {
      setError('Comments data could not be imported. Check the local import report.');
    } finally {
      setIsImportingComments(false);
    }
  }

  async function loadFriendsDirectory(filter: FriendDirectoryFilter, query: string, page: number) {
    setIsLoadingFriends(true);
    setFriendTypeFilter(filter);
    setFriendQuery(query);
    setFriendPage(page);
    try {
      const result = await window.desktopApi.listFriendsDirectoryForSelectedBackup(filter, query, page);
      setFriendDirectory(result);
      setFriendPage(result.page);
    } catch {
      setError('The Friends directory could not be loaded. Import Friends first and try again.');
    } finally {
      setIsLoadingFriends(false);
    }
  }

  async function openExternalLink(url: string) {
    try {
      await window.desktopApi.openExternalUrl(url);
    } catch {
      setError('This external link could not be opened. Only valid HTTP and HTTPS links are allowed.');
    }
  }

  async function loadEvents() {
    setIsLoadingEvents(true);
    try {
      setEventRecords(await window.desktopApi.listEventsForSelectedBackup());
    } catch {
      setError('The Events workspace could not be loaded. Import Events first and try again.');
    } finally {
      setIsLoadingEvents(false);
    }
  }

  async function importEvents() {
    setIsImportingEvents(true);
    setError(null);
    try {
      await window.desktopApi.importEventsForSelectedBackup();
      await loadEvents();
      await refreshImportIssues();
      await refreshImportCoverage();
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch {
      setError('Events data could not be imported. Check the local import report.');
    } finally {
      setIsImportingEvents(false);
    }
  }

  async function loadMarketplace() {
    setIsLoadingMarketplace(true);
    try { setMarketplaceListings(await window.desktopApi.listMarketplaceForSelectedBackup()); }
    catch { setError('The Marketplace workspace could not be loaded.'); }
    finally { setIsLoadingMarketplace(false); }
  }

  async function importMarketplace() {
    setIsImportingMarketplace(true);
    setError(null);
    try {
      await window.desktopApi.importMarketplaceForSelectedBackup();
      await loadMarketplace();
      await refreshImportIssues();
      await refreshImportCoverage();
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch { setError('Marketplace listings could not be imported. Check the local import report.'); }
    finally { setIsImportingMarketplace(false); }
  }

  async function loadSavedItems() {
    setIsLoadingSavedItems(true);
    try { setSavedItems(await window.desktopApi.listSavedItemsForSelectedBackup()); }
    catch { setError('Saved Items could not be loaded.'); }
    finally { setIsLoadingSavedItems(false); }
  }

  async function importSavedItems() {
    setIsImportingSavedItems(true);
    setError(null);
    try {
      await window.desktopApi.importSavedItemsForSelectedBackup();
      await loadSavedItems();
      await refreshImportIssues();
      await refreshImportCoverage();
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch { setError('Saved Items could not be imported. Check the local import report.'); }
    finally { setIsImportingSavedItems(false); }
  }

  async function loadArchiveFiles(status: ArchiveFileStatus, sectionKey: string, query: string, page: number) {
    setIsLoadingArchiveFiles(true);
    setArchiveFileStatus(status);
    setArchiveFileSection(sectionKey);
    setArchiveFileQuery(query);
    setArchiveFilePage(page);
    try {
      const result = await window.desktopApi.listArchiveFilesForSelectedBackup(status, sectionKey, query, page);
      setArchiveFileDirectory(result);
      setArchiveFilePage(result.page);
    } catch {
      setError('The archive file inventory could not be loaded. Inspect the backup again and retry.');
    } finally {
      setIsLoadingArchiveFiles(false);
    }
  }

  function navigateToSection(section: string, targetId: string) {
    setActiveNavigation(section);
    const fallbackTargets: Record<string, string> = {
      friends: 'import-actions',
      conversations: 'conversation-import-action',
      photos: 'photo-import-action',
      activity: 'activity-tools',
      search: 'unified-search-panel',
      files: 'archive-files-workspace',
      events: 'events-workspace',
      marketplace: 'marketplace-workspace',
      'saved-items': 'saved-items-workspace',
      overview: 'welcome-panel',
      other: 'fallback-records-workspace'
    };
    const target = document.getElementById(targetId)
      ?? document.getElementById(fallbackTargets[section] ?? 'import-actions')
      ?? document.getElementById('welcome-panel');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function importFriends() {
    setIsImportingFriends(true);
    setError(null);

    try {
      const result = await window.desktopApi.importFriendsForSelectedBackup();
      setFriendsImport(result);
      await loadFriendsDirectory('all', '', 1);
      await refreshImportIssues();
      await refreshImportCoverage();
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch {
      setError('Friends data could not be imported. Check the local import report.');
    } finally {
      setIsImportingFriends(false);
    }
  }

  async function toggleImportPause() {
    try {
      const changed = isImportPaused
        ? await window.desktopApi.resumeImport()
        : await window.desktopApi.pauseImport();
      if (changed) setIsImportPaused(!isImportPaused);
    } catch {
      setError('The import pause request could not be applied. The current file remains safe.');
    }
  }

  async function importAllSupportedData() {
    setIsImportingAll(true);
    setImportAllSummary(null);
    setSelectedPhotoAlbum(null);
    setPhotoAlbumDetail(null);
    setError(null);
    try {
      const result = await window.desktopApi.importAllSupportedDataForSelectedBackup();
      setFriendsImport(result.sections.friends);
      setMessagesImport(result.sections.messages);
      setPostsImport(result.sections.posts);
      setCommentsImport(result.sections.comments);
      setReactionsImport(result.sections.reactions);
      setPhotosImport(result.sections.photosAndVideos);

      const [posts, comments, reactions, foundConversations, albums, friends, fallback, events, marketplace, savedItems] = await Promise.all([
        window.desktopApi.listPostsForSelectedBackup(),
        window.desktopApi.listCommentsForSelectedBackup(),
        window.desktopApi.listReactionsForSelectedBackup(),
        window.desktopApi.listMessagesForSelectedBackup(),
        window.desktopApi.listPhotoAlbumsForSelectedBackup(),
        window.desktopApi.listFriendsDirectoryForSelectedBackup('all', '', 1),
        window.desktopApi.listFallbackRecordSectionsForSelectedBackup(),
        window.desktopApi.listEventsForSelectedBackup(),
        window.desktopApi.listMarketplaceForSelectedBackup(),
        window.desktopApi.listSavedItemsForSelectedBackup()
      ]);
      setPostRecords(posts);
      setCommentRecords(comments);
      setReactionRecords(reactions);
      setConversations(foundConversations);
      setPhotoAlbums(albums);
      setFriendDirectory(friends);
      setFriendTypeFilter('all');
      setFriendQuery('');
      setFriendPage(friends.page);
      setFallbackSections(fallback);
      setEventRecords(events);
      setMarketplaceListings(marketplace);
      setSavedItems(savedItems);
      if (fallback.length > 0) await loadFallbackArchiveRecords(fallback[0].sectionKey, 1);
      else { setFallbackSectionKey(''); setFallbackRecords(null); }
      if (foundConversations.length > 0) {
        await loadConversation(foundConversations[0].sourceFileId);
      } else {
        setSelectedConversationId(null);
        setConversationMessages([]);
      }

      await refreshMediaGallery();
      await refreshImportIssues();
      await refreshImportCoverage();
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
      setImportAllSummary(result.totals);
    } catch {
      setError('The supported archive import could not be completed. Review the local import report and retry.');
    } finally {
      setIsImportingAll(false);
    }
  }

  async function loadConversation(sourceFileId: number) {
    setSelectedConversationId(sourceFileId);
    setIsLoadingConversation(true);
    try {
      const messages = await window.desktopApi.getMessagesForSelectedConversation(sourceFileId);
      let previewsLoaded = 0;
      const withPreviews = await Promise.all(messages.map(async (message) => ({
        ...message,
        media: await Promise.all(message.media.map(async (media) => {
          if (media.mediaKind !== 'image' && media.mediaKind !== 'sticker') return media;
          if (previewsLoaded >= 8) return media;
          previewsLoaded += 1;
          try {
            return { ...media, previewDataUrl: await window.desktopApi.getMessageMediaPreview(media.id) };
          } catch {
            return media;
          }
        }))
      })));
      setConversationMessages(withPreviews);
    } catch {
      setError('This conversation could not be opened from the selected backup.');
      setConversationMessages([]);
    } finally {
      setIsLoadingConversation(false);
    }
  }

  async function openMedia(media: { id: number; mediaKind: string; relativePath: string }) {
    setActiveMedia({ ...media, dataUrl: null, streamUrl: media.mediaKind === 'video' || media.mediaKind === 'audio' ? `archive-media://media/${media.id}` : null, loading: media.mediaKind !== 'video' && media.mediaKind !== 'audio', error: null });
    if (media.mediaKind === 'video' || media.mediaKind === 'audio') return;
    try {
      const dataUrl = await window.desktopApi.getMessageMediaPreview(media.id);
      setActiveMedia((current) => current?.id === media.id ? { ...current, dataUrl, loading: false } : current);
    } catch {
      setActiveMedia((current) => current?.id === media.id ? { ...current, loading: false, error: 'Preview unavailable. The file may be missing or unsupported.' } : current);
    }
  }

  async function importReactions() {
    setIsImportingReactions(true);
    setError(null);
    try {
      const result = await window.desktopApi.importReactionsForSelectedBackup();
      setReactionsImport(result);
      setReactionRecords(await window.desktopApi.listReactionsForSelectedBackup());
      await refreshMediaGallery();
      await refreshImportIssues();
      await refreshImportCoverage();
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch {
      setError('Likes & Reactions data could not be imported. Check the local import report.');
    } finally {
      setIsImportingReactions(false);
    }
  }

  async function importPhotosAndVideos() {
    setIsImportingPhotos(true);
    setError(null);
    setSelectedPhotoAlbum(null);
    setPhotoAlbumDetail(null);
    try {
      const result = await window.desktopApi.importPhotosAndVideosForSelectedBackup();
      setPhotosImport(result);
      setPhotoAlbums(await window.desktopApi.listPhotoAlbumsForSelectedBackup());
      await refreshMediaGallery();
      await refreshImportIssues();
      await refreshImportCoverage();
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch {
      setError('Photos & Videos data could not be imported. Check the local import report.');
    } finally {
      setIsImportingPhotos(false);
    }
  }

  async function importMessages() {
    setIsImportingMessages(true);
    setError(null);
    try {
      const result = await window.desktopApi.importMessagesForSelectedBackup();
      setMessagesImport(result);
      const foundConversations = await window.desktopApi.listMessagesForSelectedBackup();
      setConversations(foundConversations);
      await refreshMediaGallery();
      await refreshImportIssues();
      await refreshImportCoverage();
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
      if (foundConversations.length > 0) await loadConversation(foundConversations[0].sourceFileId);
    } catch {
      setError('Messages data could not be imported. Check the local import report.');
    } finally {
      setIsImportingMessages(false);
    }
  }

  const selectedConversation = conversations.find((item) => item.sourceFileId === selectedConversationId) ?? null;
  const visibleMedia = mediaGallery;
  const visibleConversations = conversations.filter((item) => {
    const haystack = [item.relativePath, item.conversationType, ...item.participants].join(' ').toLocaleLowerCase();
    return haystack.includes(conversationFilter.trim().toLocaleLowerCase());
  });

  const sectionCounts = inspection
    ? Object.entries(inspection.sectionFileCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    : [];
  const groupsFallbackSection = fallbackSections.find((section) => section.sectionKey === 'groups') ?? null;
  const nonGroupFallbackSections = fallbackSections.filter((section) => section.sectionKey !== 'groups');
  const isGroupsWorkspace = activeNavigation === 'groups';
  const visibleFallbackSections = isGroupsWorkspace
    ? (groupsFallbackSection ? [groupsFallbackSection] : [])
    : nonGroupFallbackSections;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">FA</div>
          <div className="brand-copy">
            <strong>Archive Explorer</strong>
            <span>Personal archive workspace</span>
          </div>
        </div>

        <p className="nav-label">WORKSPACE</p>
        <button type="button" className={activeNavigation === 'overview' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => navigateToSection('overview', 'overview')}><span>⌂</span> Overview</button>
        <button type="button" className={activeNavigation === 'friends' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => navigateToSection('friends', 'friends-directory')}><span>♙</span> Friends</button>
        <button type="button" className={activeNavigation === 'files' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => navigateToSection('files', 'archive-files-workspace')}><span>▦</span> Files</button>
        <button type="button" className={activeNavigation === 'conversations' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => navigateToSection('conversations', 'conversation-explorer')}><span>▤</span> Conversations</button>
        <button type="button" className={activeNavigation === 'photos' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => navigateToSection('photos', 'photo-albums-workspace')}><span>▧</span> Photos &amp; videos</button>
        <button type="button" className={activeNavigation === 'activity' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => navigateToSection('activity', 'activity-tools')}><span>◷</span> Activity</button>
        {((inspection?.sectionFileCounts.events ?? 0) > 0 || eventRecords.length > 0) && (
          <button type="button" className={activeNavigation === 'events' ? 'nav-item nav-item-active' : 'nav-item'}
            onClick={() => { void loadEvents(); navigateToSection('events', 'events-workspace'); }}>
            <span>◉</span> Events
          </button>
        )}
        {((inspection?.sectionFileCounts.marketplace ?? 0) > 0 || marketplaceListings.length > 0) && (
          <button type="button" className={activeNavigation === 'marketplace' ? 'nav-item nav-item-active' : 'nav-item'}
            onClick={() => { void loadMarketplace(); navigateToSection('marketplace', 'marketplace-workspace'); }}>
            <span>◇</span> Marketplace
          </button>
        )}
        {((inspection?.sectionFileCounts.saved_items_and_collections ?? 0) > 0 || savedItems.length > 0) && (
          <button type="button" className={activeNavigation === 'saved-items' ? 'nav-item nav-item-active' : 'nav-item'}
            onClick={() => { void loadSavedItems(); navigateToSection('saved-items', 'saved-items-workspace'); }}>
            <span>▣</span> Saved Items
          </button>
        )}
        <button type="button" className={activeNavigation === 'search' ? 'nav-item nav-item-active' : 'nav-item'} onClick={() => navigateToSection('search', 'unified-search-panel')}><span>⌕</span> Search</button>
        {groupsFallbackSection && (
          <button
            type="button"
            className={activeNavigation === 'groups' ? 'nav-item nav-item-active' : 'nav-item'}
            onClick={() => {
              setFallbackQuery('');
              void loadFallbackArchiveRecords('groups', 1, '');
              navigateToSection('groups', 'fallback-records-workspace');
            }}
          ><span>♧</span> Groups</button>
        )}
        {nonGroupFallbackSections.length > 0 && (
          <button
            type="button"
            className={activeNavigation === 'other' ? 'nav-item nav-item-active' : 'nav-item'}
            onClick={() => {
              const firstSection = nonGroupFallbackSections[0];
              if (firstSection) {
                setFallbackQuery('');
                void loadFallbackArchiveRecords(firstSection.sectionKey, 1, '');
              }
              navigateToSection('other', 'fallback-records-workspace');
            }}
          ><span>▤</span> Other data</button>
        )}

        <div className="sidebar-bottom">
          <div className="local-indicator"><i /> Local workspace</div>
          <p>Your archive is processed on this device.</p>
          <span className="version-label">Version {version}</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar" id="overview">
          <div>
            <p className="eyebrow">YOUR PERSONAL ARCHIVE</p>
            <h1>Everything in its place.</h1>
            <p className="page-subtitle">A clearer way to explore the history you exported.</p>
          </div>
          <div className="privacy-pill"><i /> On this device</div>
        </header>

        <section className="welcome-panel" id="welcome-panel">
          <div className="welcome-copy">
            <p className="panel-kicker">GET STARTED</p>
            <h2>Bring your archive into focus.</h2>
            <p>
              Choose a Facebook export folder or ZIP archive. The first pass inventories filenames
              and file types only; it does not open or extract archive contents.
            </p>

            <label className="account-field">
              <span>Facebook account label</span>
              <input
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                maxLength={100}
                placeholder="My Facebook account"
                disabled={isChoosingFolder || isAnyImporting}
              />
            </label>

            <button className="primary-button" onClick={chooseFolder} disabled={isChoosingFolder || isAnyImporting || !accountName.trim()}>
              <span className="button-icon">＋</span>
              {isChoosingFolder ? 'Inspecting backup…' : 'Choose backup folder or ZIP'}
            </button>

            {selectedFolder && (
              <div className="selected-folder">
                <span className="selected-folder-icon">✓</span>
                <div>
                  <strong>{accountName} · {selectedFolder}</strong>
                  <span>Archive inventory saved locally. ZIP contents are read in place without extraction.</span>
                </div>
              </div>
            )}
            {error && <p className="error-message">{error}</p>}
            <p className="helper-text">Use the same label for backups from one account, or a different label for another account. Original exports are never moved or modified; ZIP archives are read in place.</p>
          </div>

          <div className="welcome-art" aria-hidden="true">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-folder">
              <div className="folder-tab" />
              <div className="folder-front">
                <div className="folder-line line-one" />
                <div className="folder-line line-two" />
                <div className="folder-line line-three" />
                <div className="folder-badge">✦</div>
              </div>
            </div>
            <div className="art-card card-top">✉　 ▰</div>
            <div className="art-card card-bottom">▧　 ▰</div>
          </div>
        </section>

        {inspection && (
          <section className="inspection-panel">
            <div className="inspection-heading">
              <div>
                <p className="eyebrow">FIRST LOOK</p>
                <h2>Backup inventory</h2>
                <span className="snapshot-id">Saved snapshot: {inspection.snapshotId.slice(0, 8)}</span>
                <p>Names and file types only. No HTML, JSON, messages, or media contents were opened.</p>
              </div>
              <span className="inspection-date">
                {new Date(inspection.inspectedAt).toLocaleString()}
              </span>
            </div>

            <div className="inventory-stats">
              <div><strong>{inspection.totalFiles.toLocaleString()}</strong><span>Files found</span></div>
              <div><strong>{inspection.totalDirectories === null ? '—' : inspection.totalDirectories.toLocaleString()}</strong><span>Folders</span></div>
              <div><strong>{inspection.filesByFormat.html.toLocaleString()}</strong><span>HTML</span></div>
              <div><strong>{inspection.filesByFormat.json.toLocaleString()}</strong><span>JSON</span></div>
              <div><strong>{inspection.filesByFormat.media.toLocaleString()}</strong><span>Media files</span></div>
              <div><strong>{inspection.filesByFormat.other.toLocaleString()}</strong><span>Other files</span></div>
            </div>
            <div className="friends-import-action import-all-action">
              <div>
                <strong>Import all supported data</strong>
                <span>Run the reviewed section importers first, then bounded HTML and JSON fallbacks for other files. Completed files are skipped; failed or unsupported files remain retryable.</span>
                {importAllSummary && (
                  <span className="import-all-summary">
                    {importAllSummary.filesAttempted} files checked · {importAllSummary.recordsImported} records imported ·
                    {importAllSummary.mediaReferences} media links · {importAllSummary.unsupportedFiles} unsupported ·
                    {importAllSummary.failedFiles} failed
                  </span>
                )}
              </div>
              <button
                className="primary-button import-all-button"
                onClick={() => void importAllSupportedData()}
                disabled={isAnyImporting || isChoosingFolder}
              >
                {isImportingAll ? 'Importing supported data…' : 'Import All Supported Data'}
              </button>
            </div>

            {importProgress && (
              <section className="import-progress-panel" aria-live="polite">
                <div className="import-progress-heading">
                  <div>
                    <strong>
                      {importProgress.phase === 'completed'
                        ? (SECTION_TITLES.get(importProgress.sectionKey) ?? importProgress.sectionKey) + ' import complete'
                        : 'Importing ' + (SECTION_TITLES.get(importProgress.sectionKey) ?? importProgress.sectionKey)}
                    </strong>
                    <span>
                      {importProgress.filesCompleted.toLocaleString()} / {importProgress.filesTotal.toLocaleString()} files ·
                      {importProgress.recordsImported.toLocaleString()} records ·
                      {importProgress.unsupportedFiles.toLocaleString()} unsupported ·
                      {importProgress.failedFiles.toLocaleString()} failed
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className="import-progress-phase">
                      {importProgress.phase === 'completed' ? 'Complete' : isImportPaused ? 'Pause requested' : 'In progress'}
                    </span>
                    {isAnyImporting && (
                      <button className="secondary-button" onClick={() => void toggleImportPause()}>
                        {isImportPaused ? 'Resume import' : 'Pause import'}
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className="import-progress-track"
                  role="progressbar"
                  aria-label="Import progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={importProgress.filesTotal === 0
                    ? (importProgress.phase === 'completed' ? 100 : 0)
                    : Math.min(100, Math.round((importProgress.filesCompleted / importProgress.filesTotal) * 100))}
                >
                  <div
                    className="import-progress-fill"
                    style={{
                      width: (importProgress.filesTotal === 0
                        ? (importProgress.phase === 'completed' ? 100 : 0)
                        : Math.min(100, Math.round((importProgress.filesCompleted / importProgress.filesTotal) * 100))) + '%'
                    }}
                  />
                </div>
                {isImportPaused && isAnyImporting && (
                  <p className="import-progress-note">Pause requested. The current file will finish safely before the import pauses.</p>
                )}
                {importProgress.filesTotal === 0 && importProgress.phase === 'started' && (
                  <p className="import-progress-note">No remaining files were found for this section.</p>
                )}
              </section>
            )}
            <section className="import-coverage-panel">
              <div className="import-coverage-heading">
                <div>
                  <p className="eyebrow">FILE PROCESSING STATUS</p>
                  <h3>Import coverage</h3>
                  <p>Shows what has been processed, what was rejected, and what has not been attempted yet.</p>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => void refreshImportCoverage()}
                  disabled={isRefreshingImportCoverage || isChoosingFolder || isAnyImporting}
                >
                  {isRefreshingImportCoverage ? 'Refreshing…' : 'Refresh coverage'}
                </button>
              </div>
              {importCoverage && (
                <>
                  <div className="import-coverage-stats">
                    <div><strong>{importCoverage.totals.totalFiles.toLocaleString()}</strong><span>Total files</span></div>
                    <div><strong>{importCoverage.totals.mediaFiles.toLocaleString()}</strong><span>Media files</span></div>
                    <div><strong>{importCoverage.totals.completedFiles.toLocaleString()}</strong><span>Completed</span></div>
                    <div><strong>{importCoverage.totals.unsupportedFiles.toLocaleString()}</strong><span>Unsupported</span></div>
                    <div><strong>{importCoverage.totals.failedFiles.toLocaleString()}</strong><span>Failed</span></div>
                    <div><strong>{importCoverage.totals.unprocessedFiles.toLocaleString()}</strong><span>Not processed</span></div>
                  </div>
                  <div className="import-coverage-stats import-integrity-stats" aria-label="Import integrity checks">
                    <div><strong>{importCoverage.integrity.sourceRecordCountMismatches.toLocaleString()}</strong><span>Record count mismatches</span></div>
                    <div><strong>{importCoverage.integrity.recordsFromAnotherSnapshot.toLocaleString()}</strong><span>Cross-snapshot records</span></div>
                    <div><strong>{importCoverage.integrity.mediaAssetsWithoutSourceFile.toLocaleString()}</strong><span>Unlinked media assets</span></div>
                    <div><strong>{importCoverage.integrity.mediaAssetsFromAnotherSnapshot.toLocaleString()}</strong><span>Cross-snapshot media</span></div>
                    <div><strong>{importCoverage.integrity.mediaLinksAcrossSnapshots.toLocaleString()}</strong><span>Cross-snapshot media links</span></div>
                    <div><strong>{importCoverage.integrity.invalidMediaMetadata.toLocaleString()}</strong><span>Invalid media metadata</span></div>
                    <div><strong>{importCoverage.integrity.runningImportRuns.toLocaleString()}</strong><span>Unfinished import runs</span></div>
                    <div><strong>{importCoverage.integrity.processingSourceFiles.toLocaleString()}</strong><span>Files left processing</span></div>
                  </div>
                  <p className="import-coverage-note">
                    Integrity checks look for inconsistent record counts, cross-backup links, missing media sources, invalid metadata, and interrupted work. A zero count means no mismatch was detected.
                  </p>
                  <div className="import-coverage-list">
                    {importCoverage.sections.map((section) => {
                      const capability = getArchiveImportCapability(section.sectionKey);
                      const capabilityLabel = capability === 'sampled-json'
                        ? 'Sampled TNG Groups JSON parser'
                        : capability === 'sampled-html-json'
                        ? 'Sampled HTML + TNG JSON parsers'
                        : capability === 'known-html-json'
                        ? 'Reviewed Friends HTML + TNG JSON parser'
                        : capability === 'known-html'
                        ? 'Known HTML parser + generic JSON/TXT fallback'
                        : capability === 'sampled-html'
                          ? 'Sampled HTML parser + generic fallback'
                          : capability === 'generic-fallback'
                            ? 'Generic HTML/JSON/TXT fallback'
                            : capability === 'media-index-only'
                              ? 'Media inventory only'
                              : 'No importer yet';
                      return (
                      <article className="import-coverage-row" key={section.sectionKey}>
                        <div className="import-coverage-section">
                          <strong>{SECTION_TITLES.get(section.sectionKey) ?? section.sectionKey}</strong>
                          <span>
                            {section.totalFiles.toLocaleString()} files · {section.htmlFiles} HTML · {section.jsonFiles} JSON · {section.textFiles} TXT · {section.mediaFiles} media
                          </span>
                          <small className={'import-capability-badge import-capability-' + capability}>{capabilityLabel}</small>
                        </div>
                        <div className="import-coverage-statuses">
                          {section.completedFiles > 0 && <span className="coverage-done">{section.completedFiles} done</span>}
                          {section.unsupportedFiles > 0 && <span className="coverage-unsupported">{section.unsupportedFiles} unsupported</span>}
                          {section.failedFiles > 0 && <span className="coverage-failed">{section.failedFiles} failed</span>}
                          {section.unprocessedFiles > 0 && <span className="coverage-pending">{section.unprocessedFiles} not processed</span>}
                          {section.emptyFiles > 0 && <span>{section.emptyFiles} empty</span>}
                          {section.skippedFiles > 0 && <span>{section.skippedFiles} skipped</span>}
                        </div>
                      </article>
                    );
                    })}
                    {importCoverage.sections.length === 0 && (
                      <p className="import-issues-empty">No files were found in this backup.</p>
                    )}
                  </div>
                  <p className="import-coverage-note">
                    “Not processed” means no importer has attempted that file yet; it does not mean the section is supported. Media files are inventoried separately from content import status.
                  </p>
                </>
              )}
            </section>
            {archiveFileDirectory && (
              <section className="archive-files-panel" id="archive-files-workspace">
                <div className="archive-files-heading">
                  <div>
                    <p className="eyebrow">READ-ONLY BACKUP INVENTORY</p>
                    <h3>Archive files</h3>
                    <p>Browse every discovered file, including sections that do not have an importer yet.</p>
                  </div>
                  <span>{archiveFileDirectory.counts.all.toLocaleString()} files</span>
                </div>
                <div className="archive-files-stats">
                  <div><strong>{archiveFileDirectory.counts.completed.toLocaleString()}</strong><span>Completed</span></div>
                  <div><strong>{archiveFileDirectory.counts.discovered.toLocaleString()}</strong><span>Not processed</span></div>
                  <div><strong>{archiveFileDirectory.counts.unsupported.toLocaleString()}</strong><span>Unsupported</span></div>
                  <div><strong>{archiveFileDirectory.counts.failed.toLocaleString()}</strong><span>Failed</span></div>
                  <div><strong>{archiveFileDirectory.counts.empty.toLocaleString()}</strong><span>Empty</span></div>
                </div>
                <div className="archive-files-controls">
                  <input
                    value={archiveFileQuery}
                    onChange={(event) => setArchiveFileQuery(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void loadArchiveFiles(archiveFileStatus, archiveFileSection, archiveFileQuery, 1); }}
                    maxLength={120}
                    placeholder="Search names, paths, sections, or error codes…"
                    aria-label="Search archive files"
                  />
                  <select
                    value={archiveFileSection}
                    onChange={(event) => void loadArchiveFiles(archiveFileStatus, event.target.value, archiveFileQuery, 1)}
                    aria-label="Filter archive files by section"
                  >
                    <option value="all">All sections</option>
                    {ARCHIVE_SECTIONS.map((section) => (
                      <option key={section.key} value={section.key}>{section.title}</option>
                    ))}
                  </select>
                  <select
                    value={archiveFileStatus}
                    onChange={(event) => void loadArchiveFiles(event.target.value as ArchiveFileStatus, archiveFileSection, archiveFileQuery, 1)}
                    aria-label="Filter archive files by status"
                  >
                    <option value="all">All statuses</option>
                    <option value="discovered">Not processed</option>
                    <option value="queued">Queued</option>
                    <option value="processing">Processing</option>
                    <option value="completed">Completed</option>
                    <option value="empty">Empty</option>
                    <option value="unsupported">Unsupported</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
                  </select>
                  <button className="secondary-button" onClick={() => void loadArchiveFiles(archiveFileStatus, archiveFileSection, archiveFileQuery, 1)} disabled={isLoadingArchiveFiles}>
                    {isLoadingArchiveFiles ? 'Loading…' : 'Apply'}
                  </button>
                </div>
                {isLoadingArchiveFiles ? (
                  <p className="archive-files-empty">Loading file inventory…</p>
                ) : archiveFileDirectory.records.length === 0 ? (
                  <p className="archive-files-empty">No files match these filters.</p>
                ) : (
                  <div className="archive-files-list">
                    {archiveFileDirectory.records.map((file) => (
                      <article className="archive-file-row" key={file.id}>
                        <div className={'archive-file-format archive-file-format-' + file.detectedFormat}>{file.detectedFormat.toUpperCase()}</div>
                        <div className="archive-file-copy">
                          <strong>{file.fileName}</strong>
                          <span>{SECTION_TITLES.get(file.sectionKey) ?? file.sectionKey.replaceAll('_', ' ')} · {file.relativePath}</span>
                          <small>
                            {formatFileSize(file.fileSizeBytes)} · {file.recordCount.toLocaleString()} records
                            {file.safeErrorCode ? ' · ' + file.safeErrorCode : ''}
                            {file.processedAt ? ' · processed ' + file.processedAt : ''}
                          </small>
                        </div>
                        <span className={'archive-file-status archive-file-status-' + file.status}>
                          {ARCHIVE_FILE_STATUS_LABELS[file.status]}
                        </span>
                      </article>
                    ))}
                  </div>
                )}
                <div className="archive-files-pagination">
                  <span>
                    {archiveFileDirectory.total === 0
                      ? '0 files'
                      : 'Showing ' + (((archiveFileDirectory.page - 1) * archiveFileDirectory.pageSize) + 1) + '–' +
                        Math.min(archiveFileDirectory.page * archiveFileDirectory.pageSize, archiveFileDirectory.total) +
                        ' of ' + archiveFileDirectory.total.toLocaleString()}
                  </span>
                  <div>
                    <button className="secondary-button" onClick={() => void loadArchiveFiles(archiveFileStatus, archiveFileSection, archiveFileQuery, archiveFilePage - 1)} disabled={isLoadingArchiveFiles || archiveFilePage <= 1}>Previous</button>
                    <span>Page {archiveFileDirectory.page} / {Math.max(1, Math.ceil(archiveFileDirectory.total / archiveFileDirectory.pageSize))}</span>
                    <button className="secondary-button" onClick={() => void loadArchiveFiles(archiveFileStatus, archiveFileSection, archiveFileQuery, archiveFilePage + 1)} disabled={isLoadingArchiveFiles || archiveFilePage >= Math.max(1, Math.ceil(archiveFileDirectory.total / archiveFileDirectory.pageSize))}>Next</button>
                  </div>
                </div>
              </section>
            )}

            <section className="unified-search-panel" id="unified-search-panel">
              <div className="media-gallery-heading">
                <div>
                  <p className="eyebrow">LOCAL SEARCH · FOUR DISTINCT LEVELS</p>
                  <h3>Search this backup</h3>
                  <p>Use literal search, typo-tolerant matching, or optional local semantic search. The AI Assistant is a separate layer for evidence-based answers.</p>
                </div>
                <span>{searchedQuery === null ? 'No search run' : `Page ${searchPage} · ${searchResults.length.toLocaleString()} results`}</span>
              </div>
              <div className="search-privacy-setting">
                <label>
                  <input
                    type="checkbox"
                    checked={includeMessagesInGlobalSearch}
                    onChange={(event) => void updateMessageSearchSetting(event.target.checked)}
                    disabled={isUpdatingMessageSearch}
                  />
                  <span>
                    <strong>Include message text in global search</strong>
                    <small>Off by default. When enabled, message text is added to a separate local search index. Turning this off removes it from that index.</small>
                  </span>
                </label>
                {isUpdatingMessageSearch && <span>Updating private message index…</span>}
              </div>
              <div className="search-privacy-setting semantic-search-setting">
                <label>
                  <input
                    type="checkbox"
                    checked={semanticSearchStatus?.enabled ?? false}
                    onChange={(event) => void updateSemanticSearchSetting(event.target.checked)}
                    disabled={isUpdatingSemanticSearch || !semanticSearchStatus}
                  />
                  <span>
                    <strong>Enable Semantic Search · download local model</strong>
                    <small>Optional multilingual embeddings. The model and archive vectors stay on this device; enabling this starts indexing existing records and new imports.</small>
                  </span>
                </label>
                <div className="semantic-search-status">
                  {semanticSearchStatus?.phase === 'downloading' && <span>Downloading model{semanticSearchStatus.progressPercent === null ? '…' : ' · ' + Math.round(semanticSearchStatus.progressPercent) + '%'}</span>}
                  {semanticSearchStatus?.phase === 'loading' && <span>Loading local model…</span>}
                  {semanticSearchStatus?.phase === 'indexing' && <span>Indexing {semanticSearchStatus.completed.toLocaleString()} / {semanticSearchStatus.total.toLocaleString()} records</span>}
                  {semanticSearchStatus?.phase === 'ready' && <span>Ready · {semanticSearchStatus.completed.toLocaleString()} records indexed</span>}
                  {semanticSearchStatus?.phase === 'error' && <span>Indexing needs attention · {semanticSearchStatus.failed.toLocaleString()} failed</span>}
                  {semanticSearchStatus?.phase === 'idle' && <span>Enabled · preparing local model</span>}
                  {semanticSearchStatus?.enabled && (semanticSearchStatus.failed > 0 || semanticSearchStatus.phase === 'error') && (
                    <button className="secondary-button" onClick={() => void retrySemanticIndexing()} disabled={isUpdatingSemanticSearch}>
                      Retry model / indexing
                    </button>
                  )}
                </div>
              </div>
              <div className="unified-search-controls">
                <input value={searchQuery} onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchResults([]);
                  setSearchedQuery(null);
                  setSearchExportStatus('');
                }}
                  onKeyDown={(event) => { if (event.key === 'Enter') void runArchiveSearch(); }}
                  maxLength={180} placeholder="Search names, posts, comments, or reactions…" aria-label="Search archive text" />
                <select value={searchSection} onChange={(event) => {
                  setSearchSection(event.target.value);
                  if (event.target.value === 'messages' && !includeMessagesInGlobalSearch) setSearchMode('exact');
                  setSearchResults([]);
                  setSearchedQuery(null);
                  setSearchExportStatus('');
                }} aria-label="Filter search by section">
                  <option value="all">All searchable sections</option>
                  <option value="messages">Messages (section only unless enabled above)</option>
                  {ARCHIVE_SECTIONS.filter((section) => ['friends', 'posts', 'comments', 'likes_and_reactions', 'photos_and_videos'].includes(section.key)).map((section) => (
                    <option key={section.key} value={section.key}>{section.title}</option>
                  ))}
                </select>
                <button className="secondary-button" onClick={() => void runArchiveSearch()} disabled={isSearching || !searchQuery.trim()}>
                  {isSearching ? 'Searching…' : 'Search'}
                </button>
              </div>
              <div className="search-date-controls">
                <label>
                  <span>From date (UTC)</span>
                  <input
                    type="date"
                    value={searchDateFrom}
                    max={searchDateTo || undefined}
                    onChange={(event) => {
                      setSearchDateFrom(event.target.value);
                      setSearchResults([]);
                      setSearchedQuery(null);
                      setSearchExportStatus('');
                    }}
                    aria-label="Search start date in UTC"
                  />
                </label>
                <label>
                  <span>To date (UTC)</span>
                  <input
                    type="date"
                    value={searchDateTo}
                    min={searchDateFrom || undefined}
                    onChange={(event) => {
                      setSearchDateTo(event.target.value);
                      setSearchResults([]);
                      setSearchedQuery(null);
                      setSearchExportStatus('');
                    }}
                    aria-label="Search end date in UTC"
                  />
                </label>
                <span>Only records with a reliable normalized UTC timestamp are included while a date filter is active. Ambiguous dates are not guessed.</span>
              </div>
              <div className="search-mode-controls">
                <label>
                  <span>Search level</span>
                  <select value={searchMode} onChange={(event) => {
                    setSearchMode(event.target.value as ArchiveSearchMode);
                    setSearchResults([]);
                    setSearchedQuery(null);
                  }}>
                    <option value="exact">Exact Search</option>
                    <option value="fuzzy" disabled={searchSection === 'messages' && !includeMessagesInGlobalSearch}>Fuzzy Search · typo tolerant</option>
                    <option value="semantic" disabled={!semanticSearchStatus?.enabled || (searchSection === 'messages' && !includeMessagesInGlobalSearch)}>Semantic Search · meaning and context</option>
                  </select>
                </label>
                {searchMode === 'fuzzy' && (
                  <label>
                    <span>Similarity strictness</span>
                    <select value={searchThreshold} onChange={(event) => {
                      setSearchThreshold(Number(event.target.value));
                      setSearchResults([]);
                      setSearchedQuery(null);
                    }}>
                      <option value={0.65}>More flexible · 65%</option>
                      <option value={0.75}>Flexible · 75%</option>
                      <option value={0.8}>Balanced · 80%</option>
                      <option value={0.85}>Strict · 85%</option>
                      <option value={0.9}>Very strict · 90%</option>
                      <option value={0.95}>Highly strict · 95%</option>
                    </select>
                  </label>
                )}
                <span className="search-mode-note">Exact and Fuzzy need no AI. Semantic Search uses a separate optional local Embeddings model; AI Assistant is a separate optional LLM layer.</span>
              </div>
              <div className="search-results-list">
                {searchResults.map((result) => (
                  <article className="search-result-item" key={result.id}>
                    <div className="search-result-heading">
                      <strong>{SECTION_TITLES.get(result.sectionKey) ?? result.sectionKey}</strong>
                      <span>{result.matchType === 'fuzzy' ? 'Fuzzy match · ' + Math.round(result.similarity * 100) + '%' : result.matchType === 'semantic' ? 'Semantic match · ' + Math.round(result.similarity * 100) + '%' : 'Exact match'} · {result.recordType.replaceAll('_', ' ')}</span>
                    </div>
                    {result.title && <strong>{result.title}</strong>}
                    {result.body && <p>{result.body}</p>}
                    <small>{result.dateRaw ?? 'Date not provided'} · {result.sourcePath} · card {result.sourceCardIndex + 1}</small>
                  </article>
                ))}
                {searchResults.length === 0 && searchQuery.trim() && !isSearching && (
                  <p className="conversation-empty">No matching records for this search level. Check that the relevant section has been imported, or try another search level.</p>
                )}
              </div>
              <div className="search-export-row">
                <span>{searchExportStatus || (searchedQuery !== null && searchResults.length === ARCHIVE_SEARCH_PAGE_SIZE
                  ? `Showing ${ARCHIVE_SEARCH_PAGE_SIZE} results. More matches may be available on the next page.`
                  : searchedQuery !== null ? `${searchResults.length} results on this page.` : '')}</span>
                <div className="search-pagination-controls">
                  {searchedQuery !== null && (
                    <>
                      <button className="secondary-button" onClick={() => void runArchiveSearch(searchPage - 1)} disabled={isSearching || searchPage <= 1}>
                        Previous
                      </button>
                      <span>Page {searchPage}</span>
                      <button className="secondary-button" onClick={() => void runArchiveSearch(searchPage + 1)} disabled={isSearching || searchResults.length < ARCHIVE_SEARCH_PAGE_SIZE || searchPage * ARCHIVE_SEARCH_PAGE_SIZE > MAX_ARCHIVE_SEARCH_OFFSET}>
                        Next
                      </button>
                    </>
                  )}
                  <button className="secondary-button" onClick={() => void exportArchiveSearch()} disabled={!searchResults.length || searchedQuery === null || isSearching}>
                    Export this page as JSON
                  </button>
                </div>
              </div>
            </section>

            <section className="archive-assistant-panel" id="archive-assistant-panel">
              <div className="archive-assistant-heading">
                <div>
                  <p className="eyebrow">OPTIONAL · LOCAL LANGUAGE MODEL</p>
                  <h3>Ask your archive</h3>
                  <p>Ask questions across imported records. The model runs on this device; answers show the archive records used as evidence.</p>
                </div>
                <div className="assistant-model-state">
                  {aiAssistantStatus?.phase === 'disabled' && <span>Off</span>}
                  {aiAssistantStatus?.phase === 'idle' && <span>Preparing model…</span>}
                  {aiAssistantStatus?.phase === 'downloading' && <span>Downloading model{aiAssistantStatus.progressPercent === null ? '…' : ' · ' + Math.round(aiAssistantStatus.progressPercent) + '%'}</span>}
                  {aiAssistantStatus?.phase === 'loading' && <span>Loading local model…</span>}
                  {aiAssistantStatus?.phase === 'ready' && <span>Local model ready</span>}
                  {aiAssistantStatus?.phase === 'error' && <span>Model needs attention</span>}
                </div>
              </div>
              <div className="search-privacy-setting assistant-enable-setting">
                <label>
                  <input
                    type="checkbox"
                    checked={aiAssistantStatus?.enabled ?? false}
                    onChange={(event) => void updateAiAssistantSetting(event.target.checked)}
                    disabled={isUpdatingAiAssistant || isAskingAssistant || !aiAssistantStatus}
                  />
                  <span>
                    <strong>Enable AI Assistant · download local LLM</strong>
                    <small>Separate from Semantic Search. No archive text is sent to a cloud AI service. The first enable downloads model files to the local app data folder.</small>
                  </span>
                </label>
                {aiAssistantStatus?.phase === 'error' && (
                  <button className="secondary-button" onClick={() => void retryAiAssistantModel()} disabled={isUpdatingAiAssistant}>
                    Retry model setup
                  </button>
                )}
              </div>
              <div className="archive-assistant-compose">
                <label>
                  <span>Limit answers to a section</span>
                  <select
                    value={assistantSection}
                    onChange={(event) => setAssistantSection(event.target.value)}
                    disabled={!aiAssistantStatus?.enabled || isAskingAssistant}
                  >
                    <option value="all">All eligible sections</option>
                    {ARCHIVE_SECTIONS.filter((section) => section.key !== 'messages' || includeMessagesInGlobalSearch).map((section) => (
                      <option key={section.key} value={section.key}>{section.title}</option>
                    ))}
                  </select>
                </label>
                <textarea
                  value={assistantQuestion}
                  onChange={(event) => setAssistantQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void askArchiveAssistant();
                    }
                  }}
                  rows={3}
                  maxLength={2000}
                  placeholder="For example: What did I discuss about work, and which records mention it?"
                  disabled={!aiAssistantStatus?.enabled || isAskingAssistant}
                  aria-label="Ask a question about this archive"
                />
                <div className="archive-assistant-compose-footer">
                  <span>{aiAssistantStatus?.enabled ? 'Use Enter to ask · Shift+Enter for a new line' : 'Enable the local assistant to ask questions'}</span>
                  <button
                    className="secondary-button"
                    onClick={() => void askArchiveAssistant()}
                    disabled={!aiAssistantStatus?.enabled || !inspection || isAskingAssistant || assistantQuestion.trim().length < 2}
                  >
                    {isAskingAssistant ? 'Researching local records…' : 'Ask archive'}
                  </button>
                </div>
              </div>
              {assistantConversation.length > 0 && (
                <div className="archive-assistant-conversation">
                  <div className="archive-assistant-history-heading">
                    <strong>Recent answers</strong>
                    <button className="text-button" onClick={() => setAssistantConversation([])} disabled={isAskingAssistant}>Clear conversation</button>
                  </div>
                  {assistantConversation.map((turn, index) => (
                    <article className="archive-assistant-turn" key={index}>
                      <div className="assistant-question-bubble">
                        <span>You asked</span>
                        <p>{turn.question}</p>
                      </div>
                      <div className="assistant-answer-block">
                        <strong>Archive Assistant</strong>
                        <p className="assistant-answer-text">{turn.response.answer}</p>
                        {turn.response.retrievalScope.year && (
                          <small>Year filter: {turn.response.retrievalScope.year}</small>
                        )}
                        {turn.response.citations.length > 0 && (
                          <div className="assistant-citation-list">
                            <strong>Sources · {turn.response.citations.length} of {turn.response.evidenceCount} retrieved records</strong>
                            {turn.response.citations.map((source) => (
                              <article className="assistant-citation" key={source.sourceId}>
                                <div className="assistant-citation-id">{source.sourceId}</div>
                                <div className="assistant-citation-copy">
                                  <strong>{source.title || source.recordType.replaceAll('_', ' ')}</strong>
                                  <span>{SECTION_TITLES.get(source.sectionKey) ?? source.sectionKey} · {source.dateRaw || 'Date not recorded'}</span>
                                  <p>{source.excerpt}</p>
                                  <small>{source.sourcePath} · card {source.sourceCardIndex + 1} · record #{source.recordId}</small>
                                </div>
                                <button
                                  className="secondary-button"
                                  onClick={() => void openAssistantSource(source)}
                                  disabled={!archiveFileDirectory}
                                  title="Find this source in the Archive Files browser"
                                >
                                  Find source
                                </button>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <div className="section-counts">
              <h3>Files by section</h3>
              <div className="section-count-list">
                {sectionCounts.map(([key, count]) => (
                  <div className="section-count" key={key}>
                    <span>{SECTION_TITLES.get(key) ?? key}</span>
                    <strong>{count.toLocaleString()}</strong>
                  </div>
                ))}
              </div>
            </div>


            <div className="friends-import-action" id="import-actions">
              <div>
                <strong>Friends</strong>
                <span>Import the five recognized Friends HTML files. Other sections remain untouched.</span>
              </div>
              <button
                className="secondary-button"
                onClick={importFriends}
                disabled={isAnyImporting || isChoosingFolder}
              >
                {isImportingFriends ? 'Importing Friends…' : 'Import Friends'}
              </button>
            </div>
            {(friendsImport || friendDirectory) && (
              <section className="friends-directory-workspace" id="friends-directory">
                <div className="friends-directory-heading">
                  <div>
                    <p className="eyebrow">PEOPLE IN THIS BACKUP</p>
                    <h3>Friends directory</h3>
                    <p>Current friends and request history, preserved as separate export categories.</p>
                  </div>
                  <span>{friendDirectory?.counts.all.toLocaleString() ?? '—'} records</span>
                </div>
                {friendsImport && (
                  <p className="friends-import-result">
                    {friendsImport.filesAttempted} files checked · {friendsImport.recordsImported} records imported ·
                    {friendsImport.unsupportedFiles} unsupported · {friendsImport.failedFiles} failed
                  </p>
                )}
                {friendDirectory && (
                  <>
                    <div className="friends-directory-tabs" role="group" aria-label="Filter Friends by export category">
                      <button type="button" className={friendTypeFilter === 'all' ? 'selected' : ''} disabled={isLoadingFriends} onClick={() => void loadFriendsDirectory('all', friendQuery, 1)}>All <span>{friendDirectory.counts.all}</span></button>
                      <button type="button" className={friendTypeFilter === 'friend' ? 'selected' : ''} disabled={isLoadingFriends} onClick={() => void loadFriendsDirectory('friend', friendQuery, 1)}>Friends <span>{friendDirectory.counts.friends}</span></button>
                      <button type="button" className={friendTypeFilter === 'received' ? 'selected' : ''} disabled={isLoadingFriends} onClick={() => void loadFriendsDirectory('received', friendQuery, 1)}>Received <span>{friendDirectory.counts.received}</span></button>
                      <button type="button" className={friendTypeFilter === 'sent' ? 'selected' : ''} disabled={isLoadingFriends} onClick={() => void loadFriendsDirectory('sent', friendQuery, 1)}>Sent <span>{friendDirectory.counts.sent}</span></button>
                      <button type="button" className={friendTypeFilter === 'rejected' ? 'selected' : ''} disabled={isLoadingFriends} onClick={() => void loadFriendsDirectory('rejected', friendQuery, 1)}>Rejected <span>{friendDirectory.counts.rejected}</span></button>
                      <button type="button" className={friendTypeFilter === 'removed' ? 'selected' : ''} disabled={isLoadingFriends} onClick={() => void loadFriendsDirectory('removed', friendQuery, 1)}>Removed <span>{friendDirectory.counts.removed}</span></button>
                    </div>
                    <div className="friends-directory-search">
                      <input
                        disabled={isLoadingFriends}
                        value={friendQuery}
                        onChange={(event) => setFriendQuery(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') void loadFriendsDirectory(friendTypeFilter, friendQuery, 1); }}
                        maxLength={100}
                        placeholder="Find a person or search exported dates…"
                        aria-label="Search Friends directory"
                      />
                      <button className="secondary-button" onClick={() => void loadFriendsDirectory(friendTypeFilter, friendQuery, 1)} disabled={isLoadingFriends}>
                        {isLoadingFriends ? 'Searching…' : 'Search'}
                      </button>
                      {friendQuery && <button className="text-button" onClick={() => void loadFriendsDirectory(friendTypeFilter, '', 1)}>Clear</button>}
                    </div>
                    {isLoadingFriends ? (
                      <p className="friends-directory-empty">Loading Friends…</p>
                    ) : friendDirectory.records.length === 0 ? (
                      <p className="friends-directory-empty">
                        {friendDirectory.counts.all === 0
                          ? 'No recognized Friends records have been imported from this backup yet.'
                          : 'No people match this filter. Try another category or search phrase.'}
                      </p>
                    ) : (
                      <div className="friends-directory-list">
                        {friendDirectory.records.map((friend) => (
                          <article className="friends-directory-row" key={friend.id}>
                            <div className="friends-directory-avatar">{friend.nameRaw.trim().slice(0, 1).toLocaleUpperCase() || '•'}</div>
                            <div className="friends-directory-copy">
                              <strong>{friend.nameRaw}</strong>
                              <small>{friend.dateRaw ?? 'No exported date'} · {friend.sourcePath} · item {friend.sourceCardIndex + 1}</small>
                            </div>
                            <span className={'friend-status friend-status-' + friend.recordType}>{FRIEND_STATUS_LABELS[friend.recordType]}</span>
                          </article>
                        ))}
                      </div>
                    )}
                    <div className="friends-directory-pagination">
                      <span>
                        {friendDirectory.total === 0
                          ? '0 records'
                          : 'Showing ' + (((friendDirectory.page - 1) * friendDirectory.pageSize) + 1) + '–' +
                            Math.min(friendDirectory.page * friendDirectory.pageSize, friendDirectory.total) +
                            ' of ' + friendDirectory.total.toLocaleString()}
                      </span>
                      <div>
                        <button className="secondary-button" onClick={() => void loadFriendsDirectory(friendTypeFilter, friendQuery, friendPage - 1)} disabled={isLoadingFriends || friendPage <= 1}>Previous</button>
                        <span>Page {friendDirectory.page} / {Math.max(1, Math.ceil(friendDirectory.total / friendDirectory.pageSize))}</span>
                        <button className="secondary-button" onClick={() => void loadFriendsDirectory(friendTypeFilter, friendQuery, friendPage + 1)} disabled={isLoadingFriends || friendPage >= Math.max(1, Math.ceil(friendDirectory.total / friendDirectory.pageSize))}>Next</button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            )}

            <div className="friends-import-action" id="conversation-import-action">
              <div>
                <strong>Messages</strong>
                <span>Import recognized conversation HTML from inbox, archived, filtered, and request folders. Messages stay out of search indexing by default.</span>
              </div>
              <button className="secondary-button" onClick={importMessages} disabled={isAnyImporting || isChoosingFolder}>
                {isImportingMessages ? 'Importing Messages…' : 'Import Messages'}
              </button>
            </div>
            <div className="friends-import-action" id="activity-tools">
              <div>
                <strong>Posts</strong>
                <span>Import sampled post cards, keep exported dates and authors, and link local photos/videos without copying them.</span>
              </div>
              <button className="secondary-button" onClick={importPosts} disabled={isAnyImporting || isChoosingFolder}>
                {isImportingPosts ? 'Importing posts…' : 'Import Posts'}
              </button>
            </div>
            {postsImport && (
              <p className="friends-import-result">
                {postsImport.filesAttempted} files checked · {postsImport.recordsImported} posts imported ·
                {postsImport.mediaReferences} media references · {postsImport.unsupportedFiles} unsupported · {postsImport.failedFiles} failed
              </p>
            )}
            {(postsImport || postRecords.length > 0) && (
              <section className="conversation-workspace" id="posts-explorer">
                <div className="conversation-workspace-heading">
                  <div>
                    <p className="eyebrow">YOUR ACTIVITY</p>
                    <h3>Posts</h3>
                    <p>Facebook activity headings and raw exported dates are preserved. Only safe local archive media references are linked.</p>
                  </div>
                  <span>{postRecords.length.toLocaleString()} records</span>
                </div>
                <input className="conversation-filter" value={postFilter} onChange={(event) => setPostFilter(event.target.value)} placeholder="Filter posts…" />
                <ActivityDateFilters from={postDateFrom} to={postDateTo} onFromChange={setPostDateFrom} onToChange={setPostDateTo} />
                <div className="media-gallery-list">
                  {postRecords.filter((record) =>
                    [record.activityRaw, record.bodyRaw, record.dateRaw, record.sourcePath].join(' ').toLocaleLowerCase().includes(postFilter.trim().toLocaleLowerCase()) &&
                    isUtcDateInRange(record.eventTimeUtc, postDateFrom, postDateTo)
                  ).map((record) => (
                    <article className="media-gallery-item" key={record.id}>
                      <div className="media-gallery-icon">P</div>
                      <div className="media-gallery-copy">
                        <strong>{record.activityRaw ?? 'Post'}</strong>
                        <span>{record.bodyRaw ?? 'No text in export'}{record.mediaCount ? ` · ${record.mediaCount} attachments` : ''}</span>
                        <small>{formatActivityDate(record.dateRaw, record.eventTimeUtc)} · {record.sourcePath}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

                    <div className="friends-import-action" id="photo-import-action">
                      <div>
                        <strong>Photos &amp; Videos</strong>
                        <span>Import the album index and only detail pages explicitly linked from it. Original media files stay in place.</span>
                        {photosImport && (
                          <span className="import-all-summary">
                            {photosImport.filesAttempted} files checked · {photosImport.recordsImported} records imported ·
                            {photosImport.mediaReferences} media links · {photosImport.unsupportedFiles} unsupported ·
                            {photosImport.failedFiles} failed
                          </span>
                        )}
                      </div>
                      <button className="secondary-button" onClick={importPhotosAndVideos} disabled={isAnyImporting || isChoosingFolder}>
                        {isImportingPhotos ? 'Importing photos…' : 'Import Photos &amp; Videos'}
                      </button>
                    </div>
            {(photoAlbums.length > 0 || isImportingAll || isImportingPhotos || photosImport) && (
              <section className="conversation-workspace photo-albums-workspace" id="photo-albums-workspace">
                {selectedPhotoAlbum ? (
                  <>
                    <div className="conversation-workspace-heading">
                      <div>
                        <p className="eyebrow">PHOTO ALBUM</p>
                        <h3>{selectedPhotoAlbum.albumTitle}</h3>
                        <p>
                          {photoAlbumDetail?.photos.length.toLocaleString() ?? 0} photos loaded ·
                          {selectedPhotoAlbum.photoCount === null
                            ? ' exported count unavailable'
                            : ' ' + selectedPhotoAlbum.photoCount.toLocaleString() + ' photos in export'}
                        </p>
                      </div>
                      <button className="secondary-button" onClick={closePhotoAlbum}>Back to albums</button>
                    </div>
                    {isLoadingPhotoAlbum ? (
                      <p className="photo-album-empty">Loading photos and comments…</p>
                    ) : photoAlbumDetail && photoAlbumDetail.photos.length > 0 ? (
                      <div className="photo-album-photos">
                        {photoAlbumDetail.photos.map((photo) => (
                          <article className="photo-album-photo" key={photo.id}>
                            <div className="photo-album-photo-heading">
                              <div className="media-gallery-copy">
                                <strong>{photo.captionRaw || 'Photo'}</strong>
                                <small>{photo.dateRaw ?? 'Date not provided'} · {photo.sourcePath}</small>
                              </div>
                              {photo.imageAssetId !== null ? (
                                <button
                                  className="media-gallery-open"
                                  onClick={() => void openMedia({
                                    id: photo.imageAssetId as number,
                                    mediaKind: 'image',
                                    relativePath: photo.imagePath
                                  })}
                                >
                                  View photo
                                </button>
                              ) : (
                                <span className="photo-album-image-missing">Image file not found</span>
                              )}
                            </div>
                            <div className="photo-album-comments">
                              <strong>{photo.comments.length.toLocaleString()} comments</strong>
                              {photo.comments.length > 0 ? (
                                <div className="photo-album-comment-list">
                                  {photo.comments.map((comment, index) => (
                                    <div className="photo-album-comment" key={photo.id + '-' + index}>
                                      <div>
                                        <strong>{comment.authorRaw ?? 'Unknown commenter'}</strong>
                                        <small>{comment.dateRaw ?? 'Date not provided'}</small>
                                      </div>
                                      <p>{comment.bodyRaw ?? 'No comment text in export'}</p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span>No comments in this export card.</span>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="photo-album-empty">
                        {photoAlbumDetail?.detailFileStatus === 'discovered'
                          ? 'The album page has not been imported yet. Run Import Photos & Videos to load its photos and comments.'
                          : photoAlbumDetail?.detailFileStatus === 'not_found'
                            ? 'The album detail HTML file is not present in this backup.'
                            : photoAlbumDetail?.detailFileStatus === 'unsupported'
                              ? 'This album page did not match the supported photo-card layout.'
                              : photoAlbumDetail?.detailFileStatus === 'failed'
                                ? 'The album page could not be imported. Check Import Diagnostics.'
                                : 'No photo cards were imported from this album.'}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="conversation-workspace-heading">
                      <div>
                        <p className="eyebrow">YOUR LIBRARY</p>
                        <h3>Photo albums</h3>
                        <p>Open an album to browse its photos, captions, original dates, and exported comments.</p>
                      </div>
                      <span>{photoAlbums.length.toLocaleString()} albums</span>
                    </div>
                    <input
                      className="conversation-filter"
                      value={albumFilter}
                      onChange={(event) => {
                        setAlbumFilter(event.target.value);
                        setPhotoAlbumCovers({});
                        setPhotoAlbumCoverFailures({});
                      }}
                      placeholder="Filter photo albums…"
                    />
                    {photoAlbums.length === 0 ? (
                      <p className="photo-album-empty">No recognized photo albums were imported from this backup.</p>
                    ) : null}
                    <div className="media-gallery-list">
                      {photoAlbums.filter((album) => [
                        album.albumTitle, album.dateRaw, album.albumPath, album.sourcePath
                      ].join(' ').toLocaleLowerCase().includes(albumFilter.trim().toLocaleLowerCase())).map((album) => (
                        <article className="media-gallery-item" key={album.id}>
                          {album.coverAssetId !== null && photoAlbumCovers[album.id] ? (
                            <img className="photo-album-cover" src={photoAlbumCovers[album.id]} alt={album.albumTitle + ' album cover'} />
                          ) : (
                            <div className="media-gallery-icon">▧</div>
                          )}
                          <div className="media-gallery-copy">
                            <strong>{album.albumTitle}</strong>
                            <span>
                              {album.photoCount === null
                                ? 'Photo count unavailable'
                                : album.photoCount.toLocaleString() + (album.photoCount === 1 ? ' photo' : ' photos')}
                              {' · '}{album.importedPhotoCount.toLocaleString()} imported
                            </span>
                            <small>{album.dateRaw ?? 'Date not provided'} · {album.detailStatus}</small>
                          </div>
                          <button className="media-gallery-open" onClick={() => void openPhotoAlbum(album)}>
                            Open album
                          </button>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
            <div className="friends-import-action">
              <div>
                <strong>Comments</strong>
                <span>Import sampled comment/reply activity cards. Keep the original activity wording, group label, comment text, and raw date separately.</span>
              </div>
              <button className="secondary-button" onClick={importComments} disabled={isAnyImporting || isChoosingFolder}>
                {isImportingComments ? 'Importing comments…' : 'Import Comments'}
              </button>
            </div>
            {commentsImport && (
              <p className="friends-import-result">
                {commentsImport.filesAttempted} files checked · {commentsImport.recordsImported} comment activities imported ·
                {commentsImport.unsupportedFiles} unsupported · {commentsImport.failedFiles} failed
              </p>
            )}
            {(commentsImport || commentRecords.length > 0) && (
              <section className="conversation-workspace">
                <div className="conversation-workspace-heading">
                  <div>
                    <p className="eyebrow">YOUR ACTIVITY</p>
                    <h3>Comments &amp; replies</h3>
                    <p>Facebook's original activity description is preserved; group names are separated from your comment text.</p>
                  </div>
                  <span>{commentRecords.length.toLocaleString()} records</span>
                </div>
                <input className="conversation-filter" value={commentFilter} onChange={(event) => setCommentFilter(event.target.value)} placeholder="Filter comments…" />
                <ActivityDateFilters from={commentDateFrom} to={commentDateTo} onFromChange={setCommentDateFrom} onToChange={setCommentDateTo} />
                <div className="media-gallery-list">
                  {commentRecords.filter((record) =>
                    [record.activityRaw, record.bodyRaw, record.groupRaw, record.dateRaw, record.sourcePath].join(' ').toLocaleLowerCase().includes(commentFilter.trim().toLocaleLowerCase()) &&
                    isUtcDateInRange(record.eventTimeUtc, commentDateFrom, commentDateTo)
                  ).map((record) => (
                    <article className="media-gallery-item" key={record.id}>
                      <div className="media-gallery-icon">C</div>
                      <div className="media-gallery-copy">
                        <strong>{record.activityRaw ?? 'Comment activity'}</strong>
                        <span>{record.bodyRaw ?? 'No comment text in export'}</span>
                        <small>{record.groupRaw ? `Group: ${record.groupRaw} · ` : ''}{formatActivityDate(record.dateRaw, record.eventTimeUtc)}</small>
                        <small>{record.sourcePath}</small>
                      </div>
                    </article>
                  ))}
                  {commentRecords.length === 0 && <p className="conversation-empty">No comment activities were imported from the recognized files.</p>}
                </div>
              </section>
            )}
            <div className="friends-import-action">
              <div>
                <strong>Likes &amp; Reactions</strong>
                <span>Import observed reaction cards while keeping their original descriptions and raw dates.</span>
              </div>
              <button className="secondary-button" onClick={importReactions} disabled={isAnyImporting || isChoosingFolder}>
                {isImportingReactions ? 'Importing reactions…' : 'Import Likes & Reactions'}
              </button>
            </div>
            {reactionsImport && (
              <p className="friends-import-result">
                {reactionsImport.filesAttempted} files checked · {reactionsImport.recordsImported} reactions imported ·
                {reactionsImport.unsupportedFiles} unsupported · {reactionsImport.failedFiles} failed
              </p>
            )}
            {(reactionsImport || reactionRecords.length > 0) && (
              <section className="conversation-workspace">
                <div className="conversation-workspace-heading">
                  <div>
                    <p className="eyebrow">YOUR ACTIVITY</p>
                    <h3>Likes &amp; Reactions</h3>
                    <p>Original descriptions and exported dates are retained; unrecognized reaction images are left unclassified.</p>
                  </div>
                  <span>{reactionRecords.length.toLocaleString()} records</span>
                </div>
                <input className="conversation-filter" value={reactionFilter} onChange={(event) => setReactionFilter(event.target.value)} placeholder="Filter reactions…" />
                <ActivityDateFilters from={reactionDateFrom} to={reactionDateTo} onFromChange={setReactionDateFrom} onToChange={setReactionDateTo} />
                <div className="media-gallery-list">
                  {reactionRecords.filter((record) =>
                    [record.reactionType, record.descriptionRaw, record.dateRaw, record.sourcePath].join(' ').toLocaleLowerCase().includes(reactionFilter.trim().toLocaleLowerCase()) &&
                    isUtcDateInRange(record.eventTimeUtc, reactionDateFrom, reactionDateTo)
                  ).map((record) => (
                    <article className="media-gallery-item" key={record.id}>
                      <div className="media-gallery-icon">{record.reactionType === 'love' ? '♥' : record.reactionType === 'haha' ? '☺' : '●'}</div>
                      <div className="media-gallery-copy">
                        <strong>{record.reactionType ?? 'Unclassified reaction'}</strong>
                        <span>{record.descriptionRaw ?? 'No description in export'}</span>
                        <small>{formatActivityDate(record.dateRaw, record.eventTimeUtc)} · {record.sourcePath}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {messagesImport && (
              <p className="friends-import-result">
                {messagesImport.filesAttempted} conversations checked · {messagesImport.recordsImported} messages imported ·
                {messagesImport.mediaReferences} media references · {messagesImport.unsupportedFiles} unsupported ·
                {messagesImport.failedFiles} failed
              </p>
            )}
            {(messagesImport || conversations.length > 0) && (
              <section className="conversation-workspace" id="conversation-explorer">
                <div className="conversation-workspace-heading">
                  <div>
                    <p className="eyebrow">YOUR MESSAGES</p>
                    <h3>Conversation explorer</h3>
                    <p>Browse imported conversations locally. Message text is not included in global search.</p>
                  </div>
                  <span>{conversations.length.toLocaleString()} conversations</span>
                </div>
                {conversations.length === 0 ? (
                  <div className="conversation-empty">
                    <strong>No readable conversations found yet.</strong>
                    <span>Check the import report for unsupported or failed HTML files.</span>
                  </div>
                ) : (
                  <div className="conversation-browser">
                    <aside className="conversation-list-panel">
                      <label className="conversation-search">
                        <span>⌕</span>
                        <input
                          value={conversationFilter}
                          onChange={(event) => setConversationFilter(event.target.value)}
                          placeholder="Find a conversation…"
                          aria-label="Find a conversation"
                        />
                      </label>
                      <div className="conversation-list">
                        {visibleConversations.map((conversation) => (
                          <button
                            className={conversation.sourceFileId === selectedConversationId ? 'conversation-list-item selected' : 'conversation-list-item'}
                            key={conversation.sourceFileId}
                            onClick={() => void loadConversation(conversation.sourceFileId)}
                          >
                            <span className="conversation-avatar">{(conversation.participants[0] ?? 'M').slice(0, 1).toLocaleUpperCase()}</span>
                            <span className="conversation-list-copy">
                              <strong>{conversation.participants.join(' · ') || 'Conversation'}</strong>
                              <small>{conversation.conversationType.replaceAll('_', ' ')} · {conversation.messageCount.toLocaleString()} messages</small>
                              <small className="conversation-path">{conversation.relativePath.split('/').slice(2, -1).join('/')}</small>
                            </span>
                          </button>
                        ))}
                        {visibleConversations.length === 0 && <p className="conversation-filter-empty">No matches.</p>}
                      </div>
                    </aside>
                    <div className="conversation-detail-panel">
                      {selectedConversation ? (
                        <>
                          <div className="conversation-detail-heading">
                            <div>
                              <strong>{selectedConversation.participants.join(' · ') || 'Conversation'}</strong>
                              <span>{selectedConversation.messageCount.toLocaleString()} imported records · Original order preserved</span>
                            </div>
                            <span className="conversation-type-pill">{selectedConversation.conversationType.replaceAll('_', ' ')}</span>
                          </div>
                          {isLoadingConversation ? (
                            <div className="conversation-empty">Loading conversation…</div>
                          ) : (
                            <div className="message-timeline">
                              {conversationMessages.map((message) => (
                                <article className={message.recordType === 'call_event' ? 'message-card call-event' : 'message-card'} key={message.id}>
                                  <div className="message-card-meta">
                                    <strong>{message.sender || 'Unknown sender'}</strong>
                                    <span>{message.timestampRaw || 'Date not provided'}</span>
                                  </div>
                                  {message.body && <p>{message.body}</p>}
                                  {message.media.length > 0 && (
                                    <div className="message-attachments">
                                      {message.media.map((media) => (
                                        <div className="message-attachment" key={media.id} title={media.relativePath}>
                                          {media.previewDataUrl ? (
                                            <button className="media-preview-trigger" onClick={() => void openMedia(media)} aria-label="Open image preview">
                                              <img src={media.previewDataUrl} alt={media.mediaKind === 'sticker' ? 'Message sticker' : 'Message attachment'} loading="lazy" />
                                            </button>
                                          ) : (
                                            <button className="media-open-button" onClick={() => void openMedia(media)}>
                                              {media.mediaKind === 'video' ? '▶' : media.mediaKind === 'audio' ? '♫' : '▧'} Open {media.mediaKind}
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {message.reactions.length > 0 && (
                                    <div className="message-reactions">{message.reactions.join(' · ')}</div>
                                  )}
                                </article>
                              ))}
                              {conversationMessages.length === 0 && <div className="conversation-empty">No messages to display.</div>}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="conversation-empty">Choose a conversation to view its messages.</div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}
            <section className="media-gallery-panel">
              <div className="media-gallery-heading">
                <div>
                  <p className="eyebrow">MEDIA DISCOVERED IN THIS BACKUP</p>
                  <h3>Unified media library</h3>
                  <p>Images, videos, and audio files are indexed from the full backup, including files not yet linked to an imported record. Original media stays in place.</p>
                </div>
                <span>{mediaTotal.toLocaleString()} files found</span>
              </div>
              <form
                className="media-gallery-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadMediaGallery(mediaFilter, 1, mediaQueryInput);
                }}
              >
                <input
                  value={mediaQueryInput}
                  onChange={(event) => setMediaQueryInput(event.target.value.slice(0, 180))}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setMediaQueryInput('');
                      void loadMediaGallery(mediaFilter, 1, '');
                    }
                  }}
                  maxLength={180}
                  placeholder="Find a file by name or archive path…"
                  aria-label="Search media file names and paths"
                />
                <button className="secondary-button" type="submit" disabled={isLoadingMedia}>Search</button>
                {mediaQuery && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void loadMediaGallery(mediaFilter, 1, '')}
                    disabled={isLoadingMedia}
                  >
                    Clear
                  </button>
                )}
              </form>
              <div className="media-gallery-toolbar">
                <div className="media-gallery-filters">
                  {(['all', 'image', 'sticker', 'video', 'audio'] as ArchiveMediaGalleryFilter[]).map((kind) => (
                    <button
                      key={kind}
                      className={mediaFilter === kind ? 'active' : ''}
                      onClick={() => void loadMediaGallery(kind, 1, mediaQuery)}
                      disabled={isLoadingMedia}
                    >
                      {kind === 'all' ? 'All media' : kind}
                    </button>
                  ))}
                </div>
                <div className="media-gallery-view-controls">
                  <label>
                    <span>Items per page</span>
                    <select
                      value={mediaPageSize}
                      onChange={(event) => {
                        const nextPageSize = Number(event.target.value);
                        setMediaPageSize(nextPageSize);
                        void loadMediaGallery(mediaFilter, 1, mediaQuery, nextPageSize);
                      }}
                      disabled={isLoadingMedia}
                      aria-label="Media items per page"
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={250}>250</option>
                    </select>
                  </label>
                  <div role="group" aria-label="Media view">
                    <button type="button" className={mediaViewMode === 'grid' ? 'active' : ''} onClick={() => setMediaViewMode('grid')}>Grid</button>
                    <button type="button" className={mediaViewMode === 'list' ? 'active' : ''} onClick={() => setMediaViewMode('list')}>List</button>
                  </div>
                </div>
              </div>
              {isLoadingMedia ? (
                <div className="conversation-empty">Loading media files…</div>
              ) : visibleMedia.length === 0 ? (
                <div className="conversation-empty">No {mediaFilter === 'all' ? '' : mediaFilter + ' '}files of this type were found in the backup inventory.</div>
              ) : (
                <div className={mediaViewMode === "grid" ? "media-gallery-list media-gallery-grid" : "media-gallery-list media-gallery-list-mode"}>
                  {visibleMedia.map((media) => (
                    <article className="media-gallery-item" key={media.id + ':' + (media.recordId ?? 'file')}>
                      <div className="media-gallery-icon">{media.mediaKind === 'video' ? '▶' : media.mediaKind === 'audio' ? '♫' : '▧'}</div>
                      <div className="media-gallery-copy">
                        <strong>{media.relativePath.split('/').pop()}</strong>
                        <span>{SECTION_TITLES.get(media.sectionKey) ?? media.sectionKey} · {media.mediaKind}</span>
                        {media.width !== null && media.height !== null && <small>{media.width.toLocaleString()} × {media.height.toLocaleString()} px</small>}
                        {media.durationMs !== null && <small>{(media.durationMs / 1000).toFixed(1)} sec</small>}
                        <small>{media.title ?? 'Not linked to an imported record'}{media.recordType ? ' · ' + media.recordType.replaceAll('_', ' ') : ''}</small>
                        <small>{media.sourcePath}</small>
                        {media.body && <small className="media-gallery-caption">{media.body}</small>}
                        {media.timestampRaw && <small>{media.timestampRaw}</small>}
                      </div>
                      <button className="media-gallery-open" onClick={() => void openMedia(media)}>Open</button>
                    </article>
                  ))}
                </div>
              )}
              {mediaTotal > 0 && (
                <div className="archive-files-pagination">
                  <span>
                    Showing {((mediaPage - 1) * mediaPageSize) + 1}–{Math.min(mediaPage * mediaPageSize, mediaTotal)} of {mediaTotal.toLocaleString()} files
                  </span>
                  <div>
                    <button
                      className="secondary-button"
                      onClick={() => void loadMediaGallery(mediaFilter, mediaPage - 1, mediaQuery)}
                      disabled={isLoadingMedia || mediaPage <= 1}
                    >
                      Previous
                    </button>
                    <span>Page {mediaPage} / {Math.max(1, Math.ceil(mediaTotal / mediaPageSize))}</span>
                    <button
                      className="secondary-button"
                      onClick={() => void loadMediaGallery(mediaFilter, mediaPage + 1, mediaQuery)}
                      disabled={isLoadingMedia || mediaPage >= Math.max(1, Math.ceil(mediaTotal / mediaPageSize))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </section>
            {friendsImport && (
              <p className="friends-import-result">
                {friendsImport.filesAttempted} files checked · {friendsImport.recordsImported} records imported ·
                {friendsImport.unsupportedFiles} unsupported · {friendsImport.failedFiles} failed
              </p>
            )}

            {inspection.noDataSections.length > 0 && (
              <p className="inventory-note">
                Explicit no-data markers: {inspection.noDataSections.join(', ')}
              </p>
            )}
            {(inspection.skippedSymlinks !== null || inspection.unreadableDirectories !== null || inspection.truncated !== null) && (
              <p className="inventory-warning">
                {inspection.skippedSymlinks ?? 0} symbolic links skipped · {inspection.unreadableDirectories ?? 0} unreadable folders
                {inspection.truncated ? ' · Inventory reached the safety limit and is incomplete' : ''}
              </p>
            )}
            {inspection.totalDirectories === null && (
              <p className="inventory-note">
                Folder-count and scan-warning details were not stored for this older inventory. File and section counts were rebuilt from its saved local metadata.
              </p>
            )}
          </section>
        )}


        <section className="saved-backups-panel">
          <div className="saved-backups-heading">
            <div>
              <p className="eyebrow">LOCAL DATABASE</p>
              <h2>Saved backups</h2>
            </div>
            <span>{savedBackups.length} snapshots</span>
          </div>
          {savedBackups.length === 0 ? (
            <p className="saved-backups-empty">No backup inventories saved yet.</p>
          ) : (
            <div className="saved-backups-list">
              {savedBackups.map((backup) => (
                <article className="saved-backup-item" key={backup.id}>
                  <div className="saved-backup-mark">▤</div>
                  <div className="saved-backup-copy">
                    <strong>{backup.backupName}</strong>
                    <span>{backup.accountName}</span>
                  </div>
                  <div className="saved-backup-meta">
                    <strong>{backup.filesDiscovered.toLocaleString()} files · {backup.recordsImported.toLocaleString()} records</strong>
                    <span>{backup.status === 'discovered' ? 'Inventory saved' : backup.status}</span>
                    <small>{new Date(backup.createdAt).toLocaleString()}</small>
                  </div>
                  <button
                    className="saved-backup-open"
                    onClick={() => void openSavedBackup(backup.id)}
                    disabled={isChoosingFolder || isAnyImporting}
                  >
                    {isChoosingFolder ? 'Opening…' : inspection?.snapshotId === backup.id ? 'Opened' : 'Open'}
                  </button>
                </article>
              ))}
            </div>
          )}
          <div className="database-safety-tools">
            <div className="database-safety-copy">
              <strong>Protect your local library</strong>
              <span>Export or restore the app database, including imported records and archive indexes. Original Facebook folders, ZIP files, and media are not copied.</span>
            </div>
            <div className="database-safety-actions">
              <button
                className="secondary-button"
                onClick={() => void exportLocalDatabaseBackup()}
                disabled={isExportingDatabase || isRestoringDatabase || isChoosingFolder || isAnyImporting}
              >
                {isExportingDatabase ? 'Exporting…' : 'Export database'}
              </button>
              <button
                className="danger-outline-button"
                onClick={() => void restoreLocalDatabaseBackup()}
                disabled={isExportingDatabase || isRestoringDatabase || isChoosingFolder || isAnyImporting}
              >
                {isRestoringDatabase ? 'Validating…' : 'Restore database'}
              </button>
            </div>
            {databaseBackupStatus && <p className="database-safety-status">{databaseBackupStatus}</p>}
          </div>
          <div className="backup-compare-controls">
            <label><span>Older backup</span>
              <select value={comparisonBaselineId} onChange={(event) => {
                setComparisonBaselineId(event.target.value);
                setComparisonReport(null);
                setComparisonChanges(null);
              }}>
                <option value="">Select backup</option>
                {savedBackups.map((backup) => <option key={backup.id} value={backup.id}>{backup.accountName} · {backup.backupName}</option>)}
              </select>
            </label>
            <label><span>Newer backup</span>
              <select value={comparisonTargetId} onChange={(event) => {
                setComparisonTargetId(event.target.value);
                setComparisonReport(null);
                setComparisonChanges(null);
              }}>
                <option value="">Select backup</option>
                {savedBackups.map((backup) => <option key={backup.id} value={backup.id}>{backup.accountName} · {backup.backupName}</option>)}
              </select>
            </label>
            <button className="secondary-button" onClick={() => void compareBackups()} disabled={!comparisonBaselineId || !comparisonTargetId || isComparingBackups || isAnyImporting}>
              {isComparingBackups ? 'Comparing…' : 'Compare backups'}
            </button>
          </div>
          {inspection && (
            <section className="import-issues-panel">
              <div className="import-issues-heading">
                <div>
                  <p className="eyebrow">IMPORT DIAGNOSTICS</p>
                  <h3>Import report</h3>
                  <p>Files or items that need attention. Personal message text and raw archive contents are not shown here.</p>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => void refreshImportIssues()}
                  disabled={isRefreshingImportIssues || isAnyImporting || isChoosingFolder}
                >
                  {isRefreshingImportIssues ? 'Refreshing…' : 'Refresh report'}
                </button>
              </div>
              <div className="import-issue-counts">
                <span className="import-issue-count-error"><strong>{importIssueReport?.counts.error ?? 0}</strong> errors</span>
                <span className="import-issue-count-warning"><strong>{importIssueReport?.counts.warning ?? 0}</strong> warnings</span>
                <span className="import-issue-count-info"><strong>{importIssueReport?.counts.info ?? 0}</strong> notices</span>
              </div>
              {!importIssueReport || importIssueReport.items.length === 0 ? (
                <p className="import-issues-empty">
                  {importIssueReport ? 'No import issues have been recorded for this backup.' : 'The import report has not been loaded yet.'}
                </p>
              ) : (
                <>
                  <div className="import-issues-list">
                    {importIssueReport.items.map((issue) => (
                      <article className="import-issue-item" key={issue.id}>
                        <div className="import-issue-topline">
                          <span className={'import-issue-severity import-issue-severity-' + issue.severity}>{issue.severity}</span>
                          <code>{issue.issueCode}</code>
                          <time>{new Date(issue.createdAt).toLocaleString()}</time>
                        </div>
                        <p>{issue.safeMessage}</p>
                        <div className="import-issue-source">
                          <span>{issue.sourcePath ?? issue.sourceFileName ?? 'Archive-level issue'}</span>
                          {issue.sourceCardIndex !== null && <small>Item index {issue.sourceCardIndex}</small>}
                        </div>
                      </article>
                    ))}
                  </div>
                  {importIssueReport.hasMore && (
                    <p className="import-issues-truncated">
                      Showing the latest {importIssueReport.items.length.toLocaleString()} of {importIssueReport.total.toLocaleString()} diagnostics.
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          {comparisonReport && (
            <div className="comparison-report">
              <p><strong>{comparisonReport.baseline.backupName}</strong> → <strong>{comparisonReport.compared.backupName}</strong></p>
              <div className="comparison-stats">
                <span><strong>{comparisonReport.added.toLocaleString()}</strong> added</span>
                <span><strong>{comparisonReport.removed.toLocaleString()}</strong> removed</span>
                <span><strong>{comparisonReport.changed.toLocaleString()}</strong> changed</span>
                <span><strong>{comparisonReport.unchanged.toLocaleString()}</strong> unchanged</span>
              </div>
              {comparisonReport.sections.map((section) => (
                <div className="section-count" key={section.sectionKey}>
                  <span>{SECTION_TITLES.get(section.sectionKey) ?? section.sectionKey}</span>
                  <strong>+{section.added} · −{section.removed} · ~{section.changed}</strong>
                </div>
              ))}
              <small>Matching uses section, source filename, and original card position. This compares imported records, not binary files or inferred dates.</small>
              <div className="comparison-detail-panel">
                <div className="comparison-detail-heading">
                  <div>
                    <p className="eyebrow">RECORD-LEVEL CHANGES</p>
                    <h4>What changed between these backups</h4>
                    <p>Compare the actual imported text and source position for each added, removed, or changed record.</p>
                  </div>
                  <span>{comparisonChanges?.total.toLocaleString() ?? '—'} changes</span>
                </div>
                <div className="comparison-detail-controls">
                  <select
                    disabled={isLoadingComparisonChanges}
                    value={comparisonChangeFilter}
                    onChange={(event) => void loadComparisonChanges(
                      comparisonBaselineId, comparisonTargetId, event.target.value as ArchiveComparisonChangeKind,
                      comparisonChangeSection, comparisonChangeQuery, 1
                    )}
                    aria-label="Filter comparison change type"
                  >
                    <option value="all">All changes</option>
                    <option value="added">Added</option>
                    <option value="removed">Removed</option>
                    <option value="changed">Changed</option>
                  </select>
                  <select
                    disabled={isLoadingComparisonChanges}
                    value={comparisonChangeSection}
                    onChange={(event) => void loadComparisonChanges(
                      comparisonBaselineId, comparisonTargetId, comparisonChangeFilter,
                      event.target.value, comparisonChangeQuery, 1
                    )}
                    aria-label="Filter comparison section"
                  >
                    <option value="all">All sections</option>
                    {comparisonReport.sections.map((section) => (
                      <option key={section.sectionKey} value={section.sectionKey}>
                        {SECTION_TITLES.get(section.sectionKey) ?? section.sectionKey}
                      </option>
                    ))}
                  </select>
                  <input
                    disabled={isLoadingComparisonChanges}
                    value={comparisonChangeQuery}
                    onChange={(event) => setComparisonChangeQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void loadComparisonChanges(
                        comparisonBaselineId, comparisonTargetId, comparisonChangeFilter,
                        comparisonChangeSection, comparisonChangeQuery, 1
                      );
                    }}
                    maxLength={160}
                    placeholder="Search changed text or source path…"
                    aria-label="Search comparison changes"
                  />
                  <button
                    className="secondary-button"
                    onClick={() => void loadComparisonChanges(
                      comparisonBaselineId, comparisonTargetId, comparisonChangeFilter,
                      comparisonChangeSection, comparisonChangeQuery, 1
                    )}
                    disabled={isLoadingComparisonChanges}
                  >
                    {isLoadingComparisonChanges ? 'Loading…' : 'Apply'}
                  </button>
                </div>
                {isLoadingComparisonChanges ? (
                  <p className="comparison-detail-empty">Loading changed records…</p>
                ) : comparisonChanges && comparisonChanges.changes.length > 0 ? (
                  <div className="comparison-change-list">
                    {comparisonChanges.changes.map((change) => (
                      <article className={'comparison-change-card comparison-change-' + change.changeKind}
                        key={change.changeKind + '-' + change.sectionKey + '-' + change.sourcePath + '-' + change.sourceCardIndex}>
                        <div className="comparison-change-header">
                          <span className={'comparison-change-badge comparison-change-badge-' + change.changeKind}>{change.changeKind}</span>
                          <strong>{SECTION_TITLES.get(change.sectionKey) ?? change.sectionKey}</strong>
                          <small>{change.sourcePath} · item {change.sourceCardIndex + 1}</small>
                        </div>
                        <div className="comparison-change-columns">
                          <div className="comparison-change-version">
                            <span>Older backup</span>
                            {change.previousTitle && <strong>{change.previousTitle}</strong>}
                            <p>{change.previousBody ?? (change.changeKind === 'added' ? 'Not present in the older backup.' : 'No text in the older record.')}</p>
                            <small>{change.previousDateRaw ?? 'No exported date'}{change.previousRecordType ? ' · ' + change.previousRecordType.replaceAll('_', ' ') : ''}</small>
                          </div>
                          <div className="comparison-change-version">
                            <span>Newer backup</span>
                            {change.comparedTitle && <strong>{change.comparedTitle}</strong>}
                            <p>{change.comparedBody ?? (change.changeKind === 'removed' ? 'Not present in the newer backup.' : 'No text in the newer record.')}</p>
                            <small>{change.comparedDateRaw ?? 'No exported date'}{change.comparedRecordType ? ' · ' + change.comparedRecordType.replaceAll('_', ' ') : ''}</small>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="comparison-detail-empty">No changes match these filters.</p>
                )}
                {comparisonChanges && (
                  <div className="comparison-detail-pagination">
                    <span>
                      {comparisonChanges.total === 0 ? '0 changes' :
                        'Showing ' + (((comparisonChanges.page - 1) * comparisonChanges.pageSize) + 1) + '–' +
                        Math.min(comparisonChanges.page * comparisonChanges.pageSize, comparisonChanges.total) +
                        ' of ' + comparisonChanges.total.toLocaleString()}
                    </span>
                    <div>
                      <button className="secondary-button" onClick={() => void loadComparisonChanges(
                        comparisonBaselineId, comparisonTargetId, comparisonChangeFilter,
                        comparisonChangeSection, comparisonChangeQuery, comparisonChangePage - 1
                      )} disabled={isLoadingComparisonChanges || comparisonChangePage <= 1}>Previous</button>
                      <span>Page {comparisonChanges.page} / {Math.max(1, Math.ceil(comparisonChanges.total / comparisonChanges.pageSize))}</span>
                      <button className="secondary-button" onClick={() => void loadComparisonChanges(
                        comparisonBaselineId, comparisonTargetId, comparisonChangeFilter,
                        comparisonChangeSection, comparisonChangeQuery, comparisonChangePage + 1
                      )} disabled={isLoadingComparisonChanges || comparisonChangePage >= Math.max(1, Math.ceil(comparisonChanges.total / comparisonChanges.pageSize))}>Next</button>
                    </div>
                  </div>
                )}
                <div className="comparison-export-controls">
                  <select value={comparisonExportFormat} onChange={(event) => setComparisonExportFormat(event.target.value as ArchiveComparisonExportFormat)} aria-label="Comparison export format">
                    <option value="csv">CSV spreadsheet</option>
                    <option value="json">JSON data</option>
                  </select>
                  <button className="secondary-button" onClick={() => void exportComparisonChanges()} disabled={!comparisonChanges || comparisonChanges.total === 0 || isLoadingComparisonChanges}>
                    Export filtered changes
                  </button>
                  {comparisonExportStatus && <span>{comparisonExportStatus}</span>}
                </div>
              </div>
            </div>
          )}
        </section>

        {activeNavigation === 'marketplace' && (
          <section className="archive-data-workspace marketplace-workspace" id="marketplace-workspace">
            <div className="media-gallery-heading">
              <div>
                <p className="eyebrow">PERSONAL ACTIVITY · MARKETPLACE</p>
                <h3>Marketplace listings</h3>
                <p>Supported listings from items_sold.json and matching label/value details. Conversations, saved searches, and other files remain in Other data.</p>
              </div>
              <div className="archive-data-actions">
                <span>{marketplaceListings.length.toLocaleString()} unique listings</span>
                <button className="secondary-button" onClick={() => void importMarketplace()} disabled={isImportingMarketplace || isLoadingMarketplace || isAnyImporting}>
                  {isImportingMarketplace ? 'Importing listings…' : 'Import / refresh listings'}
                </button>
              </div>
            </div>
            {isLoadingMarketplace ? <p className="archive-data-empty">Loading Marketplace listings…</p>
              : marketplaceListings.length === 0 ? <p className="archive-data-empty">No supported listings imported yet. Unknown formats remain available in Other data.</p>
              : <div className="marketplace-listing-grid">
                {marketplaceListings.map((listing) => (
                  <article className="marketplace-listing-card" key={listing.listingKey}>
                    <div className="marketplace-listing-heading">
                      <strong>{listing.title}</strong>
                      {listing.price && <span>{listing.price}</span>}
                    </div>
                    <div className="marketplace-listing-meta">
                      {listing.category && <span>{listing.category}</span>}
                      {listing.marketplace && <span>{listing.marketplace}</span>}
                      <small>{listing.listingDateUtc ? new Date(listing.listingDateUtc).toLocaleString() : listing.listingDateRaw || 'Date not recorded'}</small>
                    </div>
                    {listing.description && <p>{listing.description}</p>}
                    {(listing.locationName || listing.address || listing.latitude !== null || listing.longitude !== null) && (
                      <div className="marketplace-listing-location">
                        {listing.locationName && <span>{listing.locationName}</span>}
                        {listing.address && <span>{listing.address}</span>}
                        {listing.latitude !== null && listing.longitude !== null && <small>{listing.latitude.toFixed(5)}, {listing.longitude.toFixed(5)}</small>}
                      </div>
                    )}
                    {listing.facebookId && <small>Facebook listing ID · {listing.facebookId}</small>}
                    <div className="event-source-list">
                      <span>{listing.sources.length} original source {listing.sources.length === 1 ? 'record' : 'records'}</span>
                      {listing.sources.map((source) => (
                        <button key={source.recordId} className="text-button" onClick={() => {
                          void loadArchiveFiles('all', 'all', source.sourcePath, 1);
                          navigateToSection('files', 'archive-files-workspace');
                        }}>{source.sourcePath} · item {source.sourceCardIndex + 1}</button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>}
          </section>
        )}

        {activeNavigation === 'saved-items' && (
          <section className="archive-data-workspace saved-items-workspace" id="saved-items-workspace">
            <div className="media-gallery-heading">
              <div>
                <p className="eyebrow">PERSONAL ACTIVITY · SAVED</p>
                <h3>Saved Items</h3>
                <p>Saved entries from the reviewed saves_v2 collection, including linked titles and validated external references. Other collection formats remain in Other data.</p>
              </div>
              <div className="archive-data-actions">
                <span>{savedItems.length.toLocaleString()} saved entries</span>
                <button className="secondary-button" onClick={() => void importSavedItems()} disabled={isImportingSavedItems || isLoadingSavedItems || isAnyImporting}>
                  {isImportingSavedItems ? 'Importing saved items…' : 'Import / refresh Saved Items'}
                </button>
              </div>
            </div>
            {isLoadingSavedItems ? <p className="archive-data-empty">Loading Saved Items…</p>
              : savedItems.length === 0 ? <p className="archive-data-empty">No supported Saved Items imported yet. Other collection formats remain in Other data.</p>
              : <div className="saved-item-list">
                {savedItems.map((item) => (
                  <article className="saved-item-card" key={item.id}>
                    <div className="saved-item-heading">
                      <strong>{item.title}</strong>
                      <small>{item.savedDateUtc ? new Date(item.savedDateUtc).toLocaleString() : item.savedDateRaw || 'Date not recorded'}</small>
                    </div>
                    {item.contexts.length > 0 && (
                      <div className="saved-item-contexts">
                        {item.contexts.map((context, index) => (
                          <div key={item.id + '-' + index}>
                            {context.name && <strong>{context.name}</strong>}
                            {context.source && <span>{context.source}</span>}
                            {context.url && <button type="button" className="text-button" onClick={() => void openExternalLink(context.url!)}>Open saved source</button>}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="event-source-list">
                      <span>Original source</span>
                      <button className="text-button" onClick={() => {
                        void loadArchiveFiles('all', 'all', item.sourcePath, 1);
                        navigateToSection('files', 'archive-files-workspace');
                      }}>{item.sourcePath} · item {item.sourceCardIndex + 1}</button>
                    </div>
                  </article>
                ))}
              </div>}
          </section>
        )}

        {activeNavigation === 'events' && (
          <section className="events-workspace" id="events-workspace">
            <div className="media-gallery-heading">
              <div>
                <p className="eyebrow">PERSONAL ACTIVITY · EVENTS</p>
                <h3>Events</h3>
                <p>Events joined, hosted, interested, declined, or invited. Repeated entries from response and invitation files are combined; all original source references are retained.</p>
              </div>
              <div className="events-workspace-actions">
                <span>{eventRecords.length.toLocaleString()} unique events</span>
                <button className="secondary-button" onClick={() => void importEvents()} disabled={isImportingEvents || isLoadingEvents || isAnyImporting}>
                  {isImportingEvents ? 'Importing Events…' : 'Import / refresh Events'}
                </button>
              </div>
            </div>
            {isLoadingEvents ? (
              <p className="events-empty">Loading Events…</p>
            ) : eventRecords.length === 0 ? (
              <p className="events-empty">No supported Events records have been imported yet. Run Import / refresh Events to process the reviewed JSON files. Unrecognized files remain available in Other data.</p>
            ) : (
              <div className="events-record-list">
                {eventRecords.map((record) => (
                  <article className="event-record-card" key={record.eventKey}>
                    <div className="event-record-heading">
                      <div>
                        <strong>{record.title}</strong>
                        <span>{record.rsvp.replaceAll('_', ' ')}</span>
                      </div>
                      <small>{record.startDateUtc ? new Date(record.startDateUtc).toLocaleString() : record.startDateRaw ?? 'Start date not provided'}</small>
                    </div>
                    {record.description && <p>{record.description}</p>}
                    {(record.locationName || record.address) && (
                      <div className="event-record-location">
                        {record.locationName && <span>{record.locationName}</span>}
                        {record.address && <span>{record.address}</span>}
                      </div>
                    )}
                    {record.endDateUtc && (
                      <small>Ends: {new Date(record.endDateUtc).toLocaleString()}</small>
                    )}
                    {record.url && /^https?:\/\//iu.test(record.url) && (
                      <button type="button" className="text-button" onClick={() => void openExternalLink(record.url!)}>Open Facebook event</button>
                    )}
                    <div className="event-source-list">
                      <span>{record.sources.length} original source {record.sources.length === 1 ? 'record' : 'records'}</span>
                      {record.sources.map((source) => (
                        <button key={source.recordId} className="text-button"
                          onClick={() => {
                            void loadArchiveFiles('all', 'all', source.sourcePath, 1);
                            navigateToSection('files', 'archive-files-workspace');
                          }}>
                          {source.sourcePath} · item {source.sourceCardIndex + 1}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {((isGroupsWorkspace && groupsFallbackSection !== null) || (activeNavigation === 'other' && nonGroupFallbackSections.length > 0)) && (
          <section className="fallback-records-panel" id="fallback-records-workspace">
            <div className="media-gallery-heading">
              <div>
                <p className="eyebrow">{isGroupsWorkspace ? 'GROUP ACTIVITY' : 'PRESERVED ARCHIVE CONTENT'}</p>
                <h3>{isGroupsWorkspace ? 'Groups' : 'Other data'}</h3>
                <p>{isGroupsWorkspace
                  ? 'Browse posts, comments, and group membership activity from the three reviewed Accounts Center JSON exports. Other Groups export formats remain preserved separately until their structures are verified.'
                  : 'Browse text preserved from HTML, JSON, and TXT files that do not yet have a dedicated section parser. Search is scoped to the selected section; original source files remain unchanged.'}</p>
              </div>
              <span>{visibleFallbackSections.reduce((total, section) => total + section.recordCount, 0).toLocaleString()} records</span>
            </div>
            <div className="fallback-record-controls">
              <label>
                <span>Archive section</span>
                <select
                  value={fallbackSectionKey}
                  onChange={(event) => {
                    setFallbackQuery('');
                    void loadFallbackArchiveRecords(event.target.value, 1, '');
                  }}
                  disabled={isLoadingFallbackRecords}
                >
                  {visibleFallbackSections.map((section) => (
                    <option key={section.sectionKey} value={section.sectionKey}>
                      {SECTION_TITLES.get(section.sectionKey) ?? section.sectionKey} ({section.recordCount.toLocaleString()})
                    </option>
                  ))}
                </select>
              </label>
              <label className="fallback-query-label">
                <span>Search within this section</span>
                <input
                  type="search"
                  value={fallbackQuery}
                  maxLength={120}
                  placeholder="Search titles, text, or source paths…"
                  onChange={(event) => setFallbackQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void loadFallbackArchiveRecords(fallbackSectionKey, 1, fallbackQuery);
                  }}
                  disabled={isLoadingFallbackRecords}
                />
              </label>
              <div className="fallback-query-actions">
                <button className="secondary-button" onClick={() => void loadFallbackArchiveRecords(fallbackSectionKey, 1, fallbackQuery)} disabled={isLoadingFallbackRecords || !fallbackSectionKey}>Search</button>
                <button className="secondary-button" onClick={() => { setFallbackQuery(''); void loadFallbackArchiveRecords(fallbackSectionKey, 1, ''); }} disabled={isLoadingFallbackRecords || (!fallbackQuery && !fallbackAppliedQuery)}>Clear</button>
              </div>
              {isGroupsWorkspace
                ? <span className="fallback-sensitivity">Reviewed Groups JSON subset · original fields remain available below</span>
                : visibleFallbackSections.find((section) => section.sectionKey === fallbackSectionKey)?.sensitivity === 'sensitive'
                  ? <span className="fallback-sensitivity sensitive">Sensitive section · excluded from global search; filter within this section only</span>
                  : <span className="fallback-sensitivity">Preserved fallback text · not a verified structured parser</span>}
            </div>
            {isLoadingFallbackRecords ? (
              <p className="fallback-records-empty">Loading preserved records…</p>
            ) : fallbackRecords && fallbackRecords.records.length > 0 ? (
              <div className="fallback-record-list">
                {fallbackRecords.records.map((record) => {
                  const groupMetadata = record.sectionKey === 'groups'
                    ? getGroupActivityMetadata(record.sourcePath, record.payloadPreview)
                    : null;
                  return (
                    <article className="fallback-record-card" key={record.id}>
                      <div className="fallback-record-heading">
                        <strong>{record.title || 'Archive entry'}</strong>
                        <span>{groupMetadata?.label ?? (record.recordType === 'json_item' ? 'JSON' : record.recordType === 'text_item' ? 'TXT' : 'HTML')} · {record.sensitivity}</span>
                      </div>
                      {groupMetadata && (groupMetadata.groupName || groupMetadata.authorName) && (
                        <div className="group-record-metadata">
                          {groupMetadata.groupName && <span>Group: {groupMetadata.groupName}</span>}
                          {groupMetadata.authorName && <span>Author: {groupMetadata.authorName}</span>}
                        </div>
                      )}
                      {record.body && <p>{record.body}</p>}
                      <details className="fallback-record-payload">
                        <summary>
                          {record.recordType === 'json_item'
                            ? 'View original JSON fields'
                            : record.recordType === 'text_item'
                              ? 'View preserved text'
                              : 'View extracted HTML item data'}
                        </summary>
                        <pre>{formatFallbackPayload(record.payloadPreview, record.recordType)}</pre>
                        {record.payloadTruncated && <small>Preview limited to the first 20,000 characters. The complete stored record remains in the local database.</small>}
                      </details>
                      <small>{record.dateRaw ?? 'Date not provided'} · {record.sourcePath} · Item {record.sourceRecordIndex + 1}</small>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="fallback-records-empty">
                {fallbackAppliedQuery
                  ? 'No records match this section filter. Clear the search to see all preserved records.'
                  : 'There are no preserved records in this section.'}
              </p>
            )}
            {fallbackRecords && (
              <div className="fallback-record-pagination">
                <span>
                  {fallbackRecords.total === 0 ? '0 records' :
                    'Showing ' + (((fallbackRecords.page - 1) * fallbackRecords.pageSize) + 1) + '–' +
                    Math.min(fallbackRecords.page * fallbackRecords.pageSize, fallbackRecords.total) +
                    ' of ' + fallbackRecords.total.toLocaleString()}
                </span>
                <div>
                  <button className="secondary-button" onClick={() => void loadFallbackArchiveRecords(fallbackSectionKey, fallbackRecords.page - 1, fallbackAppliedQuery)} disabled={isLoadingFallbackRecords || fallbackRecords.page <= 1}>Previous</button>
                  <span>Page {fallbackRecords.page} / {Math.max(1, Math.ceil(fallbackRecords.total / fallbackRecords.pageSize))}</span>
                  <button className="secondary-button" onClick={() => void loadFallbackArchiveRecords(fallbackSectionKey, fallbackRecords.page + 1, fallbackAppliedQuery)} disabled={isLoadingFallbackRecords || fallbackRecords.page >= Math.max(1, Math.ceil(fallbackRecords.total / fallbackRecords.pageSize))}>Next</button>
                </div>
              </div>
            )}
            <p className="fallback-record-note">{isGroupsWorkspace
              ? 'This view covers only the three reviewed Groups JSON exports. Fields that were not present in the observed structures are not inferred; open original JSON fields to inspect preserved source data.'
              : 'Fallback records are preserved for local reference. Their field meanings, dates, and relationships have not been verified by a section-specific importer.'}</p>
          </section>
        )}

        <section className="section-heading">
          <div>
            <p className="eyebrow">YOUR ARCHIVE, ORGANIZED</p>
            <h2>Explore by what matters</h2>
          </div>
          <span className="section-caption">Use the left sidebar to jump between the available archive sections.</span>
        </section>

        <section className="feature-grid">
          <article className="feature-card">
            <div className="feature-icon icon-violet">✉</div>
            <h3>Conversations</h3>
            <p>Messages, participants, attachments, and conversation timelines.</p>
            <span className="feature-status">Available · sampled export structure</span>
          </article>
          <article className="feature-card">
            <div className="feature-icon icon-blue">▧</div>
            <h3>Photos &amp; videos</h3>
            <p>Album browsing, captions, comments, and local media previews.</p>
            <span className="feature-status">Available · sampled album pages</span>
          </article>
          <article className="feature-card">
            <div className="feature-icon icon-amber">◷</div>
            <h3>Activity history</h3>
            <p>Posts, comments, reactions, and imported activity records.</p>
            <span className="feature-status">Partially available</span>
          </article>
          <article className="feature-card">
            <div className="feature-icon icon-green">⌕</div>
            <h3>Unified search</h3>
            <p>Search indexed local records by text and section, with JSON export of selected results.</p>
            <span className="feature-status">Available</span>
          </article>
        </section>

        <footer className="page-footer">
          <span>Built for local-first archive exploration.</span>
          <span>No archive upload · No telemetry · No external content fetching</span>
        </footer>
        {activeMedia && (
          <div className="media-viewer-backdrop" role="presentation" onClick={() => setActiveMedia(null)}>
            <section className="media-viewer" role="dialog" aria-modal="true" aria-label="Attachment viewer" onClick={(event) => event.stopPropagation()}>
              <header className="media-viewer-header">
                <div><strong>{activeMedia.mediaKind.toLocaleUpperCase()}</strong><span>{activeMedia.relativePath.split('/').pop()}</span></div>
                <button onClick={() => setActiveMedia(null)} aria-label="Close attachment viewer">×</button>
              </header>
              <div className="media-viewer-content">
                {activeMedia.loading && <p>Loading attachment from this backup…</p>}
                {activeMedia.error && <p className="media-viewer-error">{activeMedia.error}</p>}
                {activeMedia.streamUrl && activeMedia.mediaKind === 'video' && <video src={activeMedia.streamUrl} controls autoPlay />}
                {activeMedia.streamUrl && activeMedia.mediaKind === 'audio' && <audio src={activeMedia.streamUrl} controls autoPlay />}
                {activeMedia.dataUrl && (activeMedia.mediaKind === 'image' || activeMedia.mediaKind === 'sticker') && <img src={activeMedia.dataUrl} alt="Selected archive attachment" />}
              </div>
              <footer>Streamed locally from the selected backup; seeking uses byte-range requests. Images use bounded local previews.</footer>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
