import { useEffect, useState } from 'react';

function App() {
  const [version, setVersion] = useState('0.1.0');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.desktopApi.getAppInfo()
      .then((info) => setVersion(info.appVersion))
      .catch(() => setError('Could not read application information.'));
  }, []);

  async function chooseFolder() {
    setIsChoosingFolder(true);
    setError(null);

    try {
      const result = await window.desktopApi.selectBackupDirectory();
      if (result.status === 'selected') setSelectedFolder(result.absolutePath);
    } catch {
      setError('The folder picker could not be opened. Please try again.');
    } finally {
      setIsChoosingFolder(false);
    }
  }

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
              Choose the Facebook export folder on your computer. The import workflow
              will inspect its structure before reading any records.
            </p>
            <button className="primary-button" onClick={chooseFolder} disabled={isChoosingFolder}>
              <span className="button-icon">＋</span>
              {isChoosingFolder ? 'Opening folder picker…' : 'Choose backup folder'}
            </button>

            {selectedFolder && (
              <div className="selected-folder">
                <span className="selected-folder-icon">✓</span>
                <div>
                  <strong>Folder selected</strong>
                  <span>{selectedFolder}</span>
                </div>
              </div>
            )}
            {error && <p className="error-message">{error}</p>}
            <p className="helper-text">Your original export is not moved or modified.</p>
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
