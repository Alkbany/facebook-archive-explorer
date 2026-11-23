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
