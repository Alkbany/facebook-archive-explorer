# Import pipeline

## Required stages

1. **Selection** — the user selects one source directory. ZIP selection is planned but not implemented.
2. **Discovery** — inventory directory and file names without opening file contents or changing the source. The current implementation has a safety cap and reports when an inventory is incomplete.
3. **Classification** — identify likely section and basic file format. Runtime discovery remains authoritative.
4. **Validation** — check path containment, symbolic links, readability, and file-size limits before opening supported text files.
5. **Parsing** — use a DOM parser for HTML and a JSON parser for JSON.
6. **Normalization** — preserve original values and generate separate normalized search values.
7. **Persistence** — save records and source references transactionally.
8. **Indexing** — add eligible text to FTS5 according to sensitivity policy.
9. **Reporting** — summarize processed, unsupported, empty, skipped, and failed files.

## ZIP discovery (initial support)

- ZIP files are selected as archives without extracting or rewriting the original file.
- The central directory is read incrementally; entry contents are not decompressed during inventory.
- Entries are normalized to safe archive-relative paths. Absolute paths, parent traversal, encrypted entries, and symbolic-link entries are rejected or skipped.
- The inventory remains bounded by the same 100,000-entry safety cap and delivers discovered metadata in batches.
- Text entries are read on demand with a strict byte limit. Large media remains in the ZIP and is not copied during discovery.

## Current discovery behavior

- The native folder picker selects a directory and keeps its absolute path in the Electron main process.
- The renderer receives only the selected folder's display name and a summary report, not the full local path.
- The first pass reads directory entries and file extensions only. It does not open HTML, JSON, messages, photos, or other file contents.
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

After directory discovery, every file classified as image, video, or audio is registered in `media_assets` using its discovered binary source-file row. This does not open or copy media bytes. The media browser shows both unlinked files and associations created by supported record importers. Image previews remain bounded; audio and video use the local byte-range protocol where the browser supports the codec.

## Search and comparison

FTS5 searches only records whose `search_enabled` flag is set. Message records remain excluded by default. Search results can be saved as JSON through the native save dialog. Snapshot comparison uses section key, source-relative HTML path, and original card index; it returns aggregate counts only and does not infer dates or compare binary file contents.

## Still not implemented

- JSON import. ZIP discovery and streaming reads are implemented; broader JSON-backed section parsing remains future work.
- Full resumable import orchestration across all sections and integrity reporting.
- Structured photo albums, groups, events, Marketplace, saved items, and other remaining export sections; these require their own verified samples.
- Album metadata enrichment (dimensions, duration, thumbnails, membership).
- Advanced raw-date parsing and date filters.

## One-click import and resume behavior

The overview offers **Import All Supported Data**, which runs Friends, Messages, Posts, Comments, and Likes & Reactions sequentially. Each importer maintains per-file status and its own transaction. Completed files are skipped on the next run; failed or unsupported files are retried. The overall summary reports attempted files, imported records, media references, unsupported files, and failed files.

This is not yet crash-safe resume orchestration: an abrupt process exit can leave a file marked as processing, and interrupted-file recovery has not yet been implemented. ZIP archives and unsupported sections are not part of this one-click action.

## Duplicate handling

Do not delete or merge records because names, timestamps, or text look similar. The Friends importer uses source file plus card index for stable per-file upserts; this does not merge different cards with the same name.

## Evidence levels

- `sampled`: a representative HTML structure was reviewed; a parser may be implemented only for the explicitly listed file types.
- `filename-only`: only file and folder names have been identified.
- `no-data`: an explicit no-data marker was observed.

Runtime discovery remains authoritative.
