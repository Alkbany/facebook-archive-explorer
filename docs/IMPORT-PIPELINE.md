# Import pipeline

## Required stages

1. **Selection** — the user selects one source directory or ZIP archive through the native picker.
2. **Discovery** — inventory directory and file names without opening file contents or changing the source. The current implementation has a safety cap and reports when an inventory is incomplete.
3. **Classification** — identify likely section and basic file format. Runtime discovery remains authoritative.
4. **Validation** — check path containment, symbolic links, readability, and file-size limits before opening supported text files.
5. **Parsing** — use a DOM parser for HTML and a JSON parser for JSON.
6. **Normalization** — preserve original values and generate separate normalized search values.
7. **Persistence** — save records and source references transactionally.
8. **Indexing** — add eligible text to the exact FTS5 index according to sensitivity policy; build typo-tolerant token lookup from that local index; if Semantic Search is explicitly enabled, generate and persist embeddings in bounded batches while importing eligible records. Embedding failures are tracked separately and must never roll back imported archive records.
9. **Reporting** — summarize processed, unsupported, empty, skipped, and failed files. A snapshot-scoped Import Diagnostics view lists safe issue messages by severity, source file, and card index (latest 250 shown; counts cover the full report).

## ZIP discovery and reads

- ZIP files are selected as archives without extracting or rewriting the original file.
- The central directory is read incrementally; entry contents are not decompressed during inventory.
- Entries are normalized to safe archive-relative paths. Absolute paths, parent traversal, encrypted entries, and symbolic-link entries are rejected or skipped.
- The inventory remains bounded by the same 100,000-entry safety cap and delivers discovered metadata in batches.
- Text entries are read on demand with a strict byte limit. Image previews are bounded. Audio/video entries remain in the ZIP and are streamed through the local media protocol with byte-range support; deflated entries are decompressed as a stream when seeking.

## Current discovery behavior

- The native picker selects a directory or `.zip` file and keeps its absolute path in the Electron main process.
- The renderer receives only the selected folder's display name and a summary report, not the full local path.
- The first pass reads directory entries, file extensions, and file-size metadata only. Directory sizes use `lstat` without following symbolic links; ZIP sizes come from the central directory. It does not open HTML, JSON, messages, photos, or other file contents.
- A discovery session, account label, independent backup snapshot, and source-file rows are persisted in the local SQLite database.
- The renderer can list saved backup inventories after the application restarts.
- Symbolic links are skipped during discovery.
- Inaccessible folders are counted as warnings.
- Inventory stops at a fixed entry limit and sets `truncated` when the limit is reached.
- Explicit `no-data.txt` markers are reported by section.

## First supported importer: Friends

The overview screen exposes an explicit **Import Friends** action after a folder has been inspected. It currently processes only these five known filenames in the `friends` section:

- `friends.html`
- `received_friend_requests.html`
- `sent_friend_requests.html`
- `rejected_friend_requests.html`
- `removed_friends.html`

The importer reads each file only after validating every path component. It rejects symbolic links, paths outside the selected archive, non-regular files, and files above the configured size limit. HTML is parsed with Cheerio's DOM parser.

Each imported record retains its record type, raw name, raw date, source file, and original card index. Repeated names remain separate records. No Facebook profile IDs or date meanings are invented. On the current friends page, optional contact details are stored separately in the record payload and are not copied into FTS5 title/body fields.

A file with no recognized Friends cards is marked unsupported and gets a safe import issue instead of being reported as successfully imported with zero records. Cards without readable names generate warnings while valid cards are still imported.

## Messages conversation importer

An explicit **Import Messages** action processes discovered HTML conversation files under `messages/inbox`, `messages/archived_threads`, `messages/filtered_threads`, and `messages/message_requests`. The parser uses the observed Facebook message-card DOM structure and retains source card order, sender text, message body, raw timestamp, and reaction text separately. Call-event text is classified as a best-effort record type without inferring call duration or outcome metadata.

Attachment references are resolved using the document's relative `base` element. Only relative paths that remain inside the archive are considered, and they are linked only when the corresponding file exists in the discovered snapshot inventory. The importer stores references and media metadata; it does not copy media bytes or fetch external URLs. Audio and video are identified from their DOM elements, not from an MP4 extension alone. Repeated references to the same archive-relative attachment within one card are collapsed. If a link wraps an image or audio/video element, the actual media element wins over the wrapper link; this prevents a linked MP4 audio clip from being counted again as a video.

Message records are marked sensitive and excluded from FTS5 by default. The conversation folder type is retained as payload metadata. Files with unrecognized card structures are marked unsupported, and empty cards generate warnings.

## Posts and Comments activity importers

The sampled Posts and Comments card structures have DOM-based parsers and snapshot-scoped importers. Posts retain observed author labels, body text, raw dates, opaque Facebook links, and verified local media references. Comments retain their activity heading, group label, comment body, raw date, and opaque link separately. No parent-comment relationship or destination post is inferred from display text alone.

For the reviewed Arabic legacy HTML date form (`D/M/YYYY h:mm ص|م`), the parsers also read an explicit `UTC±HH[:MM]` value from that same file's `._4t5o` export footer. Importers convert the date to UTC using that fixed stated offset, while retaining the original date string. The same rule is used for HTML Messenger and Likes & Reactions cards. If the footer has no valid single offset, or the raw date is not in the reviewed Arabic format, the UTC value remains null. No timezone is taken from Windows settings and no historical DST rule is inferred. TNG Unix timestamps and timezone-qualified ISO values continue through the existing numeric/ISO converter.

## Unified media indexing

After directory or ZIP discovery, every file classified as image, video, or audio is registered in `media_assets` using its discovered source-file row. This does not open or copy media bytes. The media browser shows both unlinked files and associations created by supported record importers. Image previews remain bounded; audio and video use the local byte-range protocol where the browser supports the codec.

## Import diagnostics

Startup recovery records an `IMPORT_INTERRUPTED` error for each recovered source file (or an archive-level issue when a run has no active file), links the issue to its import run, and keeps raw paths and archive contents out of the safe message. All recovery updates run inside one SQLite savepoint; if writing a diagnostic fails, the source-file, import-run, snapshot, and issue changes are rolled back together. The local Import Diagnostics report is scoped to the active snapshot. It joins issue records to their import run and source file, shows only the stored safe message and source-relative path, and extracts a source-card index when the parser recorded one. It does not display raw message text, raw archive payloads, or the full issue context JSON. The UI shows the latest 250 issues while severity totals are calculated across the full snapshot.

## Import coverage

The per-snapshot coverage summary groups discovered files by section and format. It labels importer capability separately from file state: Friends has five known HTML exports plus the reviewed `friends_v2` JSON collection; Messages, Posts, Comments, Likes & Reactions, and sampled Photos & Videos use parsers for explicitly reviewed HTML/JSON structures; Groups, Events, Marketplace, and Saved Items have partial JSON importers for their reviewed TNG collections. Other sections and unrecognized variants remain generic fallback or not implemented. Image, video, and audio files are counted as media inventory and excluded from content-import status totals. Content files are grouped into completed, unsupported, failed, not processed, empty, and skipped states. "Not processed" only means an importer has not attempted the file; it does not claim that a parser exists for that section or format.

## Photos & Videos albums and photo pages

The sampled root-level Photos & Videos HTML index is parsed into one local record per album. The parser keeps album names, numeric photo counts when the heading explicitly contains one, the album-detail relative path, the preview-image relative path, the original heading, and the date text exactly as exported. Arabic-Indic and Eastern Arabic-Indic numerals are normalized only for the numeric count; the raw count text is retained.

For each album path referenced by that index, the importer parses the sampled album-detail page (for example, `photos_and_videos/album/0.html`). Each photo card retains its local image path, caption, raw photo date, and source-card index. Comment entries are stored with their author, text, and raw date in original order. Dates are not converted or assigned a timezone.

An image or album preview is linked only when its path is relative, remains inside the Photos & Videos section, and matches a discovered image source-file row in the selected backup. The importer does not copy media bytes or fetch URLs. The album browser displays captions and comments, and the original image opens through the bounded local preview path. Pages not referenced by a parsed album index are left untouched.

## Search and comparison

FTS5 searches only records whose `search_enabled` flag is set. Message records remain excluded by default. Search results can be saved as JSON through the native save dialog. Snapshot comparison matches records by section, source-relative path, and original card index; the comparison workspace shows record-level before/after values with change-type and section filters, text/path search, pagination, and CSV/JSON export. It does not infer dates or compare binary media contents.

## Opening external references

Saved-item source links and event links are opened only when the user clicks the corresponding action. The renderer sends the URL through a narrow preload method; the main process accepts only well-formed HTTP/HTTPS URLs without embedded credentials and opens the validated URL with the operating system's default browser. Arbitrary renderer navigation and new windows remain denied. Import never fetches external links automatically.

## Remaining implementation and validation

- Broaden schema-specific parsing beyond the reviewed structures: additional activity-card sections, more Groups/Pages formats, Marketplace listing variants, Saved Items collections, and other Facebook export sections. Current Groups, Events, Marketplace, and Saved Items importers cover only their documented JSON collections; other files remain fallback-preserved or unsupported.
- Expand Photos & Videos parsing for unreviewed album and media-detail layouts. The current bounded metadata scanners already read common image dimensions and MP4/MOV/M4V durations; unsupported formats or metadata layouts remain unknown rather than guessed.
- Add evidence-backed timezone handling for localized Facebook HTML dates and extend date filters only where source dates are unambiguous. Raw date strings must remain available.
- Large-archive benchmarking and a complete end-to-end pass against representative real Facebook backups are still required. Unit fixtures alone do not prove coverage of every export variation.
- Per-file atomic commits, retry/recovery, pause/resume at file boundaries, and integrity diagnostics are implemented. Durable checkpoints inside a single very large file are not; an interrupted file is retried as a unit.
- Clean-device Windows install, launch, upgrade, and uninstall smoke tests plus the final privacy/security review remain required before the stable 1.0.0 release.

## Import progress events

Each section importer emits a start event, a progress event after each attempted file, and a completion event. The event contains only the section key, phase, file counts, record count, and unsupported/failed counts; it never includes archive paths, message text, or file contents. The main process forwards these events to the invoking renderer over a dedicated IPC channel. A disconnected progress listener cannot interrupt an import. A process-wide import lock serializes all import entry points; backup selection, opening another snapshot, database export, and database restore are rejected while an import is active.

## One-click import and resume behavior

The overview offers **Import All Supported Data**, which runs Friends, Messages, Posts, Comments, Likes & Reactions, the Photos & Videos album index and referenced album-detail pages, reviewed Groups/Events/Marketplace/Saved Items JSON importers, and bounded HTML/JSON/plain-text fallbacks. Each importer maintains per-file status and its own transaction. Completed files are skipped on the next run; failed or unsupported files are retried. The overall summary reports attempted files, imported records, media references, unsupported files, and failed files.

At startup, source files left in `processing` and their still-running import rows are marked as interrupted/failed with safe diagnostics, then become eligible for retry. Each file is committed atomically; a failed retry preserves the last successful records. User-controlled pause/resume takes effect at file boundaries. Import Coverage reports record/media consistency and unfinished-work diagnostics. ZIP archives use the same flow because importer reads are archive-source agnostic.

## Duplicate handling

Do not delete or merge records because names, timestamps, or text look similar. The Friends importer uses source file plus card index for stable per-file upserts; this does not merge different cards with the same name.

## Evidence levels

- `sampled`: a representative HTML structure was reviewed; a parser may be implemented only for the explicitly listed file types.
- `filename-only`: only file and folder names have been identified.
- `no-data`: an explicit no-data marker was observed.

Runtime discovery remains authoritative.


## Local application database backup and restore

- Export uses the Node.js SQLite online-backup API to produce a consistent standalone database instead of manually copying the active database and WAL/SHM files.
- A candidate restore file must be a regular non-empty SQLite file, pass `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, contain the required archive tables, and use a schema version no newer than the running app.
- Restore is refused while a database transaction, import, or discovery run is active.
- The current database is backed up to a recovery file before the staged restore is swapped into place. Startup restores the previous file if the process was interrupted before the new file was installed.
- Restoring restarts the application. The database file contains local archive indexes and imported records, not the original Facebook export folders, ZIP files, or media.


## Generic fallbacks

After reviewed section-specific HTML importers run, Import All checks remaining HTML files outside those reviewed sections, plus files that a reviewed importer explicitly marked unsupported. The generic HTML fallback reads at most 20 MiB per file, extracts visible text from semantic article/list/paragraph blocks, caps output at 5,000 records and 20,000 characters per record, and stores source path/card order. It does not execute scripts, fetch links, or modify source files. Sensitive and unknown sections are stored locally but excluded from full-text search. A parser-rejected file in a known section uses that section's sensitivity classification and is kept available in Other Data.

The JSON fallback separately reads JSON files with bounded file/record/count limits and preserves parsed values in a local payload. Neither fallback claims to understand an unreviewed Facebook schema. A reviewed section parser remains necessary for reliable field mapping, media relationships, and semantic date handling.


The plain-text fallback separately processes discovered `.txt` files (including section-level `no-data.txt` notices) up to 5 MiB each. It removes a UTF-8 BOM for display, preserves the remaining source text in the local record payload, indexes at most 20,000 characters for eligible non-sensitive sections, and keeps unknown or sensitive sections out of global search. Empty files are marked empty rather than indexed. This preserves content but does not infer the semantic meaning of a text file.


The plain-text fallback recognizes UTF-8, UTF-8 with BOM, and UTF-16 little-/big-endian files with their respective BOMs. Files without a BOM are treated as UTF-8; ambiguous legacy encodings are not guessed.


## Browsing preserved fallback records

The **Other Data** workspace pages through the stored HTML/JSON/text fallback records by section. Its optional search filters only the selected section's visible title, text, and source path. This allows a user to inspect a sensitive section locally without adding its contents to global FTS5 search. JSON payload previews and the preserved text/HTML-item payloads are bounded to 20,000 characters in the UI; the stored record payload remains in the local database.


For generic JSON records, `event_time_utc` is populated only when the preserved date field is an unambiguous Unix timestamp (seconds or milliseconds within the supported 2000–2100 range) or an ISO timestamp carrying an explicit timezone. The original value remains in `event_time_raw`. Locale-formatted dates and ISO date-only strings without a timezone remain raw and are not assigned an invented UTC time.


## Current nested Accounts Center layout

Inventory recognizes the current nested paths before assigning a section: \`connections/friends\`, \`personal_information/profile_information\`, \`logged_information/search\`, \`your_facebook_activity/posts\`, \`comments_and_reactions\`, \`groups\`, \`events\`, and \`messages\`, plus the ads and off-Facebook apps roots. Posts album/media and \`your_videos\` files map to Photos & Videos; comments and reaction JSON files are separated by their filenames. This is path classification only — it does not imply that every one of those JSON schemas has a semantic parser.

The observed \`connections/friends/your_friends.json\` \`friends_v2\` collection is parsed into the existing Friends directory. Only names enter full-text search; raw friend fields are retained locally in the record payload. The five known HTML Friends pages continue to use their existing parser.


The Posts importer also recognizes \`your_facebook_activity/posts/your_posts__check_ins__photos_and_videos*.json\` when it contains the observed timeline array. It imports the Facebook activity heading, post text, raw timestamp, and media URIs only from the selected archive's \`posts/media\` folder. Place addresses/coordinates, EXIF, IP metadata, and external URLs are deliberately not copied into searchable fields. Album JSON and posts-on-other-pages \`label_values\` records remain on the generic fallback until their dedicated views are implemented.


The Groups-specific JSON importer recognizes the TNG \`group_posts_v2\`, \`group_comments_v2\`, and \`groups_joined_v2\` collections in their three reviewed filenames under \`your_facebook_activity/groups/\`. It indexes only the activity title and visible post/comment/group-name text; external links, identifiers, member/contact fields, places, and attachment metadata are excluded from searchable fields. Unsupported structures remain eligible for the generic JSON fallback.


The Messages importer recognizes current Accounts Center \`message_*.json\` chunks beneath \`your_facebook_activity/messages/\` alongside the existing legacy HTML conversation layout. It imports sender, message text, raw millisecond timestamp, reaction labels, call-event markers, photo and sticker references. Only local archive-relative photo/sticker paths are linked. Share URLs and remote media URLs are never copied into message text, and all message content remains sensitive and excluded from global full-text search.


The Photos & Videos importer also recognizes self-contained Accounts Center album JSON files at \`your_facebook_activity/posts/album/{id}.json\`. It imports the album title, description, raw last-modified timestamp, photo captions and raw creation timestamps into the existing album/photo workspace. Cover and photo links are created only for image paths that match discovered local image files. Original JSON metadata remains in the local record payload but is not copied into full-text fields; EXIF, upload IPs, locations, and other metadata are therefore not part of global search. Unrecognized album JSON layouts remain eligible for the generic JSON fallback.


## Search indexes and privacy

- Exact Search uses the local SQLite FTS5 index and preserves original source values alongside normalized search text.
- Fuzzy Search uses a local token vocabulary and typo-distance scoring (insertions, deletions, substitutions, and adjacent transpositions). It does not require an LLM or an embedding model.
- Sensitive Messages content is excluded from the default global search index. An explicit, independent opt-in setting builds a separate local FTS5 message index; disabling it clears the message index.
- While the global Messages setting is off, the Messages workspace can still perform an exact, on-demand scoped text search without retaining a persistent message-content index. Fuzzy matching in Messages requires the explicit indexing opt-in.
- If Semantic Search is enabled, embeddings are generated incrementally during import. Existing imported records must be backfilled when a user enables the feature later. Embedding jobs are bounded, resumable, versioned, and isolated from archive import success.
- The AI Assistant is a separate optional LLM layer that retrieves local records and must provide navigable source references. It must not invent information or transmit archive content to an external provider.
