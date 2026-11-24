# Changelog

All notable changes to Facebook Archive Explorer are documented here.

The project uses Semantic Versioning. Beta releases are explicitly marked as pre-releases; the first stable release will be 1.0.0.

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

## [1.0.0] - Planned stable release

The stable release will be published only after the release gate in docs/ROADMAP.md is complete. Do not treat the beta as a finished product.
