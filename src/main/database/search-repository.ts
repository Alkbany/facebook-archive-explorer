import type { DatabaseSync } from 'node:sqlite';
import type { ArchiveSearchMatchType, ArchiveSearchMode, ArchiveSearchResult } from '../../shared/archive/search';
import { getArchiveSection } from '../../shared/archive/section-registry';
import { normalizeSearchText } from '../../shared/text/normalize';

const MAX_QUERY_LENGTH = 180;
const MAX_RESULTS = 250;
const MAX_FUZZY_CANDIDATES = 3_000;
const MAX_EXPANDED_TERMS = 12;
const MESSAGE_SEARCH_SETTING = 'include_messages_in_global_search';

interface FuzzyTermCandidate {
  term: string;
  similarity: number;
}

interface SearchHit extends ArchiveSearchResult {
  matchType: ArchiveSearchMatchType;
}

function editDistance(left: string, right: string): number {
  // Damerau–Levenshtein (optimal string alignment): adjacent transpositions
  // count as one typo, alongside insertions, deletions, and substitutions.
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let column = 0; column < columns; column += 1) matrix[0][column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost
      );
      if (
        row > 1 && column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + 1);
      }
    }
  }
  return matrix[left.length][right.length];
}

function tokenSimilarity(left: string, right: string): number {
  const denominator = Math.max(left.length, right.length);
  if (denominator === 0) return 1;
  return Math.max(0, 1 - editDistance(left, right) / denominator);
}

function fuzzyPrefixPatterns(term: string): string[] {
  const patterns = new Set<string>();
  if (term.length >= 2) patterns.add(term.slice(0, 2) + '*');
  if (term.length >= 3) patterns.add('?' + term.slice(1, 3) + '*');

  // Prefixes after deleting or transposing one of the first few characters
  // keep candidate lookup bounded while covering common early-position typos.
  for (let index = 0; index < Math.min(4, term.length); index += 1) {
    const shortened = term.slice(0, index) + term.slice(index + 1);
    if (shortened.length >= 2) patterns.add(shortened.slice(0, 2) + '*');
  }
  for (let index = 0; index < Math.min(3, term.length - 1); index += 1) {
    patterns.add(term.slice(index, index + 2) + '*');
  }
  return [...patterns];
}

function findFuzzyTermCandidates(
  database: DatabaseSync,
  vocabularyTable: 'record_search_vocab' | 'message_search_vocab',
  term: string,
  threshold: number
): FuzzyTermCandidate[] {
  if (term.length < 3) return [{ term, similarity: 1 }];

  const minimumLength = Math.max(1, Math.floor(term.length * threshold));
  const maximumLength = Math.ceil(term.length / threshold);
  const patterns = fuzzyPrefixPatterns(term);
  const wherePatterns = patterns.map(() => 'term GLOB ?').join(' OR ');
  const rows = database.prepare(`
    SELECT term FROM ${vocabularyTable}
    WHERE length(term) BETWEEN ? AND ?
      AND (${wherePatterns})
    LIMIT ?
  `).all(minimumLength, maximumLength, ...patterns, MAX_FUZZY_CANDIDATES) as Array<{ term: string }>;

  const candidates = new Map<string, number>();
  candidates.set(term, 1);
  for (const row of rows) {
    const similarity = tokenSimilarity(term, row.term);
    if (similarity >= threshold) candidates.set(row.term, similarity);
  }

  return [...candidates.entries()]
    .map(([candidate, similarity]) => ({ term: candidate, similarity }))
    .sort((left, right) => right.similarity - left.similarity || left.term.localeCompare(right.term))
    .slice(0, MAX_EXPANDED_TERMS);
}

function quoteFtsTerm(term: string): string {
  return '"' + term.replace(/"/gu, '""') + '"';
}

function makeExactMatchExpression(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 2) {
    const phrase = normalizeSearchText(trimmed.slice(1, -1));
    return phrase ? quoteFtsTerm(phrase) : null;
  }
  const terms = normalizeSearchText(trimmed).match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) ?? [];
  return terms.length ? terms.map(quoteFtsTerm).join(' AND ') : null;
}

function searchFtsTable(
  database: DatabaseSync,
  snapshotId: string,
  query: string,
  sectionKey: string | null,
  mode: ArchiveSearchMode,
  threshold: number,
  table: 'record_search' | 'message_search',
  vocabulary: 'record_search_vocab' | 'message_search_vocab'
): SearchHit[] {
  let matchExpression: string | null;
  let termSimilarity = 1;

  if (mode === 'fuzzy') {
    const queryTerms = normalizeSearchText(query).match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) ?? [];
    if (queryTerms.length === 0) return [];
    const candidateGroups = queryTerms.map((term) =>
      findFuzzyTermCandidates(database, vocabulary, term, threshold)
    );
    if (candidateGroups.some((group) => group.length === 0)) return [];
    matchExpression = candidateGroups.map((group) =>
      '(' + group.map((candidate) => quoteFtsTerm(candidate.term)).join(' OR ') + ')'
    ).join(' AND ');
    termSimilarity = candidateGroups.reduce(
      (sum, group) => sum + Math.max(...group.map((candidate) => candidate.similarity)),
      0
    ) / candidateGroups.length;
  } else {
    matchExpression = makeExactMatchExpression(query);
  }

  if (!matchExpression) return [];
  const rows = database.prepare(`
    SELECT records.id AS id, records.section_key AS sectionKey,
      records.record_type AS recordType, source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex, records.title AS title,
      records.body_text AS body, records.event_time_raw AS dateRaw,
      bm25(${table}) AS relevance
    FROM ${table}
    INNER JOIN records ON records.id = CAST(${table}.record_id AS INTEGER)
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE ${table} MATCH ? AND records.snapshot_id = ?
      AND ${table === 'message_search' ? '1 = 1' : 'records.search_enabled = 1'}
      AND (? IS NULL OR records.section_key = ?)
    ORDER BY relevance ASC, source.relative_path COLLATE NOCASE,
      records.source_record_index ASC
    LIMIT ?
  `).all(matchExpression, snapshotId, sectionKey, sectionKey, MAX_RESULTS) as Array<Omit<SearchHit, 'matchType' | 'similarity'>>;

  return rows.map((row) => ({
    ...row,
    matchType: mode === 'fuzzy' && termSimilarity < 1 ? 'fuzzy' : 'exact',
    similarity: termSimilarity
  }));
}

function searchMessagesWithoutGlobalIndex(
  database: DatabaseSync,
  snapshotId: string,
  query: string
): SearchHit[] {
  const trimmed = query.trim();
  const normalized = trimmed.startsWith('"') && trimmed.endsWith('"')
    ? normalizeSearchText(trimmed.slice(1, -1))
    : normalizeSearchText(trimmed);
  const terms = normalized.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) ?? [];
  if (terms.length === 0) return [];

  const clauses = terms.map(() => 'instr(COALESCE(records.normalized_text, \'\'), ?) > 0').join(' AND ');
  const rows = database.prepare(`
    SELECT records.id AS id, records.section_key AS sectionKey,
      records.record_type AS recordType, source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex, records.title AS title,
      records.body_text AS body, records.event_time_raw AS dateRaw,
      0.0 AS relevance
    FROM records
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE records.snapshot_id = ? AND records.section_key = 'messages'
      AND records.sensitivity = 'sensitive' AND ${clauses}
    ORDER BY source.relative_path COLLATE NOCASE, records.source_record_index ASC
    LIMIT ?
  `).all(snapshotId, ...terms, MAX_RESULTS) as Array<Omit<SearchHit, 'matchType' | 'similarity'>>;

  return rows.map((row) => ({ ...row, matchType: 'exact', similarity: 1 }));
}

/** Local Exact/Fuzzy search. Sensitive messages use a separate, explicit opt-in FTS index. */
export function searchArchiveRecords(
  database: DatabaseSync,
  snapshotId: string,
  query: string,
  sectionKey: string | null = null,
  mode: ArchiveSearchMode = 'exact',
  similarityThreshold = 0.8
): ArchiveSearchResult[] {
  if (typeof query !== 'string' || query.length < 1 || query.length > MAX_QUERY_LENGTH) {
    throw new Error('Search text must be 1 to 180 characters.');
  }
  if (sectionKey !== null && sectionKey !== 'messages' && !getArchiveSection(sectionKey)) {
    throw new Error('The requested archive section is not recognized.');
  }
  if (mode !== 'exact' && mode !== 'fuzzy') {
    throw new Error('The requested search mode is not supported.');
  }
  if (!Number.isFinite(similarityThreshold) || similarityThreshold < 0.65 || similarityThreshold > 0.98) {
    throw new Error('Fuzzy similarity must be between 0.65 and 0.98.');
  }

  const messageSearchEnabled = (database.prepare(
    'SELECT setting_value AS value FROM app_settings WHERE setting_key = ?'
  ).get(MESSAGE_SEARCH_SETTING) as { value: string } | undefined)?.value === 'true';

  if (sectionKey === 'messages' && !messageSearchEnabled) {
    // Section-scoped inspection remains available, but sensitive text is not
    // placed in a global FTS/trigram vocabulary while the opt-in is disabled.
    return searchMessagesWithoutGlobalIndex(database, snapshotId, query);
  }

  const results = searchFtsTable(
    database, snapshotId, query, sectionKey, mode, similarityThreshold,
    'record_search', 'record_search_vocab'
  );

  if ((sectionKey === null || sectionKey === 'messages') && messageSearchEnabled) {
    const messages = searchFtsTable(
      database, snapshotId, query, 'messages', mode, similarityThreshold,
      'message_search', 'message_search_vocab'
    );
    results.push(...messages);
  }

  const unique = new Map<number, SearchHit>();
  for (const result of results) {
    const previous = unique.get(result.id);
    if (!previous || result.similarity > previous.similarity) unique.set(result.id, result);
  }
  return [...unique.values()]
    .sort((left, right) =>
      right.similarity - left.similarity ||
      left.relevance - right.relevance ||
      left.sourcePath.localeCompare(right.sourcePath)
    )
    .slice(0, MAX_RESULTS);
}
