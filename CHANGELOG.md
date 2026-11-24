# Changelog

All notable changes to Facebook Archive Explorer are documented here.

The project uses Semantic Versioning. The `.beta.n` suffix counts repeated candidates for one target version; a new feature milestone advances the minor version (for example, `0.1.0-beta.2` to `0.2.0-beta.1`). The first stable release remains 1.0.0.

## [0.1.0-beta.2] - 2026-11-24

### Changed

- Upgrade the Electron runtime from the unsupported 37.x line to supported Electron 45.4.1.
- Add a dedicated Groups workspace for the three reviewed Accounts Center JSON collections, keeping unknown formats in Other Data.
- Add installer SHA-256 verification output to Windows test artifacts and GitHub Releases.
- Correct the Groups/Other Data navigation so each view filters only its own archive sections.

### Validation

- TypeScript type-check, unit tests, Electron build, Windows NSIS installer build, and packaged-output verification pass in GitHub Actions.
- Windows binaries remain unsigned unless trusted Authenticode credentials are configured. Smart App Control may block files that Microsoft does not recognize.

## [0.1.0-beta.1] - 2026-11-24

### Added

- Redesigned Electron + React desktop workspace with a local-first SQLite database.
- Directory and ZIP archive discovery, safe archive-relative file reading, and source-file provenance.
- Import and browsing support for reviewed Friends, Messages, Posts, Comments, Likes & Reactions, sampled Photos & Videos, and observed Groups TNG JSON collections.
- Other Data browsing for safely preserved content from formats that do not yet have a reviewed section-specific parser.
- Local full-text search, media browsing and streaming, import diagnostics and coverage, snapshot comparison, and application database backup/restore.
- Windows NSIS installer build validation and GitHub pre-release packaging.

### Known limitations

- Events, Marketplace, Saved Items & Collections, and additional Facebook export variants still need evidence-backed parsers and fixtures.
- The importer has not yet passed a complete real-export end-to-end test across every supported Facebook export variant.
- Large-archive performance benchmarks and clean-device Windows install/upgrade/uninstall smoke tests are still required before 1.0.0.
- Windows installers are unsigned unless the repository owner configures a trusted Authenticode certificate. Smart App Control may block an unsigned build that Microsoft does not recognize.

## [0.2.0-beta.1] - Next feature milestone (planned)

- Atomically replace stale source-file records on retry while retaining the last successful records if reading or parsing fails.
- Use identical nested Facebook export path classification for directory and ZIP archives, so reviewed parsers receive the right files from either source.
- Calculate saved-backup counts from current stored files and records instead of summing historical import-run totals.
- Migrate existing generic fallback records to stable parser keys and allow reviewed importers to promote them on a parser update; preserve the attempted parser in the fallback key so unsupported files are not repeatedly reparsed on every Import All run.
- Read MP4/MOV duration metadata from bounded prefixes and suffixes, including files whose movie metadata is stored after the media payload.
- Persist bounded image/video metadata scan state so unsupported media is not repeatedly rechecked and later batches continue across application restarts.
- Replace the fixed 1,000-reference media list with database-side filtering and 50-file pagination; each asset appears once with a stable associated record.
- Read bounded MP4/MOV/M4V suffixes to recover duration metadata when the `moov` atom is stored after the media payload.

## [1.0.0] - Planned stable release

The stable release will be published only after the release gate in docs/ROADMAP.md is complete. Do not treat the beta as a finished product.
