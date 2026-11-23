# Data model

Planned entities:

- **accounts** — logical Facebook account label.
- **archive_snapshots** — independent backup for one account.
- **source_files** — files discovered inside a snapshot, including relative path, format, parser status, hash, and processing status.
- **import_runs** — resumable import attempts and progress.
- **records** — normalized records retaining snapshot and source-file provenance.
- **record_search** — FTS5 index for records explicitly eligible for indexing.
- **media_assets** — media metadata and relative source paths; no media bytes.
- **record_media** — links records to media assets.
- **import_issues** — safe diagnostics for discovery, parsing, validation, and persistence.

## Invariants

1. A snapshot belongs to exactly one account.
2. Multiple snapshots for one account remain independent.
3. Every imported record points to a source file.
4. Source paths stored in the database are relative to the selected export root.
5. Original text and raw timestamps are preserved separately from normalized values.
6. Sensitive records are excluded from FTS5 by default.
7. Similar records are not automatically collapsed.

The SQLite runtime and versioned migration runner are implemented. The schema supports account labels, independent backup snapshots, source-file inventory, import runs, normalized records, FTS5 search, media references, and import issues. The current discovery stage writes metadata only; record parsing and persistence are still pending.
