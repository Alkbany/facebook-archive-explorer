import { useEffect, useState } from 'react';
import type {
  ArchiveInspectionReport,
  ArchiveSnapshotSummary,
  FriendsImportSectionResult,
  PostsImportSectionResult,
  CommentsImportSectionResult,
  CommentActivitySummary,
  PostRecordSummary,
  MessagesImportSectionResult,
  ReactionsImportSectionResult,
  ReactionRecordSummary,
  ImportAllSupportedDataResult
} from '../../shared/archive/inspection';
import { ARCHIVE_SECTIONS } from '../../shared/archive/section-registry';
import type { MessageConversationSummary, MessageRecordSummary } from '../../shared/archive/messages';
import type { ArchiveMediaGalleryItem } from '../../shared/archive/media';
import type { ArchiveSearchResult } from '../../shared/archive/search';
import type { ArchiveComparisonReport } from '../../shared/archive/comparison';

const SECTION_TITLES = new Map(ARCHIVE_SECTIONS.map((section) => [section.key, section.title]));

function App() {
  const [version, setVersion] = useState('0.1.0');
  const [accountName, setAccountName] = useState('My Facebook account');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [inspection, setInspection] = useState<ArchiveInspectionReport | null>(null);
  const [savedBackups, setSavedBackups] = useState<ArchiveSnapshotSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSection, setSearchSection] = useState('all');
  const [searchResults, setSearchResults] = useState<ArchiveSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchExportStatus, setSearchExportStatus] = useState('');
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [searchedSection, setSearchedSection] = useState('all');
  const [comparisonBaselineId, setComparisonBaselineId] = useState('');
  const [comparisonTargetId, setComparisonTargetId] = useState('');
  const [comparisonReport, setComparisonReport] = useState<ArchiveComparisonReport | null>(null);
  const [isComparingBackups, setIsComparingBackups] = useState(false);
  const [friendsImport, setFriendsImport] = useState<FriendsImportSectionResult | null>(null);
  const [postsImport, setPostsImport] = useState<PostsImportSectionResult | null>(null);
  const [postRecords, setPostRecords] = useState<PostRecordSummary[]>([]);
  const [postFilter, setPostFilter] = useState('');
  const [commentsImport, setCommentsImport] = useState<CommentsImportSectionResult | null>(null);
  const [commentRecords, setCommentRecords] = useState<CommentActivitySummary[]>([]);
  const [commentFilter, setCommentFilter] = useState('');
  const [isImportingComments, setIsImportingComments] = useState(false);
  const [isImportingPosts, setIsImportingPosts] = useState(false);
  const [messagesImport, setMessagesImport] = useState<MessagesImportSectionResult | null>(null);
  const [reactionsImport, setReactionsImport] = useState<ReactionsImportSectionResult | null>(null);
  const [reactionRecords, setReactionRecords] = useState<ReactionRecordSummary[]>([]);
  const [reactionFilter, setReactionFilter] = useState('');
  const [isImportingReactions, setIsImportingReactions] = useState(false);
  const [isImportingMessages, setIsImportingMessages] = useState(false);
  const [conversations, setConversations] = useState<MessageConversationSummary[]>([]);
  const [conversationMessages, setConversationMessages] = useState<MessageRecordSummary[]>([]);
  const [mediaGallery, setMediaGallery] = useState<ArchiveMediaGalleryItem[]>([]);
  const [mediaFilter, setMediaFilter] = useState('all');
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [conversationFilter, setConversationFilter] = useState('');
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [activeMedia, setActiveMedia] = useState<{ id: number; mediaKind: string; relativePath: string; dataUrl: string | null; streamUrl: string | null; loading: boolean; error: string | null } | null>(null);
  const [isImportingFriends, setIsImportingFriends] = useState(false);
  const [isImportingAll, setIsImportingAll] = useState(false);
  const [importAllSummary, setImportAllSummary] = useState<ImportAllSupportedDataResult['totals'] | null>(null);
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.desktopApi.getAppInfo()
      .then((info) => setVersion(info.appVersion))
      .catch(() => setError('Could not read application information.'));

    void window.desktopApi.listArchiveSnapshots()
      .then(setSavedBackups)
      .catch(() => setError('Could not load saved backups from the local database.'));
  }, []);

  async function chooseFolder() {
    setIsChoosingFolder(true);
    setError(null);
    setInspection(null);
    setSearchResults([]);
    setSearchQuery('');
    setSearchExportStatus('');
    setSearchedQuery(null);
    setSearchedSection('all');
    setComparisonReport(null);
    setMediaGallery([]);
    setImportAllSummary(null);
    setFriendsImport(null);
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
    setSelectedConversationId(null);
    setConversationFilter('');

    try {
      const selection = await window.desktopApi.selectBackupDirectory(accountName);
      if (selection.status === 'cancelled') return;

      setSelectedFolder(selection.folderName);
      setAccountName(selection.accountName);
      const report = await window.desktopApi.inspectSelectedBackup();
      setInspection(report);
      setMediaGallery(await window.desktopApi.listMediaForSelectedBackup());
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
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
    setSearchResults([]);
    setSearchQuery('');
    setSearchExportStatus('');
    setSearchedQuery(null);
    setSearchedSection('all');
    setComparisonReport(null);
    setMediaGallery([]);
    setImportAllSummary(null);
    setFriendsImport(null);
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

    try {
      const report = await window.desktopApi.openSavedSnapshot(snapshotId);
      const saved = savedBackups.find((backup) => backup.id === snapshotId);
      setSelectedFolder(report.archiveName);
      if (saved) setAccountName(saved.accountName);
      setInspection(report);
      const [posts, comments, reactions, foundConversations, media] = await Promise.all([
        window.desktopApi.listPostsForSelectedBackup(),
        window.desktopApi.listCommentsForSelectedBackup(),
        window.desktopApi.listReactionsForSelectedBackup(),
        window.desktopApi.listMessagesForSelectedBackup(),
        window.desktopApi.listMediaForSelectedBackup()
      ]);
      setPostRecords(posts);
      setCommentRecords(comments);
      setReactionRecords(reactions);
      setConversations(foundConversations);
      setMediaGallery(media);
      if (foundConversations.length > 0) await loadConversation(foundConversations[0].sourceFileId);
    } catch {
      setInspection(null);
      setError('Could not reopen this saved backup. Its original folder may have been moved, renamed, or disconnected. Select the folder again to reconnect it.');
    } finally {
      setIsChoosingFolder(false);
    }
  }

  async function refreshMediaGallery() {
    try {
      setMediaGallery(await window.desktopApi.listMediaForSelectedBackup());
    } catch {
      setError('The local media index could not be refreshed.');
    }
  }

  async function runArchiveSearch() {
    const query = searchQuery;
    const section = searchSection === 'all' ? null : searchSection;
    setIsSearching(true);
    setSearchExportStatus('');
    setSearchedQuery(null);
    setError(null);
    try {
      const results = await window.desktopApi.searchRecordsForSelectedBackup(query, section);
      setSearchResults(results);
      setSearchedQuery(query);
      setSearchedSection(searchSection);
    } catch {
      setSearchResults([]);
      setError('Search could not be completed. Try a shorter search phrase.');
    } finally {
      setIsSearching(false);
    }
  }

  async function exportArchiveSearch() {
    if (searchedQuery === null) return;
    setSearchExportStatus('');
    setError(null);
    try {
      const result = await window.desktopApi.exportSearchResultsForSelectedBackup(
        searchedQuery, searchedSection === 'all' ? null : searchedSection
      );
      setSearchExportStatus(result.status === 'saved'
        ? `Saved ${result.recordsExported} records to ${result.fileName}.`
        : 'Export cancelled.');
    } catch {
      setError('Search results could not be exported.');
    }
  }

  async function compareBackups() {
    setIsComparingBackups(true);
    setComparisonReport(null);
    setError(null);
    try {
      setComparisonReport(await window.desktopApi.compareArchiveSnapshots(comparisonBaselineId, comparisonTargetId));
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
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch {
      setError('Comments data could not be imported. Check the local import report.');
    } finally {
      setIsImportingComments(false);
    }
  }

  async function importFriends() {
    setIsImportingFriends(true);
    setError(null);

    try {
      const result = await window.desktopApi.importFriendsForSelectedBackup();
      setFriendsImport(result);
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch {
      setError('Friends data could not be imported. Check the local import report.');
    } finally {
      setIsImportingFriends(false);
    }
  }

  async function importAllSupportedData() {
    setIsImportingAll(true);
    setImportAllSummary(null);
    setError(null);
    try {
      const result = await window.desktopApi.importAllSupportedDataForSelectedBackup();
      setFriendsImport(result.sections.friends);
      setMessagesImport(result.sections.messages);
      setPostsImport(result.sections.posts);
      setCommentsImport(result.sections.comments);
      setReactionsImport(result.sections.reactions);

      const [posts, comments, reactions, foundConversations] = await Promise.all([
        window.desktopApi.listPostsForSelectedBackup(),
        window.desktopApi.listCommentsForSelectedBackup(),
        window.desktopApi.listReactionsForSelectedBackup(),
        window.desktopApi.listMessagesForSelectedBackup()
      ]);
      setPostRecords(posts);
      setCommentRecords(comments);
      setReactionRecords(reactions);
      setConversations(foundConversations);
      if (foundConversations.length > 0) {
        await loadConversation(foundConversations[0].sourceFileId);
      } else {
        setSelectedConversationId(null);
        setConversationMessages([]);
      }

      await refreshMediaGallery();
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
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch {
      setError('Likes & Reactions data could not be imported. Check the local import report.');
    } finally {
      setIsImportingReactions(false);
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
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
      if (foundConversations.length > 0) await loadConversation(foundConversations[0].sourceFileId);
    } catch {
      setError('Messages data could not be imported. Check the local import report.');
    } finally {
      setIsImportingMessages(false);
    }
  }

  const selectedConversation = conversations.find((item) => item.sourceFileId === selectedConversationId) ?? null;
  const visibleMedia = mediaGallery.filter((media) => mediaFilter === 'all' || media.mediaKind === mediaFilter);
  const visibleConversations = conversations.filter((item) => {
    const haystack = [item.relativePath, item.conversationType, ...item.participants].join(' ').toLocaleLowerCase();
    return haystack.includes(conversationFilter.trim().toLocaleLowerCase());
  });

  const sectionCounts = inspection
    ? Object.entries(inspection.sectionFileCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    : [];

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
        <div className="nav-item nav-item-active"><span>⌂</span> Overview</div>
        <div className="nav-item nav-item-muted"><span>▤</span> Conversations <small>Soon</small></div>
        <div className="nav-item nav-item-muted"><span>▧</span> Photos &amp; videos <small>Soon</small></div>
        <div className="nav-item nav-item-muted"><span>◷</span> Activity <small>Soon</small></div>
        <div className="nav-item nav-item-muted"><span>⌕</span> Search <small>Soon</small></div>

        <div className="sidebar-bottom">
          <div className="local-indicator"><i /> Local workspace</div>
          <p>Your archive is processed on this device.</p>
          <span className="version-label">Version {version}</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">YOUR PERSONAL ARCHIVE</p>
            <h1>Everything in its place.</h1>
            <p className="page-subtitle">A clearer way to explore the history you exported.</p>
          </div>
          <div className="privacy-pill"><i /> On this device</div>
        </header>

        <section className="welcome-panel">
          <div className="welcome-copy">
            <p className="panel-kicker">GET STARTED</p>
            <h2>Bring your archive into focus.</h2>
            <p>
              Choose the Facebook export folder on your computer. The first pass only
              inventories filenames and file types; it does not open archive contents.
            </p>

            <label className="account-field">
              <span>Facebook account label</span>
              <input
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                maxLength={100}
                placeholder="My Facebook account"
                disabled={isChoosingFolder}
              />
            </label>

            <button className="primary-button" onClick={chooseFolder} disabled={isChoosingFolder || !accountName.trim()}>
              <span className="button-icon">＋</span>
              {isChoosingFolder ? 'Inspecting folder…' : 'Choose backup folder'}
            </button>

            {selectedFolder && (
              <div className="selected-folder">
                <span className="selected-folder-icon">✓</span>
                <div>
                  <strong>{accountName} · {selectedFolder}</strong>
                  <span>Discovery metadata was saved in the local database.</span>
                </div>
              </div>
            )}
            {error && <p className="error-message">{error}</p>}
            <p className="helper-text">Use the same label for backups from one account, or a different label for another account. Your original export is not moved or modified.</p>
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
                <h2>Folder inventory</h2>
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
                <span>Run Friends, Messages, Posts, Comments, and Likes &amp; Reactions importers in sequence. Already completed files are skipped; failed or unsupported files remain retryable.</span>
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
                disabled={isImportingAll || isChoosingFolder || isImportingFriends || isImportingMessages || isImportingPosts || isImportingComments || isImportingReactions}
              >
                {isImportingAll ? 'Importing supported data…' : 'Import All Supported Data'}
              </button>
            </div>

            <section className="unified-search-panel">
              <div className="media-gallery-heading">
                <div>
                  <p className="eyebrow">LOCAL FULL-TEXT SEARCH</p>
                  <h3>Search this backup</h3>
                  <p>Searches indexed Friends, Posts, Comments, and Likes &amp; Reactions. Private message text remains excluded.</p>
                </div>
                <span>{searchResults.length.toLocaleString()} results</span>
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
                  setSearchResults([]);
                  setSearchedQuery(null);
                  setSearchExportStatus('');
                }} aria-label="Filter search by section">
                  <option value="all">All searchable sections</option>
                  {ARCHIVE_SECTIONS.filter((section) => ['friends', 'posts', 'comments', 'likes_and_reactions'].includes(section.key)).map((section) => (
                    <option key={section.key} value={section.key}>{section.title}</option>
                  ))}
                </select>
                <button className="secondary-button" onClick={() => void runArchiveSearch()} disabled={isSearching || !searchQuery.trim()}>
                  {isSearching ? 'Searching…' : 'Search'}
                </button>
              </div>
              <div className="search-results-list">
                {searchResults.map((result) => (
                  <article className="search-result-item" key={result.id}>
                    <div className="search-result-heading">
                      <strong>{SECTION_TITLES.get(result.sectionKey) ?? result.sectionKey}</strong>
                      <span>{result.recordType.replaceAll('_', ' ')}</span>
                    </div>
                    {result.title && <strong>{result.title}</strong>}
                    {result.body && <p>{result.body}</p>}
                    <small>{result.dateRaw ?? 'Date not provided'} · {result.sourcePath} · card {result.sourceCardIndex + 1}</small>
                  </article>
                ))}
                {searchResults.length === 0 && searchQuery.trim() && !isSearching && (
                  <p className="conversation-empty">No matching indexed records. Import the relevant section first.</p>
                )}
              </div>
              <div className="search-export-row">
                <span>{searchExportStatus || (searchResults.length === 250 ? 'The result list is capped at 250 records.' : '')}</span>
                <button className="secondary-button" onClick={() => void exportArchiveSearch()} disabled={!searchResults.length || searchedQuery === null || isSearching}>
                  Export results as JSON
                </button>
              </div>
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


            <div className="friends-import-action">
              <div>
                <strong>Friends</strong>
                <span>Import the five recognized Friends HTML files. Other sections remain untouched.</span>
              </div>
              <button
                className="secondary-button"
                onClick={importFriends}
                disabled={isImportingFriends || isImportingAll}
              >
                {isImportingFriends ? 'Importing Friends…' : 'Import Friends'}
              </button>
            </div>
            <div className="friends-import-action">
              <div>
                <strong>Messages</strong>
                <span>Import recognized conversation HTML from inbox, archived, filtered, and request folders. Messages stay out of search indexing by default.</span>
              </div>
              <button className="secondary-button" onClick={importMessages} disabled={isImportingMessages || isImportingAll}>
                {isImportingMessages ? 'Importing Messages…' : 'Import Messages'}
              </button>
            </div>
            <div className="friends-import-action">
              <div>
                <strong>Posts</strong>
                <span>Import sampled post cards, keep exported dates and authors, and link local photos/videos without copying them.</span>
              </div>
              <button className="secondary-button" onClick={importPosts} disabled={isImportingPosts || isImportingAll}>
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
              <section className="conversation-workspace">
                <div className="conversation-workspace-heading">
                  <div>
                    <p className="eyebrow">YOUR ACTIVITY</p>
                    <h3>Posts</h3>
                    <p>Original author labels and raw exported dates are preserved. Only local archive media is linked.</p>
                  </div>
                  <span>{postRecords.length.toLocaleString()} records</span>
                </div>
                <input className="conversation-filter" value={postFilter} onChange={(event) => setPostFilter(event.target.value)} placeholder="Filter posts…" />
                <div className="media-gallery-list">
                  {postRecords.filter((record) => [record.authorRaw, record.bodyRaw, record.dateRaw, record.sourcePath].join(' ').toLocaleLowerCase().includes(postFilter.trim().toLocaleLowerCase())).map((record) => (
                    <article className="media-gallery-item" key={record.id}>
                      <div className="media-gallery-icon">P</div>
                      <div className="media-gallery-copy">
                        <strong>{record.authorRaw ?? 'Post'}</strong>
                        <span>{record.bodyRaw ?? 'No text in export'}{record.mediaCount ? ` · ${record.mediaCount} attachments` : ''}</span>
                        <small>{record.dateRaw ?? 'Date not provided'} · {record.sourcePath}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
            <div className="friends-import-action">
              <div>
                <strong>Comments</strong>
                <span>Import sampled comment/reply activity cards. Keep the original activity wording, group label, comment text, and raw date separately.</span>
              </div>
              <button className="secondary-button" onClick={importComments} disabled={isImportingComments || isImportingAll}>
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
                <div className="media-gallery-list">
                  {commentRecords.filter((record) => [record.activityRaw, record.bodyRaw, record.groupRaw, record.dateRaw, record.sourcePath].join(' ').toLocaleLowerCase().includes(commentFilter.trim().toLocaleLowerCase())).map((record) => (
                    <article className="media-gallery-item" key={record.id}>
                      <div className="media-gallery-icon">C</div>
                      <div className="media-gallery-copy">
                        <strong>{record.activityRaw ?? 'Comment activity'}</strong>
                        <span>{record.bodyRaw ?? 'No comment text in export'}</span>
                        <small>{record.groupRaw ? `Group: ${record.groupRaw} · ` : ''}{record.dateRaw ?? 'Date not provided'}</small>
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
              <button className="secondary-button" onClick={importReactions} disabled={isImportingReactions || isImportingAll}>
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
                <div className="media-gallery-list">
                  {reactionRecords.filter((record) => [record.reactionType, record.descriptionRaw, record.dateRaw, record.sourcePath].join(' ').toLocaleLowerCase().includes(reactionFilter.trim().toLocaleLowerCase())).map((record) => (
                    <article className="media-gallery-item" key={record.id}>
                      <div className="media-gallery-icon">{record.reactionType === 'love' ? '♥' : record.reactionType === 'haha' ? '☺' : '●'}</div>
                      <div className="media-gallery-copy">
                        <strong>{record.reactionType ?? 'Unclassified reaction'}</strong>
                        <span>{record.descriptionRaw ?? 'No description in export'}</span>
                        <small>{record.dateRaw ?? 'Date not provided'} · {record.sourcePath}</small>
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
                <span>{mediaGallery.length.toLocaleString()} references{mediaGallery.length === 1000 ? ' · first 1,000 shown' : ''}</span>
              </div>
              <div className="media-gallery-filters">
                {['all', 'image', 'sticker', 'video', 'audio'].map((kind) => (
                  <button key={kind} className={mediaFilter === kind ? 'active' : ''} onClick={() => setMediaFilter(kind)}>
                    {kind === 'all' ? 'All media' : kind}
                  </button>
                ))}
              </div>
              {visibleMedia.length === 0 ? (
                <div className="conversation-empty">No {mediaFilter === 'all' ? '' : mediaFilter + ' '}files of this type were found in the backup inventory.</div>
              ) : (
                <div className="media-gallery-list">
                  {visibleMedia.map((media) => (
                    <article className="media-gallery-item" key={media.id + ':' + (media.recordId ?? 'file')}>
                      <div className="media-gallery-icon">{media.mediaKind === 'video' ? '▶' : media.mediaKind === 'audio' ? '♫' : '▧'}</div>
                      <div className="media-gallery-copy">
                        <strong>{media.relativePath.split('/').pop()}</strong>
                        <span>{SECTION_TITLES.get(media.sectionKey) ?? media.sectionKey} · {media.mediaKind}</span>
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
                    disabled={isChoosingFolder}
                  >
                    {isChoosingFolder ? 'Opening…' : inspection?.snapshotId === backup.id ? 'Opened' : 'Open'}
                  </button>
                </article>
              ))}
            </div>
          )}
          <div className="backup-compare-controls">
            <label><span>Older backup</span>
              <select value={comparisonBaselineId} onChange={(event) => setComparisonBaselineId(event.target.value)}>
                <option value="">Select backup</option>
                {savedBackups.map((backup) => <option key={backup.id} value={backup.id}>{backup.accountName} · {backup.backupName}</option>)}
              </select>
            </label>
            <label><span>Newer backup</span>
              <select value={comparisonTargetId} onChange={(event) => setComparisonTargetId(event.target.value)}>
                <option value="">Select backup</option>
                {savedBackups.map((backup) => <option key={backup.id} value={backup.id}>{backup.accountName} · {backup.backupName}</option>)}
              </select>
            </label>
            <button className="secondary-button" onClick={() => void compareBackups()} disabled={!comparisonBaselineId || !comparisonTargetId || isComparingBackups}>
              {isComparingBackups ? 'Comparing…' : 'Compare backups'}
            </button>
          </div>
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
            </div>
          )}
        </section>

        <section className="section-heading">
          <div>
            <p className="eyebrow">YOUR ARCHIVE, ORGANIZED</p>
            <h2>Explore by what matters</h2>
          </div>
          <span className="section-caption">Modules are added as import support is completed</span>
        </section>

        <section className="feature-grid">
          <article className="feature-card">
            <div className="feature-icon icon-violet">✉</div>
            <h3>Conversations</h3>
            <p>Messages, participants, attachments, and conversation timelines.</p>
            <span className="feature-status">In development</span>
          </article>
          <article className="feature-card">
            <div className="feature-icon icon-blue">▧</div>
            <h3>Photos &amp; videos</h3>
            <p>Albums, media details, captions, and original local files.</p>
            <span className="feature-status">Planned</span>
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
