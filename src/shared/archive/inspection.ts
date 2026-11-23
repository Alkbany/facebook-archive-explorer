export type DetectedArchiveFormat = 'html' | 'json' | 'text' | 'image' | 'video' | 'audio' | 'other' | 'unknown';

export interface DiscoveredArchiveFile {
  relativePath: string;
  fileName: string;
  sectionKey: string;
  detectedFormat: DetectedArchiveFormat;
  /** File byte length from filesystem metadata or the ZIP central directory. */
  fileSizeBytes?: number | null;
}

export interface ArchiveInspectionReport {
  archiveName: string;
  inspectedAt: string;
  snapshotId: string;
  accountId: string;
  totalFiles: number;
  totalDirectories: number;
  filesByFormat: {
    html: number;
    json: number;
    media: number;
    other: number;
  };
  sectionFileCounts: Record<string, number>;
  noDataSections: string[];
  skippedSymlinks: number;
  unreadableDirectories: number;
  truncated: boolean;
}

export type ArchiveInspectionView = Omit<
  ArchiveInspectionReport,
  'totalDirectories' | 'skippedSymlinks' | 'unreadableDirectories' | 'truncated'
> & {
  totalDirectories: number | null;
  skippedSymlinks: number | null;
  unreadableDirectories: number | null;
  truncated: boolean | null;
};

export interface ArchiveSnapshotSummary {
  id: string;
  accountName: string;
  backupName: string;
  status: string;
  createdAt: string;
  filesDiscovered: number;
  recordsImported: number;
}

export interface FriendsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

export interface PostsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  mediaReferences: number;
  unsupportedFiles: number;
  failedFiles: number;
}

export interface PhotoAlbumsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  mediaReferences: number;
  unsupportedFiles: number;
  failedFiles: number;
}

export interface PhotoAlbumRecordSummary {
  id: number;
  sourcePath: string;
  sourceCardIndex: number;
  albumTitle: string;
  photoCount: number | null;
  albumPath: string;
  coverPath: string | null;
  coverAssetId: number | null;
  dateRaw: string | null;
  detailStatus: string;
  importedPhotoCount: number;
}

export interface PhotoAlbumCommentSummary {
  authorRaw: string | null;
  bodyRaw: string | null;
  dateRaw: string | null;
}

export interface PhotoAlbumPhotoSummary {
  id: number;
  sourcePath: string;
  sourceCardIndex: number;
  albumTitle: string;
  imageAssetId: number | null;
  imagePath: string;
  originalPath: string | null;
  captionRaw: string | null;
  dateRaw: string | null;
  comments: PhotoAlbumCommentSummary[];
}

export interface PhotoAlbumDetailView {
  albumRecordId: number;
  albumTitle: string;
  albumPath: string;
  detailFileStatus: string;
  photos: PhotoAlbumPhotoSummary[];
}

export interface PostRecordSummary {
  id: number;
  sourcePath: string;
  sourceCardIndex: number;
  authorRaw: string | null;
  bodyRaw: string | null;
  dateRaw: string | null;
  mediaCount: number;
}

export interface CommentsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

export interface CommentActivitySummary {
  id: number;
  sourcePath: string;
  sourceCardIndex: number;
  activityRaw: string | null;
  bodyRaw: string | null;
  groupRaw: string | null;
  dateRaw: string | null;
}

export interface ReactionsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

export interface ReactionRecordSummary {
  id: number;
  sourceFileId: number;
  sourcePath: string;
  sourceCardIndex: number;
  reactionType: string | null;
  descriptionRaw: string | null;
  dateRaw: string | null;
}

export interface MessagesImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
  mediaReferences: number;
}


export interface ImportIssueSummary {
  id: number;
  severity: 'info' | 'warning' | 'error';
  issueCode: string;
  safeMessage: string;
  sourceFileName: string | null;
  sourcePath: string | null;
  sourceCardIndex: number | null;
  createdAt: string;
}

export interface ImportIssueReport {
  items: ImportIssueSummary[];
  total: number;
  hasMore: boolean;
  counts: { info: number; warning: number; error: number };
}



export type ImportProgressSectionKey = 'friends' | 'messages' | 'posts' | 'comments' | 'likes_and_reactions' | 'photos_and_videos' | 'json';

export interface ImportProgressEvent {
  sectionKey: ImportProgressSectionKey;
  phase: 'started' | 'progress' | 'completed';
  filesCompleted: number;
  filesTotal: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

export interface ImportCoverageSectionSummary {
  sectionKey: string;
  totalFiles: number;
  htmlFiles: number;
  jsonFiles: number;
  textFiles: number;
  mediaFiles: number;
  otherFiles: number;
  completedFiles: number;
  unsupportedFiles: number;
  failedFiles: number;
  unprocessedFiles: number;
  emptyFiles: number;
  skippedFiles: number;
}

export interface ImportIntegritySummary {
  sourceRecordCountMismatches: number;
  recordsFromAnotherSnapshot: number;
  mediaAssetsWithoutSourceFile: number;
  mediaAssetsFromAnotherSnapshot: number;
  mediaLinksAcrossSnapshots: number;
  invalidMediaMetadata: number;
  runningImportRuns: number;
  processingSourceFiles: number;
}

export interface ImportCoverageReport {
  integrity: ImportIntegritySummary;
  totals: {
    totalFiles: number;
    contentFiles: number;
    mediaFiles: number;
    completedFiles: number;
    unsupportedFiles: number;
    failedFiles: number;
    unprocessedFiles: number;
    emptyFiles: number;
    skippedFiles: number;
  };
  sections: ImportCoverageSectionSummary[];
}

export interface JsonImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

export interface ImportAllSupportedDataResult {
  sections: {
    friends: FriendsImportSectionResult;
    messages: MessagesImportSectionResult;
    posts: PostsImportSectionResult;
    comments: CommentsImportSectionResult;
    reactions: ReactionsImportSectionResult;
    photosAndVideos: PhotoAlbumsImportSectionResult;
    json: JsonImportSectionResult;
  };
  totals: {
    filesAttempted: number;
    recordsImported: number;
    mediaReferences: number;
    unsupportedFiles: number;
    failedFiles: number;
  };
}

export type FriendRecordType = 'friend' | 'received' | 'sent' | 'rejected' | 'removed';
export type FriendDirectoryFilter = 'all' | FriendRecordType;

export interface FriendDirectoryRecord {
  id: number;
  nameRaw: string;
  recordType: FriendRecordType;
  dateRaw: string | null;
  sourcePath: string;
  sourceCardIndex: number;
}

export interface FriendDirectoryView {
  records: FriendDirectoryRecord[];
  counts: {
    all: number;
    friends: number;
    received: number;
    sent: number;
    rejected: number;
    removed: number;
  };
  total: number;
  page: number;
  pageSize: number;
}


export type ArchiveFileStatus = 'all' | 'discovered' | 'queued' | 'processing' | 'completed' | 'empty' | 'unsupported' | 'failed' | 'skipped';

export interface ArchiveFileRecord {
  id: number;
  relativePath: string;
  fileName: string;
  sectionKey: string;
  detectedFormat: DetectedArchiveFormat;
  status: Exclude<ArchiveFileStatus, 'all'>;
  fileSizeBytes: number | null;
  recordCount: number;
  safeErrorCode: string | null;
  processedAt: string | null;
}

export interface ArchiveFileDirectoryView {
  records: ArchiveFileRecord[];
  counts: {
    all: number;
    discovered: number;
    queued: number;
    processing: number;
    completed: number;
    empty: number;
    unsupported: number;
    failed: number;
    skipped: number;
  };
  total: number;
  page: number;
  pageSize: number;
}
