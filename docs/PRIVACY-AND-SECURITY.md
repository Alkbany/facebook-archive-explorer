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
- Never expose unrestricted `ipcRenderer`, `fs`, `process`, or database handles to the renderer.

## Sensitive data

Contact details, payment records, precise location, IP addresses, login/session information, and other high-sensitivity records must be classified during import. Sensitive records are excluded from the default full-text search index. In the implemented Friends importer, optional contact information is stored only in a separate local record payload and is not copied into FTS5 title/body fields. Sensitive values must not appear in logs or diagnostics.

AI features must be local-only, optional, configurable, and disabled by default.
