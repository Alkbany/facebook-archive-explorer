# Data model

The SQLite runtime and versioned migration runner are implemented. The current schema includes:

- **accounts** — logical Facebook account label.
- **archive_snapshots** — independent backup for one account.
- **source_files** — discovered files inside a snapshot, including relative path, detected format, processing status, and safe error code.
- **import_runs** — discovery and per-file import runs with counters and status.
- **records** — normalized records retaining snapshot, source-file, and source-card provenance.
- **record_search** — FTS5 index for records explicitly eligible for indexing.
- **media_assets** — media metadata and relative source paths; no media bytes.
- **record_media** — links records to media assets.
- **import_issues** — safe diagnostics for discovery, parsing, validation, and persistence.

## Implemented Friends record

The Friends importer stores:
- `record_type`: `friend`, `received`, `sent`, `rejected`, or `removed`.
- `title`: original extracted name text.
- `event_time_raw`: original date text, without assigning a guessed meaning.
- `source_file_id` and `source_record_index`: source file and original card position.
- `normalized_text`: Arabic-aware search form, separate from the original name.
- `payload_json`: optional contact information from the current friends page.

The name and normalized name are searchable. Contact information remains in `payload_json` and is not included in FTS5.

## Invariants

1. A snapshot belongs to exactly one account.
2. Multiple snapshots for one account remain independent.
3. Every imported record points to a source file and original record index.
4. Source paths stored in the database are relative to the selected export root.
5. Original text and raw timestamps are preserved separately from normalized values.
6. Sensitive records are excluded from FTS5 by default.
7. Similar records are not automatically collapsed.

Other section-specific record models and parsers are still pending.
