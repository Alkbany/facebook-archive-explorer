import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ImportProgressEvent } from '../../../shared/archive/inspection';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { parseTngPhotoAlbumJson } from '../parsers/tng-photo-album-parser';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';

interface SourceFileRow {
  id: number;
  relative_path: string;
  file_name: string;
  file_size_bytes: number | null;
}

interface LocalImageRow {
  id: number;
  file_size_bytes: number | null;
}

export interface TngPhotoAlbumImportResult {
  filesAttempted: number;
  recordsImported: number;
  mediaReferences: number;
  unsupportedFiles: number;
  failedFiles: number;
}

const MAX_ALBUM_FILE_BYTES = 50 * 1024 * 1024;
const MAX_PHOTO_RECORD_BYTES = 5 * 1024 * 1024;

function addIssue(
  database: DatabaseSync,
  runId: string,
  sourceFileId: number,
  code: string,
  message: string,
  severity: 'warning' | 'error',
  context: Record<string, number | string> = {}
): void {
  database.prepare(
    'INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(runId, sourceFileId, severity, code, message, JSON.stringify(context), new Date().toISOString());
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) {
    return { code: error.code, message: 'The TNG photo album file could not be safely read from the selected backup.' };
  }
  return { code: 'TNG_PHOTO_ALBUM_IMPORT_FAILED', message: 'The TNG photo album file could not be imported.' };
}

/**
 * Imports self-contained Accounts Center album JSON files into the existing
 * album/photo tables. Only archive-local discovered images are linked.
 */
export async function importTngPhotoAlbumJsonSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<TngPhotoAlbumImportResult> {
  const candidates = database.prepare(
    'SELECT id, relative_path, file_name, file_size_bytes FROM source_files ' +
    "WHERE snapshot_id = ? AND section_key = 'photos_and_videos' AND detected_format = 'json' " +
    "AND lower(relative_path) LIKE 'your_facebook_activity/posts/album/%' " +
    "AND status IN ('discovered', 'failed', 'unsupported') ORDER BY relative_path COLLATE NOCASE"
  ).all(snapshotId) as unknown as SourceFileRow[];
  const files = candidates.filter((file) => /^your_facebook_activity\/posts\/album\/[^/]+\.json$/iu.test(
    file.relative_path.replace(/\\/gu, '/')
  ));

  const summary: TngPhotoAlbumImportResult = {
    filesAttempted: 0,
    recordsImported: 0,
    mediaReferences: 0,
    unsupportedFiles: 0,
    failedFiles: 0
  };
  if (files.length === 0) return summary;

  const emitProgress = (phase: ImportProgressEvent['phase']) => reportImportProgress(onProgress, {
    sectionKey: 'photos_and_videos',
    phase,
    filesCompleted: summary.filesAttempted,
    filesTotal: files.length,
    recordsImported: summary.recordsImported,
    unsupportedFiles: summary.unsupportedFiles,
    failedFiles: summary.failedFiles
  });
  emitProgress('started');

  const findImage = database.prepare(
    "SELECT id, file_size_bytes FROM source_files " +
    "WHERE snapshot_id = ? AND relative_path = ? AND detected_format = 'image'"
  );
  const insertAsset = database.prepare(
    'INSERT INTO media_assets (snapshot_id, source_file_id, relative_path, media_kind, file_size_bytes, created_at) ' +
    "VALUES (?, ?, ?, 'image', ?, ?) " +
    'ON CONFLICT(snapshot_id, relative_path) DO UPDATE SET source_file_id = excluded.source_file_id, ' +
    'file_size_bytes = excluded.file_size_bytes'
  );
  const findAsset = database.prepare(
    'SELECT id FROM media_assets WHERE snapshot_id = ? AND relative_path = ?'
  );
  const insertMediaLink = database.prepare(
    'INSERT INTO record_media (record_id, media_asset_id, display_order, role) ' +
    'VALUES (?, ?, ?, ?) ON CONFLICT(record_id, media_asset_id) DO UPDATE SET display_order = excluded.display_order, role = excluded.role'
  );

  for (const file of files) {
    await waitIfImportPaused();
    summary.filesAttempted += 1;
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    database.prepare(
      "INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered) " +
      "VALUES (?, ?, 'import', 'running', ?, 1)"
    ).run(runId, snapshotId, startedAt);
    database.prepare(
      "UPDATE source_files SET status = 'processing', safe_error_code = NULL WHERE id = ? AND snapshot_id = ?"
    ).run(file.id, snapshotId);

    database.exec('SAVEPOINT tng_photo_album_file');
    try {
      if (file.file_size_bytes !== null && file.file_size_bytes > MAX_ALBUM_FILE_BYTES) {
        throw new ArchiveReadError('FILE_TOO_LARGE');
      }
      const jsonText = (await readArchiveUtf8File(
        archiveRoot, file.relative_path, MAX_ALBUM_FILE_BYTES
      )).replace(/^\uFEFF/u, '');
      const parsed = parseTngPhotoAlbumJson(jsonText, file.relative_path);
      const timestamp = new Date().toISOString();

      if (!parsed) {
        database.prepare(
          "UPDATE source_files SET status = 'unsupported', parser_key = 'tng_photo_album_json', " +
          "safe_error_code = 'TNG_ALBUM_STRUCTURE_NOT_RECOGNIZED', processed_at = ? " +
          'WHERE id = ? AND snapshot_id = ?'
        ).run(timestamp, file.id, snapshotId);
        addIssue(
          database, runId, file.id, 'TNG_ALBUM_STRUCTURE_NOT_RECOGNIZED',
          'This JSON file does not match the reviewed Accounts Center album structure; it remains available to the generic JSON fallback.',
          'warning'
        );
        database.prepare(
          "UPDATE import_runs SET status = 'completed', finished_at = ?, files_processed = 1, errors_count = 1 WHERE id = ?"
        ).run(timestamp, runId);
        database.exec('RELEASE tng_photo_album_file');
        summary.unsupportedFiles += 1;
        emitProgress('progress');
        continue;
      }

      if (parsed.invalidPhotoPaths > 0) {
        addIssue(
          database, runId, file.id, 'TNG_ALBUM_PHOTO_PATH_REJECTED',
          'Some photo references were not archive-local paths and were not linked.',
          'warning',
          { rejectedPhotoPaths: parsed.invalidPhotoPaths }
        );
      }

      const photoCountText = parsed.photos.length + (parsed.photos.length === 1 ? ' photo' : ' photos');
      const body = parsed.descriptionRaw ?? photoCountText;
      const albumPayload = JSON.stringify({
        album_path: file.relative_path,
        photo_count: parsed.photos.length,
        cover_path: parsed.coverPath,
        source_format: 'tng_json',
        description_raw: parsed.descriptionRaw,
        original_payload: parsed.rawPayload
      });
      if (Buffer.byteLength(albumPayload, 'utf8') > MAX_PHOTO_RECORD_BYTES) {
        throw new ArchiveReadError('FILE_TOO_LARGE');
      }

      const normalizedAlbum = normalizeSearchText([parsed.albumTitle, parsed.descriptionRaw, photoCountText]
        .filter(Boolean).join(' '));
      const insertAlbum = database.prepare(
        'INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type, ' +
        'title, body_text, normalized_text, event_time_raw, event_time_utc, sensitivity, search_enabled, payload_json, created_at) ' +
        "VALUES (?, ?, 0, 'photos_and_videos', 'photo_album', ?, ?, ?, ?, NULL, 'personal', 1, ?, ?) " +
        'ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET ' +
        'section_key = excluded.section_key, record_type = excluded.record_type, title = excluded.title, ' +
        'body_text = excluded.body_text, normalized_text = excluded.normalized_text, ' +
        'event_time_raw = excluded.event_time_raw, event_time_utc = NULL, sensitivity = excluded.sensitivity, ' +
        'search_enabled = excluded.search_enabled, payload_json = excluded.payload_json, created_at = excluded.created_at'
      );
      insertAlbum.run(
        snapshotId, file.id, parsed.albumTitle, body, normalizedAlbum,
        parsed.dateRaw, albumPayload, timestamp
      );
      const albumRow = database.prepare(
        'SELECT id FROM records WHERE source_file_id = ? AND source_record_index = 0'
      ).get(file.id) as { id: number };
      database.prepare('DELETE FROM record_media WHERE record_id = ?').run(albumRow.id);

      const linkLocalImage = (recordId: number, relativePath: string | null, displayOrder: number, role: string): boolean => {
        if (!relativePath) return false;
        const sourceImage = findImage.get(snapshotId, relativePath) as LocalImageRow | undefined;
        if (!sourceImage) {
          addIssue(
            database, runId, file.id, 'TNG_ALBUM_MEDIA_NOT_IN_ARCHIVE',
            'A local photo reference was not found in the discovered image inventory.',
            'warning',
            { displayOrder }
          );
          return false;
        }
        insertAsset.run(snapshotId, sourceImage.id, relativePath, sourceImage.file_size_bytes, timestamp);
        const asset = findAsset.get(snapshotId, relativePath) as { id: number } | undefined;
        if (!asset) return false;
        insertMediaLink.run(recordId, asset.id, displayOrder, role);
        return true;
      };

      if (linkLocalImage(albumRow.id, parsed.coverPath, 0, 'album_cover')) {
        summary.mediaReferences += 1;
      }

      const insertPhoto = database.prepare(
        'INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type, ' +
        'title, body_text, normalized_text, event_time_raw, event_time_utc, sensitivity, search_enabled, payload_json, created_at) ' +
        "VALUES (?, ?, ?, 'photos_and_videos', 'photo', ?, ?, ?, ?, NULL, 'personal', 1, ?, ?) " +
        'ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET ' +
        'section_key = excluded.section_key, record_type = excluded.record_type, title = excluded.title, ' +
        'body_text = excluded.body_text, normalized_text = excluded.normalized_text, ' +
        'event_time_raw = excluded.event_time_raw, event_time_utc = NULL, sensitivity = excluded.sensitivity, ' +
        'search_enabled = excluded.search_enabled, payload_json = excluded.payload_json, created_at = excluded.created_at'
      );

      let importedPhotoRecords = 0;
      for (const photo of parsed.photos) {
        const payload = JSON.stringify({
          album_path: file.relative_path,
          image_path: photo.imagePath,
          original_path: null,
          comments_raw: [],
          source_format: 'tng_json',
          original_payload: photo.rawPayload
        });
        if (Buffer.byteLength(payload, 'utf8') > MAX_PHOTO_RECORD_BYTES) {
          addIssue(
            database, runId, file.id, 'TNG_ALBUM_PHOTO_RECORD_TOO_LARGE',
            'A photo record exceeded the local storage limit and was skipped.',
            'warning',
            { sourceIndex: photo.sourceIndex }
          );
          continue;
        }
        const normalized = normalizeSearchText([parsed.albumTitle, photo.captionRaw].filter(Boolean).join(' '));
        const recordIndex = photo.sourceIndex + 1;
        insertPhoto.run(
          snapshotId, file.id, recordIndex, parsed.albumTitle, photo.captionRaw,
          normalized, photo.dateRaw, payload, timestamp
        );
        importedPhotoRecords += 1;
        const row = database.prepare(
          'SELECT id FROM records WHERE source_file_id = ? AND source_record_index = ?'
        ).get(file.id, recordIndex) as { id: number };
        database.prepare('DELETE FROM record_media WHERE record_id = ?').run(row.id);
        if (linkLocalImage(row.id, photo.imagePath, photo.sourceIndex, 'album_photo')) {
          summary.mediaReferences += 1;
        }
      }

      const totalRecords = 1 + importedPhotoRecords;
      database.prepare(
        "UPDATE source_files SET status = 'completed', parser_key = 'tng_photo_album_json', " +
        'record_count = ?, safe_error_code = NULL, processed_at = ? WHERE id = ? AND snapshot_id = ?'
      ).run(totalRecords, timestamp, file.id, snapshotId);
      database.prepare(
        "UPDATE import_runs SET status = 'completed', finished_at = ?, files_processed = 1, " +
        'records_imported = ?, errors_count = ? WHERE id = ?'
      ).run(timestamp, totalRecords, parsed.invalidPhotoPaths, runId);
      database.exec('RELEASE tng_photo_album_file');
      summary.recordsImported += totalRecords;
    } catch (error) {
      database.exec('ROLLBACK TO tng_photo_album_file');
      database.exec('RELEASE tng_photo_album_file');
      const failure = safeFailure(error);
      const timestamp = new Date().toISOString();
      database.prepare(
        "UPDATE source_files SET status = 'failed', safe_error_code = ?, processed_at = ? " +
        'WHERE id = ? AND snapshot_id = ?'
      ).run(failure.code, timestamp, file.id, snapshotId);
      addIssue(database, runId, file.id, failure.code, failure.message, 'error');
      database.prepare(
        "UPDATE import_runs SET status = 'failed', finished_at = ?, files_processed = 1, errors_count = 1 WHERE id = ?"
      ).run(timestamp, runId);
      summary.failedFiles += 1;
    }
    emitProgress('progress');
  }

  emitProgress('completed');
  return summary;
}
