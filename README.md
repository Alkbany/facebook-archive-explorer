# Facebook Archive Explorer

A local-first Windows desktop application for exploring personal Facebook data exports.

> **Status: active implementation.** The app has a working Electron shell, local SQLite storage, account/backup grouping, directory and ZIP discovery, ZIP-backed media streaming, Friends, Messages, Likes & Reactions, sampled Posts and Comments importers, a schema-agnostic JSON fallback importer, unified media inventory, local full-text search, JSON search export, snapshot comparison, and streamed audio/video.

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

Artifacts are retained for 14 days. Builds from `main` are test artifacts and may be unsigned if no signing certificate is configured; Smart App Control can block these builds. They are named `facebook-archive-explorer-windows-test` and are not intended as consumer-ready installers. Version-tag releases require valid Authenticode signatures for all packaged Windows executable binaries before upload. See [Windows code signing](docs/CODE-SIGNING.md) for the certificate setup.

## Current capabilities

- A browsable Friends directory with separate current-friend, received-request, sent-request, rejected-request, and removed-friend filters; name/date/path search; and paginated results. Contact information remains excluded from the directory view and full-text index.
- Detailed snapshot comparisons with record-level before/after values, change-type and section filters, text/path search, pagination, and native CSV or JSON export. CSV output neutralizes spreadsheet formula-leading text.
- A read-only Archive Files browser showing all discovered source paths, formats, import states, record counts, safe diagnostic codes, and file sizes when discovery metadata is available, with section/status filters, search, and pagination. This includes files in unsupported sections.
- A standalone **Import Photos & Videos** action that runs the same reviewed album-index and explicitly linked album-detail importers as Import All; it shares the global import lock and reports progress and diagnostics.
- Functional sidebar navigation to Overview, Friends, Conversations, Photos & Videos, Activity, and Search. Navigation entries no longer advertise implemented modules as “Soon”.

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
- Application startup repairs source files and import runs left in a `processing`/`running` state across every saved backup inside one SQLite savepoint, records safe `IMPORT_INTERRUPTED` diagnostics, and makes affected files eligible for retry from an individual importer or Import All. Each source file is committed atomically, completed files are skipped on retry, and pause/resume waits for the active file transaction to finish. Import Coverage includes consistency checks for records, media references, metadata, and unfinished work.
- Contact information from the current friends page is stored separately in the local record payload and is not added to FTS5.
- DOM parsing and explicit **Import Messages** action for discovered conversation HTML in inbox, archived, filtered, and request folders.
- DOM parsing and explicit **Import Posts** action for the sampled `posts/*.html` card structure; raw author labels/dates and local photo/video/audio references are preserved.
- Searchable local Posts and Likes & Reactions activity panels, scoped to the selected backup.
- Conversation browser with conversation filtering, source-order message timeline, raw timestamps, reactions, and local attachment previews.
- A unified media library that indexes all discovered image, video, and audio files across the backup, including album preview images linked by the imported Photos & Videos index; imported context is shown when available (first 1,000 references shown).
- In-app image and sticker preview plus local streaming audio/video playback with byte-range seeking. This works for directory backups and ZIP backups without extraction; deflated ZIP media is streamed through decompression to satisfy byte ranges.
- Message records are marked sensitive and excluded from FTS5 by default.
- Message attachment references are resolved locally and linked only when the file exists in the discovered backup inventory; original media bytes are not copied.
- Arabic-aware unified FTS5 search across indexed Friends, Posts, Comments, Likes & Reactions, Photos & Videos album summaries, and eligible generic JSON records from non-sensitive sections, with section filtering and JSON export of search results.
- Snapshot comparison for two backups of the same account, matching section, source-relative path, and original card index and reporting aggregate changes.
- Verified local application-database export and restore, using SQLite's online backup API, integrity/foreign-key/schema checks, a pre-restore recovery copy, and interrupted-swap recovery. The database backup contains indexes and imported records, not the original Facebook media.

## Not implemented yet

The following are genuine remaining product tasks; filename discovery alone is not treated as parser support:

- Durable checkpoints inside a single source file; current recovery boundaries are atomic per-file commits, and pause/resume takes effect after the active file finishes.
- Verified field-level parsing for unreviewed HTML and JSON exports; the implemented generic fallbacks preserve bounded text and source provenance but do not interpret every field or relationship.
- Additional activity-card importers beyond the currently supported Friends, Messages, Posts, Comments, Likes & Reactions, and sampled Photos & Videos album pages.
- Video duration is read for MP4/MOV/M4V files when the movie header is present in a bounded 2 MiB prefix; other containers and files with later movie metadata remain unsupported. Sampled album-detail imports link recognized photos to local media assets.
- Verified section-specific importers for Groups, Events, Marketplace, Saved Items, and remaining export sections. Generic fallbacks may preserve visible text but cannot guarantee complete field mapping or relationships without representative export samples and parser fixtures.
- Evidence-backed raw Facebook date parsing and date-range filters; raw date strings are preserved today.
- Optional local embeddings and local LLM integration, disabled by default.
- Large-archive performance benchmarks, complete real-backup end-to-end validation, clean-device Windows install/upgrade/uninstall testing, and final release privacy/security review.
- A trusted Windows signing identity and Smart App Control validation. Test installers may remain unsigned until signing is configured.

The detailed comparison browser and CSV/JSON comparison export are already implemented. The Archive Files browser, Friends directory, Photos & Videos import action, and functional navigation are also implemented; see [the roadmap](docs/ROADMAP.md) for the authoritative checklist.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Privacy and security](docs/PRIVACY-AND-SECURITY.md)
- [Import pipeline](docs/IMPORT-PIPELINE.md)
- [Data model](docs/DATA-MODEL.md)
- [Roadmap](docs/ROADMAP.md)
- [Windows code signing](docs/CODE-SIGNING.md)


## Current import support

ZIP backups can be selected, inventoried, reopened, and read on demand without extracting the original archive. The same reviewed HTML importers are used with ZIP entries and directory files.

- Friends: five recognized HTML exports.
- Messages: observed conversation HTML, local attachments, and a browsable conversation explorer.
- Posts: sampled post-card HTML with source-provenanced records and verified local media links.
- Comments: sampled comment/reply activity cards with the original activity description, group label, text, and raw date separated.
- Likes & Reactions: observed card structure with raw descriptions and dates preserved; unknown reaction images remain unclassified.
- Media: all discovered image/video/audio paths are indexed, with associated record context where a supported parser has linked them.
- Photos & Videos: the root album index is parsed into searchable album summaries. Referenced album pages are parsed into photo cards with local image links, captions, raw photo dates, and comment author/text/raw-date entries. Photos are browsable in-app; image bytes remain in the original backup. Album cards show bounded local cover previews (up to eight visible covers at a time); no image is fetched from the network.
- Audio/video: supported local files stream from directory or ZIP backups with byte-range seeking; deflated ZIP entries are decompressed as a stream when seeking.

The Posts and Comments card parsers are based on supplied samples; they still need validation against complete real export files and backups.


Generic fallback records are browsable in the local **Other data** workspace, grouped by source section and paginated. Sensitive sections can be viewed there but remain excluded from global full-text search.
