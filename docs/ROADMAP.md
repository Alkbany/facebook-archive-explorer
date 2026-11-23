# Roadmap

## Milestone 0 — Foundation

- [x] Confirm Electron + React + TypeScript architecture.
- [x] Define local-first privacy and repository safety rules.
- [ ] Build and verify the desktop shell.
- [ ] Add the section evidence catalogue and Arabic search normalization.
- [ ] Add the initial SQLite schema and migration runner.

## Milestone 1 — Storage and discovery

- [ ] Select a directory or ZIP.
- [ ] Inventory every file without modifying the source.
- [ ] Implement safe path resolution and ZIP entry validation.
- [ ] Add SQLite driver, migrations, and repositories.
- [ ] Add resumable import state and integrity reporting.

## Milestone 2 — First reliable parsers

- [ ] Implement and test observed message HTML structure.
- [ ] Implement observed friends and activity-card structures.
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
