# Facebook Archive Explorer

A local-first Windows desktop application for exploring personal Facebook data exports.

> **Status: active implementation on `main`.** The main branch includes the redesigned Electron/React desktop workspace, local SQLite storage, account/backup grouping, legacy and current nested Accounts Center directory classification, directory and ZIP discovery, ZIP-backed media streaming, reviewed Friends HTML + TNG JSON, Messages legacy HTML + TNG JSON, Likes & Reactions HTML, sampled Posts HTML + TNG timeline JSON, Comments HTML + TNG JSON, and Groups TNG JSON importers with a dedicated Groups workspace. It also includes bounded HTML/JSON/plain-text fallbacks (UTF-8 and BOM-marked UTF-16), the Other Data browser, unified media inventory, four-level local search (Exact, Fuzzy, optional Semantic Search, and a separate optional evidence-grounded AI Assistant), snapshot comparison, import diagnostics/coverage, database backup/restore, and streamed audio/video.

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

## Windows builds and release versions

The project uses Semantic Versioning with separate beta and stable channels:

- **Beta:** [`v0.1.0-beta.1`](https://github.com/Alkbany/facebook-archive-explorer/releases/tag/v0.1.0-beta.1) is the first early-access release. [`v0.1.0-beta.2`](https://github.com/Alkbany/facebook-archive-explorer/releases/tag/v0.1.0-beta.2) adds the Electron 45 security update and the dedicated Groups workspace. The next feature milestone starts at `v0.2.0-beta.1`; later feature milestones advance the minor number (`v0.3.0-beta.1`, `v0.4.0-beta.1`, and so on). The `.beta.n` suffix increments only for repeated candidates of the same target version.
- **Stable:** `v1.0.0` remains the first stable release and will be published only after the real-export, large-archive, clean-Windows, and privacy/security release checklist is complete. Before 1.0, compatible feature milestones advance the minor version, compatible fixes advance the patch version, and breaking changes advance the major version.

The Windows workflow supports optional Authenticode signing. Without a trusted signing certificate, the main-branch test installer and beta releases are unsigned; the release page clearly identifies that status. **Smart App Control may block unsigned files that Microsoft does not already recognize.** It has no per-app allow-list. For personal testing on the owner's device, Smart App Control can be turned off in Windows Security while keeping Microsoft Defender Antivirus enabled. This is a local device choice, not a workaround for public distribution.

The latest main-branch test installer is available in the repository's Actions tab as the `facebook-archive-explorer-windows-test` artifact ZIP (14-day retention). It includes `build-verification.txt` with the installer SHA-256 digest. Beta and stable installers are attached to their GitHub Releases instead of relying only on short-lived Actions artifacts. See [Windows code signing](docs/CODE-SIGNING.md) and the [release roadmap](docs/ROADMAP.md) for details.

## Current capabilities

- A browsable Friends directory with separate current-friend, received-request, sent-request, rejected-request, and removed-friend filters; name/date/path search; and paginated results. Contact information remains excluded from the directory view and full-text index.
- Detailed snapshot comparisons with record-level before/after values, change-type and section filters, text/path search, pagination, and native CSV or JSON export. CSV output neutralizes spreadsheet formula-leading text.
- The reviewed Marketplace importer merges matching `items_selling_v2` and label/value detail records; available descriptions are retained from either source, with every source reference preserved. Seller/raw payload fields remain local provenance data and are not exposed in Marketplace search or cards.
- Saved-item source URLs and Facebook event links open in the system browser only after an explicit click. The Electron main process validates the URL scheme and rejects malformed, credential-bearing, or non-HTTP(S) values.
- A read-only Archive Files browser showing all discovered source paths, formats, import states, record counts, safe diagnostic codes, and file sizes when discovery metadata is available, with section/status filters, search, and pagination. This includes files in unsupported sections.
- A standalone **Import Photos & Videos** action that runs the same reviewed album-index and explicitly linked album-detail importers as Import All; it shares the global import lock and reports progress and diagnostics.
- A unified media library that filters by media kind, searches file names/archive paths, and paginates 100 distinct files by default, with selectable 50/100/250 page sizes and Grid/List views, directly from SQLite. Search and filtering happen before pagination; browsing is not limited to the first 1,000 media references. MP4/MOV/M4V duration scans use bounded file prefixes and suffixes.
- Functional sidebar navigation to Overview, Friends, Conversations, Photos & Videos, Activity, and Search. Navigation entries no longer advertise implemented modules as “Soon”.
- Optional local AI Assistant combines lexical BM25 and, when enabled, semantic retrieval rankings with reciprocal-rank fusion. Records matched by both methods receive a combined rank contribution, and lexical retrieval remains available when Semantic Search is disabled or unavailable.

- Electron desktop shell with a narrow, typed preload API and secure window defaults.
- Native selection of a local export directory or ZIP archive and a user-defined account label.
- Bounded, streaming inventory of directory and ZIP central-directory entries; discovery does not open file contents or extract ZIP entries.
- Independent backup snapshots persisted in SQLite, with a complete saved-backup history view (no fixed 20-snapshot limit).
- A symlink-aware archive text reader with path containment and file-size checks for directory and ZIP sources.
- DOM parsing for the five known Friends exports: current friends, received requests, sent requests, rejected requests, and removed friends.
- Explicit **Import Friends** action and one-click **Import All Supported Data** workflow, which sequentially runs Friends, Messages, Posts, Comments, Likes & Reactions, Photos & Videos, and the reviewed Groups, Events, Marketplace, and Saved Items JSON importers before bounded fallback processing.
- The combined import reports file/record/media/error totals and live per-file progress for Friends, Messages, Posts, Comments, Likes & Reactions, Photos & Videos, Groups, Events, Marketplace listings, and Saved Items; progress events contain counts and section names only. A cross-section integration fixture also runs the Events, Marketplace, and Saved Items importers together through the same Import All pipeline and verifies their stored records and source-file completion states. A main-process lock prevents overlapping imports and backup switching while an import is active. Completed files are skipped on subsequent runs and failed or unsupported files remain eligible for retry.
- Snapshot-scoped Import Diagnostics lists safe error/warning/notices with source-file and card-position references; the latest 250 issues are shown while severity totals cover the full report.
- Per-section Import Coverage separates content files from media inventory and shows completed, unsupported, failed, not processed, empty, and skipped file states. It also labels known HTML imports, sample-based parsers, media-only indexing, and sections with no importer yet.
- Application startup repairs source files and import runs left in a `processing`/`running` state across every saved backup inside one SQLite savepoint, records safe `IMPORT_INTERRUPTED` diagnostics, and makes affected files eligible for retry from an individual importer or Import All. Each source file is committed atomically, completed files are skipped on retry, and pause/resume waits for the active file transaction to finish. Import Coverage includes consistency checks for records, media references, metadata, and unfinished work.
- Contact information from the current friends page is stored separately in the local record payload and is not added to FTS5.
- DOM parsing and explicit **Import Messages** action for discovered conversation HTML in inbox, archived, filtered, and request folders.
- DOM parsing and explicit **Import Posts** action for the sampled `posts/*.html` card structure; raw author labels/dates and local photo/video/audio references are preserved.
- Searchable local Posts and Likes & Reactions activity panels, scoped to the selected backup.
- Conversation browser with conversation filtering, source-order message timeline, raw timestamps, reactions, local attachment previews, and paginated all-word search inside the selected conversation. This direct search works while global message search remains disabled and does not add message content to the global index.
- A unified media library that indexes all discovered image, video, and audio files across the backup, including album preview images linked by the imported Photos & Videos index; results are filtered before database pagination, with 100 items per page by default.
- In-app image and sticker preview plus local streaming audio/video playback with byte-range seeking. This works for directory backups and ZIP backups without extraction; deflated ZIP media is streamed through decompression to satisfy byte ranges.
- Message records are marked sensitive and excluded from FTS5 by default.
- Message attachment references are resolved locally and linked only when the file exists in the discovered backup inventory; original media bytes are not copied. Duplicate HTML references to the same attachment are collapsed to one media link, while the actual image/audio/video element determines its type.
- Exact, Fuzzy, and optional Semantic Search share offset-based result pages of up to 250 records, with previous/next navigation and JSON export of the currently displayed page. Semantic retrieval keeps only the requested top-result window in bounded memory while scanning the selected snapshot. Search remains snapshot-scoped, uses section/date filters, and respects the separate opt-in message index. For the observed Arabic HTML date format, Posts, Comments, Likes & Reactions, and Messages are normalized only when the same export footer explicitly supplies a UTC offset; raw dates are preserved and unsupported/missing-offset dates remain unnormalized. Optional Semantic Search adds local embeddings; a separate local AI Assistant can answer questions using retrieved records and source citations.
- Snapshot comparison for two backups of the same account, matching section, source-relative path, and original card index and reporting aggregate changes.
- Verified local application-database export and restore, using SQLite's online backup API, integrity/foreign-key/schema checks, a pre-restore recovery copy, and interrupted-swap recovery. The database backup contains indexes and imported records, not the original Facebook media.

## Not implemented yet

The following work is still required for a complete 1.0 release. A discovered filename or a generic fallback record is **not** counted as a verified section parser:

- Verified field-level parsers for remaining activity-card sections and export formats. The current reviewed set is Friends, Messages, Posts, Comments, Likes & Reactions, sampled Photos & Videos, and the observed Groups TNG JSON collections.
- Dedicated partial parsers and workspaces now cover reviewed Events response/invitation/hosted JSON variants, Marketplace `items_selling_v2` listings and label/value details, and Saved Items `saves_v2`. Other Marketplace files, additional Saved Items collections, and additional Groups/Pages/other-activity formats remain on the parser roadmap. Generic fallbacks preserve bounded content and source provenance but do not guarantee correct field mapping, relationships, or complete extraction. Generic HTML/JSON/TXT fallbacks preserve bounded content and source provenance but do not guarantee correct field mapping, relationships, or complete extraction.
- Broader Photos & Videos coverage for album layouts and media metadata not currently recognized. Image dimensions are read from bounded PNG/JPEG/GIF/WebP prefixes; video duration is currently limited to MP4/MOV/M4V headers found within a bounded 2 MiB prefix.
- Broader localized date coverage beyond the observed Arabic 12-hour HTML format with explicit export-footer UTC offsets; other locales, DST interpretation, and unsupported date formats still require evidence. Original date strings are always retained.
- Durable checkpoints within a single large source file. Current recovery is atomic per file; pause/resume takes effect after the active file transaction finishes.
- Four distinct search levels now have implementation foundations: Exact Search, Fuzzy Search, optional local Semantic Search (multilingual embeddings), and a separate optional local AI Assistant (LLM). Real-model inference, relevance, and complete real-export validation remain beta acceptance work; see [approved project decisions](docs/PROJECT-DECISIONS.md).
- Automated search testing includes a repeatable 50,000-record synthetic archive benchmark for Exact and Fuzzy Search. It records observed timings without imposing machine-dependent speed thresholds.
- Full large-archive performance benchmarks and end-to-end validation against a complete real Facebook export. The synthetic 50,000-record benchmark covers Exact/Fuzzy retrieval only; it does not replace real directory/ZIP import, media, or full-backup measurements.
- Clean-device Windows install, launch, upgrade, and uninstall smoke tests; final privacy/security review and release checklist.
- A trusted Windows signing identity, code-signing provider onboarding, and Smart App Control validation. Test installers may remain unsigned until signing is configured.

The detailed snapshot-comparison browser and CSV/JSON comparison export, Archive Files browser, Friends directory, Groups workspace, Other Data browser, Photos & Videos import action, Import Diagnostics, Import Coverage, and functional workspace navigation are implemented. See [the roadmap](docs/ROADMAP.md) for the authoritative implementation checklist.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Privacy and security](docs/PRIVACY-AND-SECURITY.md)
- [Import pipeline](docs/IMPORT-PIPELINE.md)
- [Data model](docs/DATA-MODEL.md)
- [Roadmap](docs/ROADMAP.md)
- [Approved project decisions](docs/PROJECT-DECISIONS.md)
- [Local AI features and privacy](docs/LOCAL-AI.md)
- [Windows code signing](docs/CODE-SIGNING.md)


## Current import support

Directory and ZIP backups can be selected, inventoried, reopened, and read on demand without extracting the original archive. Reviewed parsers share the same archive-relative reader for directory and ZIP sources.

- **Friends:** five known HTML export files, plus the reviewed Accounts Center TNG `friends_v2` JSON collection.
- **Messages:** observed conversation HTML and Accounts Center `message_*.json` chunks. Conversation timelines load 50 messages per page in original export order instead of loading an entire long thread at once; conversation-scoped all-word text search queries only the selected thread and returns 50 matches per page without enabling global message search; image/sticker previews are bounded to eight per displayed page. When users switch conversations or backups, late responses from an older request are ignored so the selected thread cannot be overwritten by stale data. Local photo/sticker/audio/video references are linked only when their source files exist in the same backup. Repeated link-plus-media references collapse to one attachment, and the media element determines its type. Message text remains excluded from global search by default.
- **Posts:** sampled legacy post-card HTML and observed TNG timeline JSON chunks, with source provenance and links to verified local media.
- **Comments:** sampled activity-card HTML and the observed TNG `comments_v2` collection.
- **Likes & Reactions:** sampled HTML cards and the observed TNG reaction JSON variants.
- **Groups:** reviewed `group_posts_v2`, `group_comments_v2`, and `groups_joined_v2` JSON collections in a dedicated workspace.
- **Events:** partial JSON support for `event_responses_v2`, `events_invited_v2`, and reviewed hosted-event list/label-value forms. RSVP status and original source references are preserved.
- **Marketplace:** partial support for `items_selling_v2` in `items_sold.json`, joined with matching `your_marketplace_items.json` label/value details. Missing listing descriptions can be filled from the matched details file. Seller/raw payload fields remain local provenance and are not exposed as listing search fields.
- **Saved Items:** partial support for the `saves_v2` collection, including safe HTTP(S) source links. Other collection formats remain fallback-preserved.
- **Photos & Videos:** the root album index and explicitly referenced album-detail pages are parsed into searchable albums and photo cards with local image links, captions, raw dates, and photo comment metadata. The observed TNG `posts/album/{id}.json` files are also supported. Media bytes remain in the original backup.
- **Unified media library:** all discovered image, video, and audio files are indexed, including unlinked media. Common image dimensions and MP4/MOV/M4V durations are scanned with bounded reads; audio/video can stream from directory or ZIP backups with byte-range seeking.
- **Other Data:** bounded HTML, JSON, and text fallbacks preserve unsupported records and source provenance for local browsing. A generic fallback is not treated as verified field-level parsing.

For the observed Arabic legacy HTML date form, Posts, Comments, Likes & Reactions, and Messages are normalized to UTC only when that same source file has one valid explicit UTC offset in its Facebook export footer. Raw dates are preserved. Missing/conflicting offsets and unsupported formats remain unnormalized and are excluded from UTC date filters. This does not infer historical daylight-saving rules.

Events and Saved Items source links open only after an explicit user click through validated HTTP/HTTPS handling in the Electron main process. Import never fetches external links automatically.

The Posts and Comments card parsers remain sample-based and all reviewed parser variants still need a complete real-backup end-to-end pass. Unreviewed Marketplace listing variants, Saved Items collections, Groups/Pages structures, other activity sections, and additional media layouts remain unsupported or fallback-preserved until their actual structures are reviewed and tested.
