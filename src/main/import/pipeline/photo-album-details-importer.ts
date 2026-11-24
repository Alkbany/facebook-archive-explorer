import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { clearSourceFileRecords } from './source-file-records';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { parsePhotoAlbumDetail } from '../parsers/photo-album-detail-parser';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';

export interface PhotoAlbumDetailsImportResult {
  filesAttempted: number;
  recordsImported: number;
  mediaReferences: number;
  unsupportedFiles: number;
  failedFiles: number;
}

interface SourceFileRow { id: number; relative_path: string; }
interface AlbumRow { albumPath: string; albumTitle: string; }

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) {
    return { code: error.code, message: 'The album detail file could not be safely read from the selected backup.' };
  }
  return { code: 'PHOTO_ALBUM_DETAILS_IMPORT_FAILED', message: 'The album detail page could not be imported.' };
}

/** Imports only album detail pages explicitly referenced by an indexed album record. */
export async function importPhotoAlbumDetailsSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<PhotoAlbumDetailsImportResult> {
  const albums = database.prepare(`
    SELECT json_extract(payload_json, '$.album_path') AS albumPath, title AS albumTitle
    FROM records
    WHERE snapshot_id = ? AND section_key = 'photos_and_videos'
      AND record_type = 'photo_album'
  `).all(snapshotId) as unknown as AlbumRow[];
  const albumByPath = new Map(albums.filter((album) => typeof album.albumPath === 'string')
    .map((album) => [album.albumPath, album.albumTitle]));

  const discovered = database.prepare(`
    SELECT id, relative_path FROM source_files
    WHERE snapshot_id = ? AND section_key = 'photos_and_videos'
      AND detected_format = 'html' AND status IN ('discovered', 'failed', 'unsupported')
    ORDER BY relative_path COLLATE NOCASE
  `).all(snapshotId) as unknown as SourceFileRow[];
  const files = discovered.filter((file) =>
    /^photos_and_videos\/album\/[0-9]+\.html?$/u.test(file.relative_path) &&
    albumByPath.has(file.relative_path)
  );

  const summary: PhotoAlbumDetailsImportResult = {
    filesAttempted: 0, recordsImported: 0, mediaReferences: 0, unsupportedFiles: 0, failedFiles: 0
  };
  if (files.length === 0) return summary;

  const emitProgress = (phase: 'started' | 'progress' | 'completed') => reportImportProgress(onProgress, {
    sectionKey: 'photos_and_videos',
    phase,
    filesCompleted: summary.filesAttempted,
    filesTotal: files.length,
    recordsImported: summary.recordsImported,
    unsupportedFiles: summary.unsupportedFiles,
    failedFiles: summary.failedFiles
  });
  emitProgress('started');

  for (const file of files) {
    await waitIfImportPaused();
    summary.filesAttempted += 1;
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    database.prepare("INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered) VALUES (?, ?, 'import', 'running', ?, 1)")
      .run(runId, snapshotId, startedAt);
    database.prepare("UPDATE source_files SET status = 'processing', safe_error_code = NULL WHERE id = ? AND snapshot_id = ?")
      .run(file.id, snapshotId);
    database.exec('SAVEPOINT photo_album_detail_file');
    try {
      const parsed = parsePhotoAlbumDetail(
        await readArchiveUtf8File(archiveRoot, file.relative_path),
        file.relative_path
      );
      clearSourceFileRecords(database, file.id);
      const timestamp = new Date().toISOString();
      let warningCount = parsed.issues.length;
      const albumTitle = albumByPath.get(file.relative_path) ?? parsed.albumTitle ?? 'Photo album';
      const insertRecord = database.prepare(`
        INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
          title, body_text, normalized_text, event_time_raw, event_time_utc, sensitivity, search_enabled, payload_json, created_at)
        VALUES (?, ?, ?, 'photos_and_videos', 'photo', ?, ?, ?, ?, NULL, 'personal', 1, ?, ?)
        ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET
          title=excluded.title, body_text=excluded.body_text, normalized_text=excluded.normalized_text,
          event_time_raw=excluded.event_time_raw, payload_json=excluded.payload_json, created_at=excluded.created_at
      `);
      const getRecord = database.prepare('SELECT id FROM records WHERE source_file_id = ? AND source_record_index = ?');
      const findSourceMedia = database.prepare(`
        SELECT id FROM source_files
        WHERE snapshot_id = ? AND relative_path = ? AND detected_format = 'image'
      `);
      const insertMediaAsset = database.prepare(`
        INSERT INTO media_assets (snapshot_id, source_file_id, relative_path, media_kind, created_at)
        VALUES (?, ?, ?, 'image', ?)
        ON CONFLICT(snapshot_id, relative_path) DO UPDATE SET source_file_id=excluded.source_file_id
      `);
      const getMediaAsset = database.prepare('SELECT id FROM media_assets WHERE snapshot_id = ? AND relative_path = ?');
      const linkMedia = database.prepare(`
        INSERT INTO record_media (record_id, media_asset_id, display_order, role)
        VALUES (?, ?, 0, 'album_photo')
        ON CONFLICT(record_id, media_asset_id) DO UPDATE SET role=excluded.role
      `);

      for (const photo of parsed.photos) {
        insertRecord.run(
          snapshotId,
          file.id,
          photo.sourceCardIndex,
          albumTitle,
          photo.captionRaw,
          normalizeSearchText([albumTitle, photo.captionRaw].filter(Boolean).join(' ')),
          photo.dateRaw,
          JSON.stringify({
            album_path: file.relative_path,
            album_title: albumTitle,
            image_path: photo.imagePath,
            original_path: photo.originalPath,
            caption_raw: photo.captionRaw,
            comments_raw: photo.comments.map((comment) => ({
              author_raw: comment.authorRaw,
              body_raw: comment.bodyRaw,
              date_raw: comment.dateRaw
            }))
          }),
          timestamp
        );

        const savedRecord = getRecord.get(file.id, photo.sourceCardIndex) as { id: number };
        database.prepare('DELETE FROM record_media WHERE record_id = ?').run(savedRecord.id);
        const sourceMedia = findSourceMedia.get(snapshotId, photo.imagePath) as { id: number } | undefined;
        if (sourceMedia) {
          insertMediaAsset.run(snapshotId, sourceMedia.id, photo.imagePath, timestamp);
          const asset = getMediaAsset.get(snapshotId, photo.imagePath) as { id: number };
          linkMedia.run(savedRecord.id, asset.id);
          summary.mediaReferences += 1;
        } else {
          warningCount += 1;
          database.prepare(`
            INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
            VALUES (?, ?, 'warning', 'PHOTO_FILE_NOT_IN_ARCHIVE',
              'A photo referenced by the album page was not found in the discovered image inventory.', ?, ?)
          `).run(runId, file.id, JSON.stringify({ sourceCardIndex: photo.sourceCardIndex }), timestamp);
        }
      }

      for (const issue of parsed.issues) {
        database.prepare(`
          INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
          VALUES (?, ?, 'warning', ?, ?, ?, ?)
        `).run(
          runId,
          file.id,
          issue.code.toUpperCase(),
          'A photo card in this album could not be fully interpreted.',
          JSON.stringify({ sourceCardIndex: issue.sourceCardIndex }),
          timestamp
        );
      }

      const unsupported = parsed.photos.length === 0;
      if (unsupported) {
        database.prepare(`
          INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
          VALUES (?, ?, 'warning', 'PHOTO_ALBUM_CARDS_NOT_RECOGNIZED',
            'This album detail page did not contain any recognized photo cards.', '{}', ?)
        `).run(runId, file.id, timestamp);
      }
      database.prepare('UPDATE source_files SET status=?, record_count=?, safe_error_code=?, processed_at=? WHERE id=? AND snapshot_id=?')
        .run(
          unsupported ? 'unsupported' : 'completed',
          parsed.photos.length,
          unsupported ? 'PHOTO_ALBUM_CARDS_NOT_RECOGNIZED' : null,
          timestamp,
          file.id,
          snapshotId
        );
      database.prepare("UPDATE import_runs SET status='completed', finished_at=?, files_processed=1, records_imported=?, errors_count=? WHERE id=?")
        .run(timestamp, parsed.photos.length, warningCount + (unsupported ? 1 : 0), runId);
      database.exec('RELEASE photo_album_detail_file');
      summary.recordsImported += parsed.photos.length;
      if (unsupported) summary.unsupportedFiles += 1;
    } catch (error) {
      database.exec('ROLLBACK TO photo_album_detail_file');
      database.exec('RELEASE photo_album_detail_file');
      const failure = safeFailure(error);
      const timestamp = new Date().toISOString();
      database.prepare("UPDATE source_files SET status='failed', safe_error_code=?, processed_at=? WHERE id=? AND snapshot_id=?")
        .run(failure.code, timestamp, file.id, snapshotId);
      database.prepare(`
        INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
        VALUES (?, ?, 'error', ?, ?, '{}', ?)
      `).run(runId, file.id, failure.code, failure.message, timestamp);
      database.prepare("UPDATE import_runs SET status='failed', finished_at=?, files_processed=1, errors_count=1 WHERE id=?")
        .run(timestamp, runId);
      summary.failedFiles += 1;
    }
    emitProgress('progress');
  }

  emitProgress('completed');
  return summary;
}
