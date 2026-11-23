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
- [ ] Add resumable multi-section import orchestration and full integrity reporting.
- [ ] Add ZIP selection and streaming ZIP entry discovery.

## Milestone 2 — First reliable parsers

- [x] Implement and test the five known Friends HTML file structures.
- [x] Add synthetic, non-personal HTML fixtures for the Friends parser and importer.
- [x] Store Friends records with source-card provenance; keep optional contact details outside FTS5.
- [x] Report missing-name cards and unrecognized Friends page structures.
- [x] Implement and test the observed message HTML structure and local media references.
- [x] Add synthetic fixtures for message cards, reactions, call-event text, and attachments.
- [ ] Implement parsers for posts, comments, reactions, and other activity-card sections.
- [ ] Add parser fixtures for all remaining supported sections.

## Milestone 3 — Media and remaining activity

- [ ] Photos, albums, video, audio, stickers, and attachments as browsable media.
- [ ] Groups, events, Marketplace, saved items, and remaining activity sections.

## Milestone 4 — Browsing and search

- [x] Initial conversation list, local filter, and source-order message timeline.
- [ ] In-app attachment preview/playback and full media viewer.
- [ ] Unified search with section and date filters.
- [ ] Timeline and album browsing.
- [ ] Archive comparison and selected-data export.

## Milestone 5 — Optional local AI

- [ ] Configurable local embeddings and local LLM, disabled by default.
- [ ] Source references for archive-grounded answers.
- [ ] Resource controls and model status.

## Milestone 6 — Windows release

- [ ] Installer, database backup/restore, and performance tests.
- [ ] Privacy/security review and release checklist.
