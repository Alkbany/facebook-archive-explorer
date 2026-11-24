export interface ArchiveMediaGalleryItem {
  id: number;
  recordId: number | null;
  relativePath: string;
  mediaKind: string;
  role: string | null;
  sourceFileId: number | null;
  sourcePath: string;
  sectionKey: string;
  recordType: string | null;
  sourceCardIndex: number | null;
  title: string | null;
  body: string | null;
  timestampRaw: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}


export type ArchiveMediaGalleryFilter = 'all' | 'image' | 'sticker' | 'video' | 'audio';

export interface ArchiveMediaGalleryPage {
  items: ArchiveMediaGalleryItem[];
  page: number;
  pageSize: number;
  total: number;
}
