import type { DatabaseSync } from 'node:sqlite';
import type { SavedItemContextSummary, SavedItemSummary } from '../../shared/archive/inspection';
import { normalizeSafeExternalUrl } from '../../shared/text/safe-external-url';

interface SavedPayload {
  contexts?: unknown;
}

function parsePayload(value: string): SavedPayload {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed as SavedPayload : {};
  } catch {
    return {};
  }
}

function parseContexts(value: unknown): SavedItemContextSummary[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
    const context = raw as Record<string, unknown>;
    const item: SavedItemContextSummary = {
      name: typeof context.name === 'string' ? context.name : null,
      url: normalizeSafeExternalUrl(context.url),
      source: typeof context.source === 'string' ? context.source : null
    };
    return item.name || item.url || item.source ? [item] : [];
  });
}

export function listSavedItems(
  database: DatabaseSync,
  snapshotId: string
): SavedItemSummary[] {
  const rows = database.prepare(`
    SELECT records.id AS id, records.title AS title,
      records.event_time_raw AS savedDateRaw, records.event_time_utc AS savedDateUtc,
      records.payload_json AS payloadJson, records.source_record_index AS sourceCardIndex,
      source.relative_path AS sourcePath
    FROM records
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE records.snapshot_id = ? AND records.section_key = 'saved_items_and_collections'
      AND records.record_type = 'saved_item'
    ORDER BY records.event_time_utc DESC, source.relative_path COLLATE NOCASE,
      records.source_record_index ASC
  `).all(snapshotId) as Array<{
    id: number; title: string; savedDateRaw: string | null;
    savedDateUtc: string | null; payloadJson: string;
    sourceCardIndex: number; sourcePath: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    savedDateRaw: row.savedDateRaw,
    savedDateUtc: row.savedDateUtc,
    contexts: parseContexts(parsePayload(row.payloadJson).contexts),
    sourcePath: row.sourcePath,
    sourceCardIndex: row.sourceCardIndex
  }));
}
