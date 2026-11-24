export type ArchiveSearchMode = 'exact' | 'fuzzy';
export type ArchiveSearchMatchType = 'exact' | 'fuzzy';

export interface ArchiveSearchResult {
  id: number;
  sectionKey: string;
  recordType: string;
  sourcePath: string;
  sourceCardIndex: number;
  title: string | null;
  body: string | null;
  dateRaw: string | null;
  relevance: number;
  matchType: ArchiveSearchMatchType;
  similarity: number;
}

export interface ArchiveSearchSettings {
  includeMessagesInGlobalSearch: boolean;
}

export type SearchExportResult =
  | { status: 'cancelled' }
  | { status: 'saved'; fileName: string; recordsExported: number };
