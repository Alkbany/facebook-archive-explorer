# Facebook Archive Explorer

A local-first Windows desktop application for exploring personal Facebook data exports.

> **Status: foundation scaffold.** The repository is being set up with Electron, React, and TypeScript. This is not yet a finished importer. Directory discovery, parsing, SQLite persistence, and search must be implemented and tested before using the app with a real archive.

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

- Node.js 22.12 or later
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

## Current milestone

The first milestone establishes the desktop shell, secure IPC boundary, starter screen, project documentation, section evidence catalogue, Arabic search normalization, and an initial database schema proposal.

The actual import engine and runtime database integration are not complete yet. Follow [the roadmap](docs/ROADMAP.md) for implementation status.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Privacy and security](docs/PRIVACY-AND-SECURITY.md)
- [Import pipeline](docs/IMPORT-PIPELINE.md)
- [Data model](docs/DATA-MODEL.md)
- [Roadmap](docs/ROADMAP.md)
