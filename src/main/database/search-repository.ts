import type { DatabaseSync } from 'node:sqlite';
import type { ArchiveSearchResult } from '../../shared/archive/search';
import { getArchiveSection } from '../../shared/archive/section-registry';
import { normalizeSearchText } from '../../shared/text/normalize';

const MAX_QUERY_LENGTH = 180;
const MAX_RESULTS = 250;

/** FTS search is restricted to records explicitly enabled for indexing. */
export function searchArchiveRecords(
  database: DatabaseSync,
  snapshotId: string,
  query: string,
  sectionKey: string | null = null
): ArchiveSearchResult[] {
  if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH) {
    throw new Error('Search text must be 1 to 180 characters.');
  }
  if (sectionKey !== null && !getArchiveSection(sectionKey)) {
    throw new Error('The requested archive section is not recognized.');
  }
  const terms = normalizeSearchText(query).match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) ?? [];
  if (terms.length === 0) return [];
  const matchExpression = terms.map((term) => `"${term.replace(/"/gu, '""')}"`).join(' AND ');
  return database.prepare(`
    SELECT records.id AS id, records.section_key AS sectionKey,
      records.record_type AS recordType, source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex, records.title AS title,
      records.body_text AS body, records.event_time_raw AS dateRaw,
      bm25(record_search) AS relevance
    FROM record_search
    INNER JOIN records ON records.id = CAST(record_search.record_id AS INTEGER)
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE record_search MATCH ? AND records.snapshot_id = ?
      AND records.search_enabled = 1
      AND (? IS NULL OR records.section_key = ?)
    ORDER BY relevance ASC, source.relative_path COLLATE NOCASE,
      records.source_record_index ASC
    LIMIT ?
  `).all(matchExpression, snapshotId, sectionKey, sectionKey, MAX_RESULTS) as unknown as ArchiveSearchResult[];
}
