# Facebook Archive Explorer

A local-first Windows desktop application for exploring personal Facebook data exports.

> **Status: active early implementation.** The app has a working Electron shell, local SQLite storage, account/backup grouping, directory discovery, Friends and Messages importers, and a local conversation browser with bounded in-app media previews. Posts, JSON exports, ZIP archives, and streaming playback for large media are still pending.

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
- Explicit **Import Friends** action that stores records locally, preserves duplicate names and raw dates, and records unsupported structures as issues.
- Contact information from the current friends page is stored separately in the local record payload and is not added to FTS5.
- DOM parsing and explicit **Import Messages** action for discovered conversation HTML in inbox, archived, filtered, and request folders.
- Conversation browser with conversation filtering, source-order message timeline, raw timestamps, reactions, and local attachment previews.
- A message media library with image, sticker, video, and audio filters, linked back to sender and conversation context (first 300 references shown).
- In-app image and sticker preview plus on-demand audio/video playback controls; images are limited to 4 MB and audio/video to 24 MB per preview. Larger media remains untouched in the original backup.
- Message records are marked sensitive and excluded from FTS5 by default.
- Message attachment references are resolved locally and linked only when the file exists in the discovered backup inventory; original media bytes are not copied.
- Arabic-aware search normalization and FTS5 schema are in place.

## Not implemented yet

- Parsers and importers for posts, comments, reactions, photos, videos, groups, and other export sections.
- JSON import, ZIP discovery/import, resumable large-scale import orchestration, and full integrity reporting.
- Full media gallery and streaming playback for large original attachments, unified search UI, archive comparison, and selected-data export.
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
- Messages: observed conversation HTML, local attachments, and a browsable media library.
- Likes & Reactions: observed card structure with raw descriptions and dates preserved; unknown reaction images remain unclassified, with a searchable local activity panel.
- Audio/video attachments stream locally from the selected backup with byte-range seeking.

Posts and Comments import support remains planned; their exact card structures must be validated before implementation.
