# Facebook Archive Explorer

A local-first Windows desktop application for exploring personal Facebook data exports.

> **Status: active implementation.** The app has a working Electron shell, local SQLite storage, account/backup grouping, directory and ZIP discovery, ZIP-backed media streaming, Friends, Messages, Likes & Reactions, sampled Posts and Comments importers, unified media inventory, local full-text search, JSON search export, snapshot comparison, and streamed audio/video.

## Product decisions

- Windows desktop application built with Electron.
- React + TypeScript renderer; Node.js + TypeScript main process.
- SQLite with FTS5 for local metadata and search.
- Multiple Facebook accounts and multiple independent backups per account.
- Original export files are read-only inputs. Media remains in its original location.
- Optional local AI is configurable and disabled by default.
- No project server, cloud API, analytics, telemetry, remote crash reporting, CDN assets, or automatic external URL fetching.

## Repository safety

This repository stores source code and generic documentation only. Never commit Facebook export folders or ZIPs, extracted HTML/JSON, personal photos/videos/audio, local databases, indexes, thumbnails, caches, model files, credentials, or secrets. The root `.gitignore` is a safeguard, not a substitute for reviewing staged files.

## Requirements

- Node.js 22.19 or later
- npm
- Windows 10/11 (initial target)

## Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm test
npm run build
npm run package:win
```

The development dependency installation requires an internet connection. The application is designed to process selected archives locally once installed.

## Windows test installer

The **Windows installer** workflow builds an NSIS installer on `main` and uploads it as the `facebook-archive-explorer-windows` GitHub Actions artifact. Open the latest successful Windows installer run in the repository's Actions tab, download the artifact ZIP, extract it, and run the included `Facebook Archive Explorer Setup` installer.

Artifacts are retained for 14 days. The installer is currently **unsigned** because no code-signing certificate is configured; Windows may display an unknown-publisher or SmartScreen warning. This is a test build, not a public GitHub Release. Public Releases are created only for version tags beginning with `v`.

## Current capabilities

- Electron desktop shell with a narrow, typed preload API and secure window defaults.
- Native selection of a local export directory or ZIP archive and a user-defined account label.
- Bounded, streaming inventory of directory and ZIP central-directory entries; discovery does not open file contents or extract ZIP entries.
- Independent backup snapshots persisted in SQLite, with a complete saved-backup history view (no fixed 20-snapshot limit).
- A symlink-aware archive text reader with path containment and file-size checks for directory and ZIP sources.
- DOM parsing for the five known Friends exports: current friends, received requests, sent requests, rejected requests, and removed friends.
- Explicit **Import Friends** action and one-click **Import All Supported Data** workflow, which sequentially runs Friends, Messages, Posts, Comments, Likes & Reactions, and the sampled Photos & Videos album-index and album-detail importers.
- The combined import reports file/record/media/error totals and live per-file progress for Friends, Messages, Posts, Comments, Likes & Reactions, and Photos & Videos album and photo pages; progress events contain counts and section names only. A main-process lock prevents overlapping imports and backup switching while an import is active. Completed files are skipped on subsequent runs and failed or unsupported files remain eligible for retry.
- Snapshot-scoped Import Diagnostics lists safe error/warning/notices with source-file and card-position references; the latest 250 issues are shown while severity totals cover the full report.
- Per-section Import Coverage separates content files from media inventory and shows completed, unsupported, failed, not processed, empty, and skipped file states. It also labels known HTML imports, sample-based parsers, media-only indexing, and sections with no importer yet.
- Application startup repairs source files and import runs left in a `processing`/`running` state across every saved backup inside one SQLite savepoint, records safe `IMPORT_INTERRUPTED` diagnostics, and makes affected files eligible for retry from an individual importer or Import All. If recovery diagnostics cannot be written, all recovery updates roll back together. Full progress journaling, integrity reporting, and safe resume checkpoints remain planned.
- Contact information from the current friends page is stored separately in the local record payload and is not added to FTS5.
- DOM parsing and explicit **Import Messages** action for discovered conversation HTML in inbox, archived, filtered, and request folders.
- DOM parsing and explicit **Import Posts** action for the sampled `posts/*.html` card structure; raw author labels/dates and local photo/video/audio references are preserved.
- Searchable local Posts and Likes & Reactions activity panels, scoped to the selected backup.
- Conversation browser with conversation filtering, source-order message timeline, raw timestamps, reactions, and local attachment previews.
- A unified media library that indexes all discovered image, video, and audio files across the backup, including album preview images linked by the imported Photos & Videos index; imported context is shown when available (first 1,000 references shown).
- In-app image and sticker preview plus local streaming audio/video playback with byte-range seeking. This works for directory backups and ZIP backups without extraction; deflated ZIP media is streamed through decompression to satisfy byte ranges.
- Message records are marked sensitive and excluded from FTS5 by default.
- Message attachment references are resolved locally and linked only when the file exists in the discovered backup inventory; original media bytes are not copied.
- Arabic-aware unified FTS5 search across indexed Friends, Posts, Comments, Likes & Reactions, and Photos & Videos album summaries, with section filtering and JSON export of search results.
- Snapshot comparison for two backups of the same account, matching section, source-relative path, and original card index and reporting aggregate changes.
- Verified local application-database export and restore, using SQLite's online backup API, integrity/foreign-key/schema checks, a pre-restore recovery copy, and interrupted-swap recovery. The database backup contains indexes and imported records, not the original Facebook media.

## Not implemented yet

- Photo dimensions, additional per-photo metadata, Groups, events, Marketplace, saved items, and other export sections remain unsupported.
- JSON-backed section import, resumable large-scale import orchestration with durable checkpoints, and full integrity reporting.
- Advanced raw-date filters, detailed record-level comparison views, and export formats beyond JSON.
- Optional local embeddings and local LLM integration.

Follow [the roadmap](docs/ROADMAP.md) for implementation status.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Privacy and security](docs/PRIVACY-AND-SECURITY.md)
- [Import pipeline](docs/IMPORT-PIPELINE.md)
- [Data model](docs/DATA-MODEL.md)
- [Roadmap](docs/ROADMAP.md)


## Current import support

ZIP backups can be selected, inventoried, reopened, and read on demand without extracting the original archive. The same reviewed HTML importers are used with ZIP entries and directory files.

- Friends: five recognized HTML exports.
- Messages: observed conversation HTML, local attachments, and a browsable conversation explorer.
- Posts: sampled post-card HTML with source-provenanced records and verified local media links.
- Comments: sampled comment/reply activity cards with the original activity description, group label, text, and raw date separated.
- Likes & Reactions: observed card structure with raw descriptions and dates preserved; unknown reaction images remain unclassified.
- Media: all discovered image/video/audio paths are indexed, with associated record context where a supported parser has linked them.
- Photos & Videos: the root album index is parsed into searchable album summaries. Referenced album pages are parsed into photo cards with local image links, captions, raw photo dates, and comment author/text/raw-date entries. Photos are browsable in-app; image bytes remain in the original backup.
- Audio/video: supported local files stream from directory or ZIP backups with byte-range seeking; deflated ZIP entries are decompressed as a stream when seeking.

The Posts and Comments card parsers are based on supplied samples; they still need validation against complete real export files and backups.
