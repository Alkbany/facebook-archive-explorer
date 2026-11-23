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
}
