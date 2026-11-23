# Import pipeline

## Required stages

1. **Selection** — the user selects one source directory or ZIP.
2. **Discovery** — inventory files and directories without changing the source.
3. **Classification** — identify likely section, format, and parser candidate.
4. **Validation** — check readability, encoding, and expected structural markers.
5. **Parsing** — use a DOM parser for HTML and a JSON parser for JSON.
6. **Normalization** — preserve original values and generate separate normalized search values.
7. **Persistence** — save records and source references transactionally.
8. **Indexing** — add eligible text to FTS5 according to sensitivity policy.
9. **Reporting** — summarize processed, unsupported, empty, skipped, and failed files.

## Resume safety

Every discovered file receives a stable source-file row and status. Import runs record their state and last safely committed unit of work. On restart, the importer resumes from committed work rather than repeating or partially overwriting it.

A file is marked complete only after its records and final status are committed successfully.

## Failure policy

Never silently ignore an unsupported file. Preserve the original source file. Distinguish empty, missing, unreadable, unsupported, and parser-failed files. Parsing must be deterministic and independent of AI.

## Duplicate handling

Do not delete or merge records because names, timestamps, or text look similar. Use file hashes and conservative fingerprints to flag possible duplicates.

## HTML and media

Use a maintained DOM parser. Keep raw text and normalize a separate copy. Resolve document-relative media paths while rejecting paths outside the selected export root. Store media metadata and relative paths; do not copy media bytes into the database. Generate thumbnails only in an app-owned cache.

## Evidence levels

- `sampled`: a representative HTML structure was reviewed; no production parser is implied.
- `filename-only`: only file and folder names have been identified.
- `no-data`: an explicit no-data marker was observed.

Runtime discovery remains authoritative.
