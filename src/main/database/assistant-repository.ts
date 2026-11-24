import type { DatabaseSync } from 'node:sqlite';
import { normalizeSearchText } from '../../shared/text/normalize';
import type { ArchiveAssistantCitation } from '../../shared/archive/assistant';

const MAX_EVIDENCE_RECORDS = 24;
const MAX_EXCERPT_CHARACTERS = 900;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'when', 'where',
  'who', 'how', 'tell', 'show', 'summarize', 'summary', 'about', 'into', 'were',
  'was', 'are', 'you', 'your', 'our', 'all', 'any', 'each', 'every', 'please',
  'في', 'من', 'على', 'الى', 'إلى', 'عن', 'مع', 'ده', 'دي', 'دا', 'هو', 'هي',
  'ايه', 'إيه', 'اي', 'أي', 'ما', 'ماذا', 'متى', 'فين', 'مين', 'ازاي', 'كيف',
  'كل', 'الكلام', 'اللي', 'كان', 'كانت', 'يكون', 'تكون', 'قولي', 'لخصلي',
  'لخص', 'ملخص', 'اتكلمنا', 'اتناقشنا', 'كنا', 'بتاع', 'بتاعة', 'حول'
]);

interface RawEvidenceRow {
  id: number;
  sectionKey: string;
  recordType: string;
  sourcePath: string;
  sourceCardIndex: number;
  title: string | null;
  body: string | null;
  dateRaw: string | null;
  relevance: number;
}

export interface ArchiveAssistantEvidence {
  citation: ArchiveAssistantCitation;
  relevance: number;
}

function extractYear(question: string): number | null {
  const years = question.match(/(?:19|20)\d{2}/gu);
  if (!years || years.length === 0) return null;
  const candidate = Number(years[0]);
  return candidate >= 1900 && candidate <= 2099 ? candidate : null;
}

function extractTerms(question: string): string[] {
  const normalized = normalizeSearchText(question);
  const tokens = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token)))].slice(0, 10);
}

function exactEvidenceFromTable(
  database: DatabaseSync,
  table: 'record_search' | 'message_search',
  snapshotId: string,
  sectionKey: string | null,
  terms: string[],
  year: number | null
): RawEvidenceRow[] {
  if (terms.length === 0 && year === null) return [];

  const matchExpression = terms.length
    ? terms.map((term) => '"' + term.replace(/"/gu, '""') + '"').join(' OR ')
    : null;
  const dateClause = year === null
    ? ''
    : `AND (
        (records.event_time_utc >= ? AND records.event_time_utc < ?)
        OR substr(COALESCE(records.event_time_raw, ''), 1, 4) = ?
      )`;
  const searchClause = matchExpression === null ? '' : `AND ${table} MATCH ?`;
  const eligibilityClause = table === 'record_search'
    ? 'AND records.search_enabled = 1 AND records.sensitivity <> \'sensitive\''
    : 'AND records.section_key = \'messages\' AND records.sensitivity = \'sensitive\'';

  const sql = `
    SELECT records.id AS id, records.section_key AS sectionKey,
      records.record_type AS recordType, source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex, records.title AS title,
      records.body_text AS body, records.event_time_raw AS dateRaw,
      bm25(${table}) AS relevance
    FROM ${table}
    INNER JOIN records ON records.id = CAST(${table}.record_id AS INTEGER)
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE records.snapshot_id = ?
      ${eligibilityClause}
      AND (? IS NULL OR records.section_key = ?)
      ${dateClause}
      ${searchClause}
    ORDER BY relevance ASC, source.relative_path COLLATE NOCASE,
      records.source_record_index ASC
    LIMIT ?
  `;

  const parameters: Array<string | number | null> = [snapshotId, sectionKey, sectionKey];
  if (year !== null) {
    parameters.push(
      `${year}-01-01T00:00:00.000Z`,
      `${year + 1}-01-01T00:00:00.000Z`,
      String(year)
    );
  }
  if (matchExpression !== null) parameters.push(matchExpression);
  parameters.push(MAX_EVIDENCE_RECORDS);

  return database.prepare(sql).all(...parameters) as unknown as RawEvidenceRow[];
}

/**
 * Retrieve a small, bounded set of local source records for grounded assistant
 * answers. Archive text is evidence only; it is never treated as model instructions.
 */
export function retrieveArchiveAssistantEvidence(
  database: DatabaseSync,
  snapshotId: string,
  question: string,
  sectionKey: string | null = null
): ArchiveAssistantEvidence[] {
  if (typeof question !== 'string' || question.trim().length < 2 || question.length > 2_000) {
    throw new Error('Assistant question must be between 2 and 2,000 characters.');
  }

  const terms = extractTerms(question);
  const year = extractYear(question);
  if (terms.length === 0 && year === null) return [];

  const rows = exactEvidenceFromTable(
    database, 'record_search', snapshotId, sectionKey, terms, year
  );
  const messagesEnabled = (database.prepare(
    "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'include_messages_in_global_search'"
  ).get() as { value: string } | undefined)?.value === 'true';

  if (messagesEnabled && (sectionKey === null || sectionKey === 'messages')) {
    rows.push(...exactEvidenceFromTable(
      database, 'message_search', snapshotId, 'messages', terms, year
    ));
  }

  const unique = new Map<number, RawEvidenceRow>();
  for (const row of rows) {
    const existing = unique.get(row.id);
    if (!existing || row.relevance < existing.relevance) unique.set(row.id, row);
  }

  return [...unique.values()]
    .sort((left, right) => left.relevance - right.relevance)
    .slice(0, MAX_EVIDENCE_RECORDS)
    .map((row, index) => {
      const excerpt = [row.title, row.body].filter(Boolean).join(' — ')
        .slice(0, MAX_EXCERPT_CHARACTERS);
      return {
        relevance: row.relevance,
        citation: {
          sourceId: `S${index + 1}`,
          recordId: row.id,
          sectionKey: row.sectionKey,
          recordType: row.recordType,
          sourcePath: row.sourcePath,
          sourceCardIndex: row.sourceCardIndex,
          dateRaw: row.dateRaw,
          title: row.title,
          excerpt
        }
      };
    });
}
