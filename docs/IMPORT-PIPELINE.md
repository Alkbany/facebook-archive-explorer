# Import pipeline

## Required stages

1. **Selection** — the user selects one source directory or ZIP archive through the native picker.
2. **Discovery** — inventory directory and file names without opening file contents or changing the source. The current implementation has a safety cap and reports when an inventory is incomplete.
3. **Classification** — identify likely section and basic file format. Runtime discovery remains authoritative.
4. **Validation** — check path containment, symbolic links, readability, and file-size limits before opening supported text files.
5. **Parsing** — use a DOM parser for HTML and a JSON parser for JSON.
6. **Normalization** — preserve original values and generate separate normalized search values.
7. **Persistence** — save records and source references transactionally.
8. **Indexing** — add eligible text to FTS5 according to sensitivity policy.
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

Attachment references are resolved using the document's relative `base` element. Only relative paths that remain inside the archive are considered, and they are linked only when the corresponding file exists in the discovered snapshot inventory. The importer stores references and media metadata; it does not copy media bytes or fetch external URLs. Audio and video are identified from their DOM elements, not from an MP4 extension alone.

Message records are marked sensitive and excluded from FTS5 by default. The conversation folder type is retained as payload metadata. Files with unrecognized card structures are marked unsupported, and empty cards generate warnings.

## Posts and Comments activity importers

The sampled Posts and Comments card structures have DOM-based parsers and snapshot-scoped importers. Posts retain observed author labels, body text, raw dates, opaque Facebook links, and verified local media references. Comments retain their activity heading, group label, comment body, raw date, and opaque link separately. No parent-comment relationship or destination post is inferred from display text alone.

## Unified media indexing

After directory or ZIP discovery, every file classified as image, video, or audio is registered in `media_assets` using its discovered source-file row. This does not open or copy media bytes. The media browser shows both unlinked files and associations created by supported record importers. Image previews remain bounded; audio and video use the local byte-range protocol where the browser supports the codec.

## Import diagnostics

Startup recovery records an `IMPORT_INTERRUPTED` error for each recovered source file (or an archive-level issue when a run has no active file), links the issue to its import run, and keeps raw paths and archive contents out of the safe message. All recovery updates run inside one SQLite savepoint; if writing a diagnostic fails, the source-file, import-run, snapshot, and issue changes are rolled back together. The local Import Diagnostics report is scoped to the active snapshot. It joins issue records to their import run and source file, shows only the stored safe message and source-relative path, and extracts a source-card index when the parser recorded one. It does not display raw message text, raw archive payloads, or the full issue context JSON. The UI shows the latest 250 issues while severity totals are calculated across the full snapshot.

## Import coverage

The per-snapshot coverage summary groups discovered files by section and format. It labels importer capability separately from file state: Friends has five known HTML exports; Messages, Posts, Comments, Likes & Reactions, and sampled Photos & Videos album index/detail HTML use sample-based parsers; other sections have no importer yet. Image, video, and audio files are counted as media inventory and excluded from content-import status totals. Content files are grouped into completed, unsupported, failed, not processed, empty, and skipped states. "Not processed" only means an importer has not attempted the file; it does not claim that a parser exists for that section or format.

## Photos & Videos albums and photo pages

The sampled root-level Photos & Videos HTML index is parsed into one local record per album. The parser keeps album names, numeric photo counts when the heading explicitly contains one, the album-detail relative path, the preview-image relative path, the original heading, and the date text exactly as exported. Arabic-Indic and Eastern Arabic-Indic numerals are normalized only for the numeric count; the raw count text is retained.

For each album path referenced by that index, the importer parses the sampled album-detail page (for example, `photos_and_videos/album/0.html`). Each photo card retains its local image path, caption, raw photo date, and source-card index. Comment entries are stored with their author, text, and raw date in original order. Dates are not converted or assigned a timezone.

An image or album preview is linked only when its path is relative, remains inside the Photos & Videos section, and matches a discovered image source-file row in the selected backup. The importer does not copy media bytes or fetch URLs. The album browser displays captions and comments, and the original image opens through the bounded local preview path. Pages not referenced by a parsed album index are left untouched.

## Search and comparison

FTS5 searches only records whose `search_enabled` flag is set. Message records remain excluded by default. Search results can be saved as JSON through the native save dialog. Snapshot comparison uses section key, source-relative HTML path, and original card index; it returns aggregate counts only and does not infer dates or compare binary file contents.

## Still not implemented

- JSON-backed section parsing; ZIP inventory and on-demand reads are implemented for HTML and media sources.
- Full resumable import orchestration across all sections and integrity reporting.
- Photo dimensions, video duration, and other media metadata not present in the sampled HTML cards.
- Groups, events, Marketplace, saved items, and other remaining export sections; these require their own verified samples.
- Advanced raw-date parsing and date filters.

## Import progress events

Each section importer emits a start event, a progress event after each attempted file, and a completion event. The event contains only the section key, phase, file counts, record count, and unsupported/failed counts; it never includes archive paths, message text, or file contents. The main process forwards these events to the invoking renderer over a dedicated IPC channel. A disconnected progress listener cannot interrupt an import. A process-wide import lock serializes all import entry points; backup selection, opening another snapshot, database export, and database restore are rejected while an import is active.

## One-click import and resume behavior

The overview offers **Import All Supported Data**, which runs Friends, Messages, Posts, Comments, Likes & Reactions, the Photos & Videos album index, and only the album-detail pages referenced by parsed album entries. Each importer maintains per-file status and its own transaction. Completed files are skipped on the next run; failed or unsupported files are retried. The overall summary reports attempted files, imported records, media references, unsupported files, and failed files.

At the beginning of the next Import All run, files left in `processing` and their still-running import rows are marked as interrupted/failed. The eligible failed files are then retried. Durable mid-file checkpoints, user-controlled pause/resume, and complete integrity reconciliation remain planned. ZIP archives use the same flow because importer reads are archive-source agnostic.

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

After reviewed section-specific HTML importers run, Import All checks remaining HTML files outside those reviewed sections. The generic HTML fallback reads at most 20 MiB per file, extracts visible text from semantic article/list/paragraph blocks, caps output at 5,000 records and 20,000 characters per record, and stores source path/card order. It does not execute scripts, fetch links, or modify source files. Sensitive and unknown sections are stored locally but excluded from full-text search.

The JSON fallback separately reads JSON files with bounded file/record/count limits and preserves parsed values in a local payload. Neither fallback claims to understand an unreviewed Facebook schema. A reviewed section parser remains necessary for reliable field mapping, media relationships, and semantic date handling.
