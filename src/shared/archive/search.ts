export const ARCHIVE_SEARCH_PAGE_SIZE = 250;
export const MAX_ARCHIVE_SEARCH_OFFSET = 50_000;

export type ArchiveSearchMode = 'exact' | 'fuzzy' | 'semantic';
export type ArchiveSearchMatchType = 'exact' | 'fuzzy' | 'semantic';

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
  semanticSearchEnabled: boolean;
  aiAssistantEnabled: boolean;
}

export type SemanticSearchPhase = 'disabled' | 'idle' | 'downloading' | 'loading' | 'indexing' | 'ready' | 'error';

export interface SemanticSearchStatus {
  enabled: boolean;
  modelId: string;
  modelVersion: string;
  phase: SemanticSearchPhase;
  total: number;
  completed: number;
  pending: number;
  processing: number;
  failed: number;
  progressPercent: number | null;
  lastErrorCode: string | null;
}

export type SearchExportResult =
  | { status: 'cancelled' }
  | { status: 'saved'; fileName: string; recordsExported: number };
