# Roadmap

> **Current integration baseline:** the reviewed beta implementation has been merged into `main`. This checklist describes the code now present on `main`; completed parser items mean reviewed implementation plus automated fixtures, not validation against every real Facebook export variant.

## Milestone 0 — Foundation

- [x] Confirm Electron + React + TypeScript architecture.
- [x] Upgrade the app runtime from end-of-life Electron 37 to supported Electron 45.4.1; CI verifies the sandboxed preload, tests, renderer/main build, and Windows installer.
- [x] Define local-first privacy and repository safety rules.
- [x] Build the desktop shell and verify its production build in CI.
- [x] Add the section evidence catalogue and Arabic search normalization.
- [x] Add the SQLite runtime, versioned migrations, and initial FTS5 schema.
- [x] Add a safe archive-relative path resolver and unit tests.

## Milestone 1 — Storage and discovery

- [x] Select a local export directory through the native folder picker.
- [x] Inventory filenames and basic file formats without opening file contents.
- [x] Persist account labels, independent backup snapshots, discovery runs, and source-file metadata.
- [x] Show saved backup inventories from the local database.
- [x] Validate each file-open path component and reject symbolic links.
- [x] Add SQLite driver, migration runner, and repositories.
- [x] Add one-click sequential import orchestration for the reviewed Friends, Messages, Posts, Comments, Likes & Reactions, and sampled Photos & Videos importers.
- [x] Report live per-file progress from all supported section importers over a narrow IPC event channel.
- [x] Serialize import requests and prevent backup switching while an import is active.
- [x] Recover interrupted section imports and Import All runs across all snapshots during application startup, with safe Diagnostics and an atomic SQLite savepoint.
- [x] Persist each source-file result atomically so completed files are durable checkpoints and interrupted files can be retried safely.
- [x] Add user-controlled pause/resume at file boundaries without interrupting an active file transaction.
- [x] Add archive integrity reporting for record-count mismatches, cross-snapshot records/media links, missing media sources, invalid media metadata, and unfinished import markers.
- [x] Add ZIP selection and streaming ZIP entry discovery.
- [x] Read HTML/JSON-sized entries from ZIP archives on demand without extraction.
- [x] Stream ZIP media from the original archive with byte-range support, including deflated entries.

## Milestone 2 — First reliable parsers

- [x] Implement and test the five known Friends HTML file structures.
- [x] Classify the current nested Accounts Center directory layout into the app's archive sections.
- [x] Parse the observed TNG `connections/friends/your_friends.json` `friends_v2` collection into the searchable Friends directory while keeping raw contact fields out of search.
- [x] Parse the observed TNG Groups `group_posts_v2`, `group_comments_v2`, and `groups_joined_v2` collections into the local Groups workspace, preserving the original JSON payload.
- [x] Add synthetic, non-personal HTML fixtures for the Friends parser and importer.
- [x] Store Friends records with source-card provenance; keep optional contact details outside FTS5.
- [x] Report missing-name cards and unrecognized Friends page structures.
- [x] Implement and test the observed message HTML structure and local media references.
- [x] Parse the observed Accounts Center Messenger `message_*.json` chunks and link only local photo/sticker media without enabling global message search.
- [x] Add synthetic fixtures for message cards, reactions, call-event text, and attachments.
- [x] Implement the sampled Posts card parser/importer with local media references and searchable activity browsing.
- [x] Parse the observed TNG `your_posts__check_ins__photos_and_videos` timeline JSON chunks into the Posts workspace and link only discovered local post media.
- [x] Implement the sampled Comments activity-card parser/importer with separate activity, group, body, and raw-date fields.
- [ ] Implement additional activity-card sections beyond the reviewed Posts, Comments, and Likes & Reactions structures.
- [x] Implement the observed Likes & Reactions card parser and snapshot-scoped importer.
- [x] Add a schema-agnostic JSON fallback importer that preserves source values, safely extracts text, and keeps unreviewed sections out of full-text search.
- [x] Add a bounded generic HTML fallback for unreviewed sections, preserving visible text and source provenance while keeping sensitive sections out of full-text search.
- [x] Add a dedicated Groups workspace for the three reviewed TNG activity collections, with group/author fields shown only where present in the observed source objects. Keep it isolated from the generic Other Data section selector.\n- [x] Add a paginated Other Data workspace for browsing preserved HTML/JSON/text records by section, with source provenance and sensitivity labels.
- [x] Add a bounded plain-text fallback for discovered `.txt` files, preserving original text while limiting full-text indexing and respecting section sensitivity.
- [ ] Add schema-specific JSON importers and parser fixtures for Events, Marketplace, Saved Items & Collections, additional Groups/Pages formats, and remaining sections.

## Milestone 3 — Media and remaining activity

- [x] Index all discovered image, video, and audio files in one browsable media library, including unlinked media.
- [x] Parse sampled album captions, photo dates, and comment authors/text/dates.
- [x] Read image dimensions from PNG, JPEG, GIF, and WebP headers using bounded 256 KiB prefix reads in batches of 50 when the media gallery opens; large image files are not loaded in full.
- [x] Read MP4/MOV/M4V duration from movie headers using bounded 2 MiB prefixes (up to 10 unscanned videos per gallery opening; other containers or later movie metadata remain unavailable).
- [x] Link photos parsed from supported album-detail pages to local media assets; unsupported album layouts remain unlinked.
- [x] Import TNG `posts/album/{id}.json` files into the existing album browser with local cover/photo links and preserved raw metadata.
- [ ] Events, Marketplace, Saved Items & Collections, additional Groups export formats, and remaining activity sections. The observed Groups TNG collections (`group_posts_v2`, `group_comments_v2`, `groups_joined_v2`) already have a reviewed importer.

## Milestone 4 — Browsing and search

- [x] Initial conversation list, local filter, and source-order message timeline.
- [x] Paginated Friends directory with category filters, name/date/path search, and functional workspace navigation.
- [x] Read-only Archive Files browser with status/section filters, path and error-code search, and pagination.
- [x] Standalone Photos & Videos import action reusing the album-index and referenced album-detail import pipeline.
- [x] In-app preview for supported image and sticker attachments (4 MB per-image limit and eight automatic previews per conversation).
- [x] On-demand in-app image/audio/video viewer with native playback controls (24 MB audio/video preview limit).
- [x] Message attachment library with media-kind filters and conversation/sender context (first 300 references).
- [x] Stream audio/video directly from original files with byte-range seeking and snapshot-scoped IDs.
- [x] Unified local full-text search with section filtering across eligible records.
- [x] Store normalized UTC event timestamps for unambiguous Unix seconds/milliseconds and timezone-qualified ISO values in Posts, Comments, and Likes & Reactions imports; retain raw source values unchanged.
- [x] Add date-range controls to Posts, Comments, and Likes & Reactions using stored normalized UTC timestamps. Records with only raw/localized date strings are excluded while a date range is active rather than assigned a guessed timezone.
- [ ] Add evidence-backed timezone handling for localized Facebook HTML dates where the export supplies enough context; then extend date-range filters to those records and other relevant workspaces.
- [x] Searchable Likes & Reactions activity panel with snapshot-scoped results.
- [x] Sampled Photos & Videos root album index import, searchable album summaries, and cover-image association.
- [x] Sampled album-detail parsing, photo captions/dates, comment records, and local photo browsing.
- [x] Aggregate archive comparison for imported records from two snapshots of the same account.
- [x] Snapshot-scoped Import Diagnostics with severity counts, safe messages, and source-file/card references.
- [x] Per-section Import Coverage separating content processing states from media inventory.
- [x] Show parser capability separately from file processing status.
- [x] JSON export of current search results through the native save dialog.
- [x] Detailed diff browsing with before/after values, filters, pagination, and CSV/JSON export.

## Milestone 5 — Optional local AI

- [ ] Configurable local embeddings and local LLM, disabled by default.
- [ ] Source references for archive-grounded answers.
- [ ] Resource controls and model status.

## Milestone 6 — Windows release

- [x] Build and publish a clearly labelled unsigned personal-use Windows NSIS test installer from `main` after type-checking and unit tests; signing is not required for personal testing, but Smart App Control may block unrecognised unsigned binaries.
- [x] Configure pull-request validation to build and upload a Windows NSIS test installer before beta changes can be merged.
- [x] Verify SQLite database backup/restore and interrupted-import recovery tests on Windows CI.
- [x] Export and restore the local application database with integrity checks and a pre-restore recovery point.
- [ ] Large-archive performance benchmarks and end-to-end testing with a complete real Facebook Backup; automated unit/build checks do not replace this validation.
- [ ] Manual install, launch, upgrade, and uninstall smoke tests on a clean Windows device.
- [x] Support optional trusted Authenticode signing and verify all packaged Windows executable binaries when signing credentials are configured; publish clearly labelled unsigned personal-use builds and beta releases otherwise.
- [ ] (Only if public distribution is planned) Configure a trusted signing identity and complete code-signing provider onboarding. Personal-use builds do not require a paid certificate, but unsigned binaries may be blocked by Smart App Control.
- [ ] (Only if public distribution is planned) Verify signed release behavior on a clean Windows 11 device.
- [x] Attach a Windows installer SHA-256 verification record to main-branch test artifacts and versioned GitHub Releases.
- [x] Publish early-access pre-releases [v0.1.0-beta.1](https://github.com/Alkbany/facebook-archive-explorer/releases/tag/v0.1.0-beta.1) and [v0.1.0-beta.2](https://github.com/Alkbany/facebook-archive-explorer/releases/tag/v0.1.0-beta.2); reserve v1.0.0 for the stable release gate.
- [ ] Final privacy/security review and release checklist.

## Stable 1.0.0 release gate

The beta release is not the product's completion point. Do not tag v1.0.0 until the supported archive scope has passed the complete real-export end-to-end test, the large-archive and recovery checks, clean Windows install/upgrade/uninstall smoke tests, and the final privacy/security checklist. Features that have not been verified against an actual export structure must remain explicitly unsupported rather than being advertised as complete.

## Next implementation order

1. **Parser coverage:** inspect each remaining section's actual export files, add a section-specific parser only when its structure is evidenced, and add non-personal fixtures for every supported variant.
2. **Activity and date handling:** extend activity-card coverage, then normalize observed Facebook date formats and add date filters without guessing ambiguous dates.
3. **Media completeness:** broaden album-layout recognition and safely improve metadata coverage while retaining bounded reads and original-file references.
4. **Reliability at scale:** benchmark large directory and ZIP backups, test retries/recovery, and run a complete real-backup end-to-end pass.
5. **Windows release readiness:** complete clean-device install/upgrade/uninstall checks, validate optional Authenticode signing on a trusted Windows 11 device, review privacy/security, and finish the 1.0.0 release checklist.

**Evidence rule:** when a section's export structure has not been inspected, keep it clearly marked as fallback/unsupported. Do not promote filename discovery or generic text preservation to verified parser support. Ask for a representative export sample only when implementation of that exact section requires it; never commit personal export data or fixtures derived from it.
