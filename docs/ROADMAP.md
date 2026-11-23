# Roadmap

## Milestone 0 — Foundation

- [x] Confirm Electron + React + TypeScript architecture.
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
- [x] Add one-click sequential import orchestration for the reviewed Friends, Messages, Posts, Comments, and Likes & Reactions importers.
- [x] Report live per-file progress from all five section importers over a narrow IPC event channel.
- [x] Recover file/run markers left in `processing` when the next Import All session starts.
- [ ] Add durable checkpoints, user-controlled pause/resume, and full integrity reporting.
- [x] Add ZIP selection and streaming ZIP entry discovery.
- [x] Read HTML/JSON-sized entries from ZIP archives on demand without extraction.
- [x] Stream ZIP media from the original archive with byte-range support, including deflated entries.

## Milestone 2 — First reliable parsers

- [x] Implement and test the five known Friends HTML file structures.
- [x] Add synthetic, non-personal HTML fixtures for the Friends parser and importer.
- [x] Store Friends records with source-card provenance; keep optional contact details outside FTS5.
- [x] Report missing-name cards and unrecognized Friends page structures.
- [x] Implement and test the observed message HTML structure and local media references.
- [x] Add synthetic fixtures for message cards, reactions, call-event text, and attachments.
- [x] Implement the sampled Posts card parser/importer with local media references and searchable activity browsing.
- [x] Implement the sampled Comments activity-card parser/importer with separate activity, group, body, and raw-date fields.
- [ ] Implement other activity-card sections.
- [x] Implement the observed Likes & Reactions card parser and snapshot-scoped importer.
- [ ] Add parser fixtures for all remaining supported sections.

## Milestone 3 — Media and remaining activity

- [x] Index all discovered image, video, and audio files in one browsable media library, including unlinked media.
- [ ] Structured album and media metadata parsing (captions, dimensions, duration, membership).
- [ ] Groups, events, Marketplace, saved items, and remaining activity sections.

## Milestone 4 — Browsing and search

- [x] Initial conversation list, local filter, and source-order message timeline.
- [x] In-app preview for supported image and sticker attachments (4 MB per-image limit and eight automatic previews per conversation).
- [x] On-demand in-app image/audio/video viewer with native playback controls (24 MB audio/video preview limit).
- [x] Message attachment library with media-kind filters and conversation/sender context (first 300 references).
- [x] Stream audio/video directly from original files with byte-range seeking and snapshot-scoped IDs.
- [x] Unified local full-text search with section filtering across eligible records.
- [ ] Date filters after raw Facebook date formats have safe, evidence-backed parsers.
- [x] Searchable Likes & Reactions activity panel with snapshot-scoped results.
- [ ] Timeline and album browsing.
- [x] Aggregate archive comparison for imported records from two snapshots of the same account.
- [x] Snapshot-scoped Import Diagnostics with severity counts, safe messages, and source-file/card references.
- [x] Per-section Import Coverage separating content processing states from media inventory.
- [x] JSON export of current search results through the native save dialog.
- [ ] Detailed diff browsing and export formats beyond JSON.

## Milestone 5 — Optional local AI

- [ ] Configurable local embeddings and local LLM, disabled by default.
- [ ] Source references for archive-grounded answers.
- [ ] Resource controls and model status.

## Milestone 6 — Windows release

- [x] Add a Windows NSIS installer workflow that runs checks and publishes the installer as a GitHub Actions artifact (workflow configured; release artifact not yet generated).
- [x] Export and restore the local application database with integrity checks and a pre-restore recovery point.
- [ ] Large-archive performance tests and end-to-end database backup/restore validation on Windows.
- [ ] Privacy/security review and final release checklist.
