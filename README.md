# Facebook Archive Explorer

A local-first Windows desktop application for exploring personal Facebook data exports.

> **Status: early implementation.** The desktop shell, local SQLite database, account/snapshot grouping, and bounded directory inventory are implemented and tested. The application does not yet parse HTML/JSON content or import messages and media.

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

- Node.js 22.13 or later
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

- Electron desktop shell with a secure, narrow preload API.
- Native selection of a local export directory.
- Bounded inventory of file and folder names and basic file extensions; archive contents are not opened during this first pass.
- Symbolic links are skipped, unreadable directories are counted, and very large inventories are marked as truncated.
- A safe relative-path resolver with traversal tests.
- Section evidence catalogue and Arabic-aware search normalization.
- SQLite runtime with versioned migrations, account grouping, independent backup snapshots, and persisted source-file inventory.
- Saved backup history loaded from the local database after startup.

The actual HTML/JSON parsers, ZIP reader, record import pipeline, media viewers, and search UI are not implemented yet. Follow [the roadmap](docs/ROADMAP.md) for implementation status.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Privacy and security](docs/PRIVACY-AND-SECURITY.md)
- [Import pipeline](docs/IMPORT-PIPELINE.md)
- [Data model](docs/DATA-MODEL.md)
- [Roadmap](docs/ROADMAP.md)
