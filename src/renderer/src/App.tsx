import { useEffect, useState } from 'react';
import type {
  ArchiveInspectionReport,
  ArchiveSnapshotSummary,
  FriendsImportSectionResult
} from '../../shared/archive/inspection';
import { ARCHIVE_SECTIONS } from '../../shared/archive/section-registry';

const SECTION_TITLES = new Map(ARCHIVE_SECTIONS.map((section) => [section.key, section.title]));

function App() {
  const [version, setVersion] = useState('0.1.0');
  const [accountName, setAccountName] = useState('My Facebook account');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [inspection, setInspection] = useState<ArchiveInspectionReport | null>(null);
  const [savedBackups, setSavedBackups] = useState<ArchiveSnapshotSummary[]>([]);
  const [friendsImport, setFriendsImport] = useState<FriendsImportSectionResult | null>(null);
  const [isImportingFriends, setIsImportingFriends] = useState(false);
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
    setFriendsImport(null);

    try {
      const selection = await window.desktopApi.selectBackupDirectory(accountName);
      if (selection.status === 'cancelled') return;

      setSelectedFolder(selection.folderName);
      setAccountName(selection.accountName);
      const report = await window.desktopApi.inspectSelectedBackup();
      setInspection(report);
      setSavedBackups(await window.desktopApi.listArchiveSnapshots());
    } catch {
      setError('The selected folder could not be inspected. Check that it is accessible and try again.');
    } finally {
      setIsChoosingFolder(false);
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
              <div><strong>{inspection.totalDirectories.toLocaleString()}</strong><span>Folders</span></div>
              <div><strong>{inspection.filesByFormat.html.toLocaleString()}</strong><span>HTML</span></div>
              <div><strong>{inspection.filesByFormat.json.toLocaleString()}</strong><span>JSON</span></div>
              <div><strong>{inspection.filesByFormat.media.toLocaleString()}</strong><span>Media files</span></div>
              <div><strong>{inspection.filesByFormat.other.toLocaleString()}</strong><span>Other files</span></div>
            </div>

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
                disabled={isImportingFriends}
              >
                {isImportingFriends ? 'Importing Friends…' : 'Import Friends'}
              </button>
            </div>
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
            {(inspection.skippedSymlinks > 0 || inspection.unreadableDirectories > 0 || inspection.truncated) && (
              <p className="inventory-warning">
                {inspection.skippedSymlinks} symbolic links skipped · {inspection.unreadableDirectories} unreadable folders
                {inspection.truncated ? ' · Inventory reached the safety limit and is incomplete' : ''}
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
                </article>
              ))}
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
            <p>Posts, comments, reactions, groups, and account activity.</p>
            <span className="feature-status">Planned</span>
          </article>
          <article className="feature-card">
            <div className="feature-icon icon-green">⌕</div>
            <h3>Unified search</h3>
            <p>Search locally with filters for people, dates, sections, and media.</p>
            <span className="feature-status">Planned</span>
          </article>
        </section>

        <footer className="page-footer">
          <span>Built for local-first archive exploration.</span>
          <span>No archive upload · No telemetry · No external content fetching</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
