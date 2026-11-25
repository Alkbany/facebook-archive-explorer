# Changelog

## Unreleased

### Changed

- Run the main type-check, unit-test, and Electron build workflow on Windows instead of Ubuntu to match the Windows-only desktop product target.

### Added

- Add a Windows CI lifecycle smoke test that silently installs the generated NSIS package, starts the installed application, and silently uninstalls it.
- Add a prompt/data-boundary regression test proving instruction-like Facebook archive text remains untrusted evidence in the local AI Assistant context.
- Add AI Assistant comparison mode for two backups of the same account, with independent retrieval and source citations labelled by snapshot.
- Add service-level integration coverage for cross-snapshot retrieval, backup provenance, prompt scope, and citation validation without requiring a model download.
- Require complete sentence-level citation coverage for AI Assistant answers; withhold a generated response if any statement lacks a valid source ID.
- Add regression coverage proving Exact and Fuzzy Search remain available whether the optional AI Assistant is enabled or disabled.
- Paginate and filter the Messenger conversation directory in SQLite, returning 50 conversation summaries per page with a matching total instead of loading the entire directory into the renderer.
- Add paginated all-word, complete-token search inside the selected Messenger conversation using a short-lived in-memory FTS5 index that is cleared after each query and never populates the global message-search index.
- Rank AI Assistant evidence with reciprocal-rank fusion across lexical BM25 and optional semantic results; matching records receive combined rank contributions, with deterministic record-ID tie-breaking and lexical fallback.
- Optimize Semantic Search top-result selection with a bounded heap and stable tie-breaking; add regression coverage for 300 ranked records across non-overlapping pages and invalid offsets.
- Add 250-result previous/next pagination for Exact, Fuzzy, and Semantic Search; page-aware JSON export now exports the currently displayed page.
- Load Messenger conversations in ordered 50-message database pages, batch attachment lookup for each page, and keep image/sticker previews bounded per page.
- Normalize the observed Arabic Facebook HTML date format for Posts, Comments, Likes & Reactions, and Messenger only when the same export footer provides a valid explicit UTC offset; preserve the raw date and fail closed for unsupported formats or missing offsets.
- Add a cross-section Import All regression fixture for Events, Marketplace, and Saved Items, verifying their SQLite records and source-file completion states in one snapshot.
- Add a repeatable 50,000-record synthetic Exact/Fuzzy Search benchmark that records lookup timings without machine-dependent speed thresholds.

### Fixed

- Block cross-origin renderer redirects and deny all browser permission requests/checks by default because the archive explorer does not require browser device permissions.
- Prevent packaged applications from loading an environment-configured renderer URL with the privileged preload; allow the override only for loopback HTTP in unpackaged development.
- Mark an empty local AI response as an assistant error instead of leaving the UI in a misleading ready state; add regression coverage for status and continued archive search.
- Allow the local `archive-media:` protocol in the renderer Content Security Policy for audio/video playback without widening script, image, or connection sources.
- Isolate optional AI Assistant model loading and inference failures from archive browsing and Exact/Fuzzy Search; expose distinct load/inference error states and cover both with fault-injection regression tests.
- Ignore stale asynchronous message-page responses after a different conversation or backup is selected, preventing an older request from replacing the current timeline.
- Deduplicate linked Messenger attachments by archive-relative path and preserve media type from the actual image/audio/video element; add regression coverage for linked photos and MP4 audio.
- Preserve a Marketplace description supplied by the matched label/value details file when the primary `items_selling_v2` record has no description; add a regression test and document the seller-data privacy boundary.
- Make saved-item and event links functional through validated, user-initiated HTTP/HTTPS opening in the system browser; reject unsafe URL schemes and embedded credentials.
- Use one credential-safe HTTP(S) URL validator for Events and Saved Items at import and read time, including existing local records; reject embedded credentials and oversized links.
- Normalize reviewed Groups activity timestamps to UTC only when the shared date parser can interpret them unambiguously; preserve raw values and avoid timezone guesses.


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
- Add literal file-name/archive-path search to the paginated media library; search and media-kind filters are applied in SQLite before page selection.

## [1.0.0] - Planned stable release

The stable release will be published only after the release gate in docs/ROADMAP.md is complete. Do not treat the beta as a finished product.
