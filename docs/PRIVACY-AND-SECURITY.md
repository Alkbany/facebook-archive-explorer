# Privacy and security

## Local-first design

The application has no project server. Archive discovery, parsing, indexing, search, and media browsing are intended to run on the user's device. Do not add analytics, telemetry, remote crash reporting, CDN assets, remote fonts, or automatic external URL fetching.

## Repository contents

The Git repository is for source code and generic documentation only. Never commit user exports, extracted content, personal media, local databases, search indexes, thumbnails, caches, model files, or secrets. A public repository makes source code and documentation visible; it does not expose files that remain on the user's computer.

## File access

- Ask the user to select the source directory or ZIP explicitly.
- Never modify, rename, move, or delete original export files.
- Resolve relative paths against the correct export root and reject path traversal.
- Do not follow symlinks outside the selected archive root.
- Do not scan unrelated folders or fetch external URLs embedded in exports.

## Electron security

- Keep `contextIsolation` enabled.
- Keep `nodeIntegration` disabled.
- Keep the renderer sandbox enabled.
- Validate all IPC arguments in the main process.
- Expose only typed, purpose-specific preload methods.
- Deny unexpected navigation and new windows.
- Serve archive audio/video through a dedicated custom protocol using opaque media IDs, selected-snapshot checks, path validation, MIME allowlists, and HTTP byte-range responses.
- Never expose unrestricted `ipcRenderer`, `fs`, `process`, or database handles to the renderer.

## Sensitive data

Contact details, payment records, precise location, IP addresses, login/session information, message content, and other high-sensitivity records must be classified during import. Sensitive records are excluded from the default global full-text search index. Message content remains outside the global index unless the owner explicitly enables **Include message text in global search** in the app. This preference is independent from Semantic Search and the AI Assistant. When enabled, message text is stored in a separate local FTS5 index; disabling the preference clears that index. Section-scoped Messages search remains available as an on-demand exact scan while the global preference is off; in that mode it does not build or retain a persistent message-text search index. In the implemented Friends importer, optional contact information is stored separately in a local record payload and is not copied into FTS5 title/body fields. Sensitive values must not appear in logs or diagnostics.

AI features must be local-only, optional, configurable, and disabled by default. Semantic embeddings and LLM processing are separate options. Enabling either feature must not upload archive contents or call an external AI service automatically. Model files are downloaded only after explicit user enablement.


## Local application database backups

- Database export uses the SQLite online backup API instead of copying the live database file and its WAL/SHM sidecars.
- Before restore, the selected file is checked for SQLite integrity, foreign-key violations, required archive tables, and a schema version supported by this app.
- A validated copy of the current database is preserved as a local pre-restore recovery file. The app restarts to reopen the restored database, and startup can recover the old file if the swap was interrupted.
- The exported database is a normal, unencrypted SQLite file. The app displays a warning and asks for confirmation before exporting; it may contain personal archive metadata and imported records, so store it somewhere private and do not share it unintentionally.
- Database backups do not include Facebook export folders, ZIP files, or original media bytes. The saved archive references still depend on those original files remaining at their recorded paths.


## Marketplace and saved links

- Marketplace seller and raw listing source fields are retained only in the local record payload for provenance. Seller values are not copied into Marketplace search text or rendered in the listing workspace by the current importer.
- Saved-item and Marketplace external links are retained only when their scheme is HTTP or HTTPS. The application does not fetch or preview these URLs automatically. An explicit click routes the URL through a narrow main-process IPC handler, which validates HTTP/HTTPS and rejects malformed URLs or embedded credentials before opening the operating system's default browser. Arbitrary renderer navigation and new windows remain denied.
- Conversation content, Marketplace messages, saved searches, and unsupported Marketplace/Collections files are not treated as listing records. They remain in generic fallback and follow the applicable sensitivity rules.
