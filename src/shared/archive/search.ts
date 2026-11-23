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
}
export type SearchExportResult =
  | { status: 'cancelled' }
  | { status: 'saved'; fileName: string; recordsExported: number };
