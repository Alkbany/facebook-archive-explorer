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
- [ ] Add ZIP selection and streaming ZIP entry discovery.
- [ ] Add symlink-aware canonical path validation at file-open time.
- [x] Add SQLite driver, migration runner, and repositories.
- [ ] Add resumable import state and integrity reporting.

## Milestone 2 — First reliable parsers

- [ ] Implement and test the observed message HTML structure.
- [ ] Implement the observed friends and activity-card structures.
- [ ] Add fixture tests using synthetic, redacted HTML only.
- [ ] Report unsupported and changed structures without silent data loss.

## Milestone 3 — Media and remaining activity

- [ ] Photos, albums, video, audio, stickers, and attachments.
- [ ] Posts, comments, reactions, pages, groups, and events.
- [ ] Remaining sections through independent parser modules.

## Milestone 4 — Browsing and search

- [ ] Unified search with section and date filters.
- [ ] Conversation and media viewers.
- [ ] Timeline and album browsing.
- [ ] Archive comparison and selected-data export.

## Milestone 5 — Optional local AI

- [ ] Configurable local embeddings and local LLM, disabled by default.
- [ ] Source references for archive-grounded answers.
- [ ] Resource controls and model status.

## Milestone 6 — Windows release

- [ ] Installer, database backup/restore, and performance tests.
- [ ] Privacy/security review and release checklist.
