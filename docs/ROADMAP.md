# Roadmap

> **Current integration baseline:** the reviewed beta implementation has been merged into `main`. This checklist describes the code now present on `main`; completed parser items mean reviewed implementation plus automated fixtures, not validation against every real Facebook export variant.

> **Versioning:** `v0.1.0-beta.1` and `v0.1.0-beta.2` are candidates for the same `0.1.0` milestone. The next feature milestone begins at `v0.2.0-beta.1`; later feature milestones advance the minor number. `.beta.n` counts repeated candidates for one target version. `v1.0.0` remains gated on the stable-release checklist.

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
- [x] Add a cross-section Import All integration test that runs the reviewed Events, Marketplace, and Saved Items JSON importers together and verifies stored records plus completed source-file states.
- [x] Report live per-file progress from all supported section importers over a narrow IPC event channel.
- [x] Serialize import requests and prevent backup switching while an import is active.
- [x] Recover interrupted section imports and Import All runs across all snapshots during application startup, with safe Diagnostics and an atomic SQLite savepoint.
- [x] Persist each source-file result atomically so completed files are durable checkpoints and interrupted files can be retried safely.
- [x] Tag generic JSON/HTML/text fallback results and migrate existing fallback records so future reviewed parsers can promote them once without repeatedly retrying unsupported layouts.
- [x] Replace a source file's previous records atomically on retry, removing obsolete full-text search rows and media links while retaining the last successful data when a retry fails.
- [x] Keep per-file record counts and saved-backup summary totals aligned with the records currently stored, not historical import attempts.
- [x] Add user-controlled pause/resume at file boundaries without interrupting an active file transaction.
- [x] Add archive integrity reporting for record-count mismatches, cross-snapshot records/media links, missing media sources, invalid media metadata, and unfinished import markers.
- [x] Add ZIP selection and streaming ZIP entry discovery.
- [x] Read HTML/JSON-sized entries from ZIP archives on demand without extraction.
- [x] Stream ZIP media from the original archive with byte-range support, including deflated entries.
- [x] Share the same nested Facebook export section-path classifier between directory and ZIP discovery.

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
- [x] Deduplicate linked message attachments by archive-relative path and retain the media type from the actual image/audio/video element instead of the enclosing link.
- [x] Implement the sampled Posts card parser/importer with local media references and searchable activity browsing.
- [x] Parse the observed TNG `your_posts__check_ins__photos_and_videos` timeline JSON chunks into the Posts workspace and link only discovered local post media.
- [x] Implement the sampled Comments activity-card parser/importer with separate activity, group, body, and raw-date fields.
- [ ] Implement additional activity-card sections beyond the reviewed Posts, Comments, and Likes & Reactions structures.
- [x] Implement the observed Likes & Reactions card parser and snapshot-scoped importer.
- [x] Add a schema-agnostic JSON fallback importer that preserves source values, safely extracts text, and keeps unreviewed sections out of full-text search.
- [x] Add a bounded generic HTML fallback for unreviewed sections, preserving visible text and source provenance while keeping sensitive sections out of full-text search.
- [x] Add a dedicated Groups workspace for the three reviewed TNG activity collections, with group/author fields shown only where present in the observed source objects. Keep it isolated from the generic Other Data section selector.
- [x] Add a paginated Other Data workspace for browsing preserved HTML/JSON/text records by section, with source provenance and sensitivity labels.
- [x] Add a bounded plain-text fallback for discovered `.txt` files, preserving original text while limiting full-text indexing and respecting section sensitivity.
- [ ] Add schema-specific JSON importers and parser fixtures for additional Marketplace listing formats, collections beyond saves_v2, additional Groups/Pages formats, and remaining sections.

## Milestone 3 — Media and remaining activity

- [x] Index all discovered image, video, and audio files in one browsable media library, including unlinked media.
- [x] Parse sampled album captions, photo dates, and comment authors/text/dates.
- [x] Read image dimensions from PNG, JPEG, GIF, and WebP headers using bounded 256 KiB prefix reads in batches of 50 when the media gallery opens; large image files are not loaded in full.
- [x] Persist image/video metadata scan attempts in SQLite so invalid or unsupported files do not block later batches across application restarts.
- [x] Read MP4/MOV/M4V duration from bounded 2 MiB prefixes and suffixes (up to 10 unscanned videos per gallery opening); this handles fast-start and common end-positioned `moov` metadata without loading whole videos.
- [x] Paginate the unified media gallery in SQLite (target: 100 distinct files by default, with selectable 50/100/250 page sizes and Grid/List views), with media-kind filtering and literal file-name/archive-path search performed in the database rather than loading a fixed first 1,000 results into React.
- [x] Link photos parsed from supported album-detail pages to local media assets; unsupported album layouts remain unlinked.
- [x] Import TNG `posts/album/{id}.json` files into the existing album browser with local cover/photo links and preserved raw metadata.
- [x] Events: reviewed TNG JSON variants for responses (`event_responses_v2`), invitations (`events_invited_v2`), and hosted event lists (`your_events_v2` / label-value event blocks), with RSVP preservation, duplicate merging, source provenance, and fallback for unknown shapes.
- [x] Marketplace listing support: import `items_selling_v2` from `items_sold.json` and join `your_marketplace_items.json` label/value details by normalized title + UTC creation time. Unknown Marketplace files and conversation/search-history formats remain generic fallback.
- [x] Fill missing Marketplace description fields from the matched label/value details record when the primary listing record omits them; preserve the combined source provenance and keep seller data out of the rendered/searchable listing fields.
- [x] Saved Items support: import `saves_v2` from `your_saved_items.json`, preserving external-context names, source domains, and validated HTTP(S) links. Other collection formats remain generic fallback.
- [ ] Expand coverage for additional Marketplace listing variants, Saved Items collections beyond `saves_v2`, and additional Groups export formats. The observed Groups TNG collections (`group_posts_v2`, `group_comments_v2`, `groups_joined_v2`) already have a reviewed importer.

## Milestone 4 — Browsing and search

- [x] Conversation list, local filter, and source-order message timeline with 50-message database pagination, bounded per-page attachment previews, and stale-request protection when switching conversations or backups.
- [x] Paginated Friends directory with category filters, name/date/path search, and functional workspace navigation.
- [x] Read-only Archive Files browser with status/section filters, path and error-code search, and pagination.
- [x] Standalone Photos & Videos import action reusing the album-index and referenced album-detail import pipeline.
- [x] In-app preview for supported image and sticker attachments (4 MB per-image limit and eight automatic previews per conversation).
- [x] On-demand in-app image/audio/video viewer with native playback controls (24 MB audio/video preview limit).
- [x] Message attachment library with media-kind filters and conversation/sender context (first 300 references).
- [x] Stream audio/video directly from original files with byte-range seeking and snapshot-scoped IDs.
- [x] Exact Search: FTS5 literal-term and quoted-phrase search, Arabic-aware normalization, section filters, exact metadata/path search, and JSON export.
- [x] Exact metadata search for archive paths, file names, and raw/normalized dates where the source date is reliable.
- [x] Fuzzy Search (no LLM): local token-vocabulary candidate lookup and Damerau-style distance scoring for missing, extra, substituted, and adjacent-transposed characters, with adjustable similarity threshold and per-result match labels.
- [x] Message global-search privacy control: an independent opt-in setting, off by default, with a separate local FTS5 index; disabling it clears message text from that index. Section-scoped Messages search remains available as an on-demand exact scan.
- [x] Unified Search UI exposes Exact, Fuzzy, and optional Semantic Search distinctly, with source file/card provenance, match labels, and 250-result offset pagination for large result sets.
- [x] Bound Semantic Search result ranking to the requested page window with deterministic record-ID tie-breaking, avoiding repeated sorted-array insertion for large indexed snapshots.
- [x] Apply inclusive UTC calendar-date filters in Exact, Fuzzy, and Semantic Search; exclude records without a reliable normalized `event_time_utc` while a date filter is active.
- [ ] Broader Search quality and performance validation against large, complete Arabic/English Facebook exports, including false-positive analysis and date-format edge cases.
- [x] Store normalized UTC event timestamps for unambiguous Unix seconds/milliseconds and timezone-qualified ISO values in Posts, Comments, and Likes & Reactions imports; retain raw source values unchanged.
- [x] Add date-range controls to Posts, Comments, and Likes & Reactions using stored normalized UTC timestamps. Records with only raw/localized date strings are excluded while a date range is active rather than assigned a guessed timezone.
- [x] Normalize the observed Arabic D/M/YYYY 12-hour HTML dates in Posts, Comments, Likes & Reactions, and Messages only when the same file's Facebook footer explicitly supplies a valid UTC offset; preserve raw dates and leave unsupported/missing-offset values unnormalized.
- [ ] Validate and expand additional localized HTML date formats, offsets, and historical daylight-saving semantics only when the source export supplies sufficient evidence.
- [x] Searchable Likes & Reactions activity panel with snapshot-scoped results.
- [x] Sampled Photos & Videos root album index import, searchable album summaries, and cover-image association.
- [x] Sampled album-detail parsing, photo captions/dates, comment records, and local photo browsing.
- [x] Aggregate archive comparison for imported records from two snapshots of the same account.
- [x] Snapshot-scoped Import Diagnostics with severity counts, safe messages, and source-file/card references.
- [x] Per-section Import Coverage separating content processing states from media inventory.
- [x] Show parser capability separately from file processing status.
- [x] JSON export of current search results through the native save dialog.
- [x] Detailed diff browsing with before/after values, filters, pagination, and CSV/JSON export.
- [x] Open saved-item and event source links only on explicit user action through validated main-process HTTP/HTTPS handling; keep arbitrary renderer navigation and new windows blocked.

## Milestone 5 — Optional local AI

- [x] **Semantic Search foundation:** local multilingual `Xenova/multilingual-e5-small` feature-extraction runtime, persisted 384-dimensional vectors, and a separate semantic retrieval mode.
- [x] Generate embeddings incrementally between Import All sections and after individual section imports, in bounded batches that do not fail the archive import.
- [x] Backfill eligible existing records when Semantic Search is enabled later; no archive re-import is required.
- [x] Persist model-versioned jobs and vectors in SQLite; reset interrupted processing jobs on restart and allow failed jobs to be retried.
- [x] Show model download/loading/indexing state and progress; Semantic Search is disabled by default and starts downloading only after explicit enablement.
- [ ] Validate actual model download, inference, Arabic/English semantic relevance, storage usage, and performance on a clean Windows device with a representative archive.
- [x] **AI Assistant foundation:** separate opt-in local Qwen2.5-0.5B-Instruct runtime, independent from Semantic Search.
- [x] Retrieve local archive evidence, answer through a bounded local conversation context, and validate citation IDs before exposing navigable source cards.
- [x] Exclude sensitive message content unless the independent message-search setting is enabled; no archive text is sent to a cloud inference provider.
- [ ] Validate real model inference, Arabic response quality, citation completeness, and grounding against adversarial/instruction-like text inside archived content. The small model may be less reliable than larger local models.
- [x] Combine bounded lexical BM25 and optional semantic retrieval rankings with reciprocal-rank fusion, deduplicating records and assigning citation IDs only after final ranking.
- [ ] Add multi-snapshot/compare queries and stronger claim-to-citation coverage validation for the AI Assistant.
- [ ] AI failure or disabled models must never disable archive browsing, Exact Search, or Fuzzy Search.



## Milestone 6 — Windows release

- [x] Build and publish a clearly labelled unsigned personal-use Windows NSIS test installer from `main` after type-checking and unit tests; signing is not required for personal testing, but Smart App Control may block unrecognised unsigned binaries.
- [x] Configure pull-request validation to build and upload a Windows NSIS test installer before beta changes can be merged.
- [x] Verify SQLite database backup/restore and interrupted-import recovery tests on Windows CI.
- [x] Export and restore the local application database with integrity checks and a pre-restore recovery point.
- [x] Add a repeatable 50,000-record synthetic SQLite/FTS benchmark for Exact and Fuzzy Search; report observed timings without hardware-independent pass/fail speed thresholds.
- [ ] Benchmark full real directory and ZIP backups, including import, media indexing/streaming, search, and recovery; complete an end-to-end pass with a real Facebook Backup. Synthetic search benchmarks and unit/build checks do not replace this validation.
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
