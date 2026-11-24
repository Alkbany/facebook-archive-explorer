# Architecture

## Electron process boundaries

1. **Main process** owns native windows, file dialogs, filesystem access, database access, import orchestration, and media handling.
2. **Preload** exposes a narrow, typed allowlist of operations to the renderer.
3. **Renderer** contains the React UI. It must not receive unrestricted Node.js or filesystem access.

The renderer must not import Node built-ins, Electron APIs, database drivers, or parser implementations directly.

## Planned source layout

```text
src/
  main/database/migrations/
  main/import/discovery/
  main/import/parsers/
  main/import/pipeline/
  main/media/
  main/ipc/
  main/index.ts
  preload/index.ts
  renderer/index.html
  renderer/src/
  shared/archive/
  shared/text/
  shared/desktop-api.ts
```

## Data ownership

- An account can have multiple independent backup snapshots.
- A later backup must not overwrite or merge an earlier one.
- Source files and imported records retain snapshot and source-file provenance.
- Media is referenced by relative path and metadata; media bytes are not copied into SQLite.
- Duplicate detection is advisory. Similar content must not be automatically deleted or merged.

## Import formats

The importer is planned to support HTML and JSON. A discovery pass inventories files before parsing. Parser selection considers both section and observed structure, not filename alone.

HTML must be parsed with a DOM parser. External URLs found in exports are data only and must not be fetched during import.

## Search and local AI pipeline

- Exact Search and Fuzzy Search use local SQLite indexes only.
- Conversation listing and name/path filtering run in SQLite with 50-item pages; the renderer receives only the current page and the matching total.
- Conversation-scoped message search builds a short-lived FTS5 index in SQLite's in-memory temp database from only the selected conversation, requires all query tokens to match as complete tokens, and paginates at 50 results. The temp index is cleared after retrieval and does not populate or depend on the global message FTS5 index.
- Sensitive Messages content is held in a separate opt-in FTS5 index.
- Semantic Search uses a separate local embedding pipeline. SQLite stores model-versioned jobs and embedding BLOBs; import code drains the queue between sections and on completion of individual section imports. Startup resumes unfinished work.
- The AI Assistant has an independent local text-generation model, queries local FTS evidence, and returns bounded source citations. Its model cache is separate from the embedding model cache.
- Neither model processes archive content through a cloud inference endpoint. Model assets are downloaded only after the corresponding user setting is enabled.
- See [Local AI Features](LOCAL-AI.md) for model details, message privacy, and beta limitations.

