# Facebook Archive Explorer

A local-first Windows desktop application for exploring personal Facebook data exports.

> **Status: active implementation.** The app has a working Electron shell, local SQLite storage, account/backup grouping, directory discovery, Friends, Messages, Likes & Reactions, sampled Posts and Comments importers, unified media inventory, local full-text search, JSON search export, snapshot comparison, and streamed audio/video.

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

## Current capabilities

- Electron desktop shell with a narrow, typed preload API and secure window defaults.
- Native selection of a local export directory and a user-defined account label.
- Bounded, streaming inventory of file/folder names and basic file formats; discovery does not open file contents.
- Independent backup snapshots persisted in SQLite, with a saved-backup history view.
- A symlink-aware archive text reader with path containment and file-size checks.
- DOM parsing for the five known Friends exports: current friends, received requests, sent requests, rejected requests, and removed friends.
- Explicit **Import Friends** action and one-click **Import All Supported Data** workflow, which sequentially runs the reviewed Friends, Messages, Posts, Comments, and Likes & Reactions importers.
- The combined import reports file/record/media/error totals; completed files are skipped on subsequent runs and failed or unsupported files remain eligible for retry.
- The combined import recovers source files left in a `processing` state after an interrupted run and makes them eligible for retry; full crash-safe orchestration and integrity reporting remain planned.
- Contact information from the current friends page is stored separately in the local record payload and is not added to FTS5.
- DOM parsing and explicit **Import Messages** action for discovered conversation HTML in inbox, archived, filtered, and request folders.
- DOM parsing and explicit **Import Posts** action for the sampled `posts/*.html` card structure; raw author labels/dates and local photo/video/audio references are preserved.
- Searchable local Posts and Likes & Reactions activity panels, scoped to the selected backup.
- Conversation browser with conversation filtering, source-order message timeline, raw timestamps, reactions, and local attachment previews.
- A unified media library that indexes all discovered image, video, and audio files across the backup, including files without an imported record association; imported context is shown when available (first 1,000 references shown).
- In-app image and sticker preview plus local streaming audio/video playback with byte-range seeking; images use bounded previews while original media remains in place.
- Message records are marked sensitive and excluded from FTS5 by default.
- Message attachment references are resolved locally and linked only when the file exists in the discovered backup inventory; original media bytes are not copied.
- Arabic-aware unified FTS5 search across indexed Friends, Posts, Comments, and Likes & Reactions, with section filtering and JSON export of search results.
- Snapshot comparison for two backups of the same account, matching section, source-relative path, and original card index and reporting aggregate changes.

## Not implemented yet

- Photos/albums as structured standalone sections, groups, events, Marketplace, saved items, and other export sections. The unified media inventory already lists discovered media files without requiring those parsers.
- JSON import, ZIP discovery/import, resumable large-scale import orchestration, and full integrity reporting.
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

- Friends: five recognized HTML exports.
- Messages: observed conversation HTML, local attachments, and a browsable conversation explorer.
- Posts: sampled post-card HTML with source-provenanced records and verified local media links.
- Comments: sampled comment/reply activity cards with the original activity description, group label, text, and raw date separated.
- Likes & Reactions: observed card structure with raw descriptions and dates preserved; unknown reaction images remain unclassified.
- Media: all discovered image/video/audio paths are indexed, with associated record context where a supported parser has linked them.
- Audio/video: supported local files stream from the selected backup with byte-range seeking.

The Posts and Comments card parsers are based on supplied samples; they still need validation against complete real export files and backups.
