import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { parsePhotoAlbumsIndex } from '../parsers/photo-albums-parser';
import { importTngPhotoAlbumJsonSection } from './tng-photo-album-importer';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';

export interface PhotoAlbumsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  mediaReferences: number;
  unsupportedFiles: number;
  failedFiles: number;
}

interface SourceFileRow { id: number; relative_path: string; }

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) {
    return { code: error.code, message: 'The Photos & Videos source file could not be safely read from the selected backup.' };
  }
  return { code: 'PHOTO_ALBUM_IMPORT_FAILED', message: 'The Photos & Videos index could not be imported.' };
}

/**
 * Imports only the root-level Photos & Videos album index. Album detail pages
 * are deliberately left untouched until their export layout is verified.
 */
async function importLegacyPhotoAlbumsSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<PhotoAlbumsImportSectionResult> {
  const candidates = database.prepare(`
    SELECT id, relative_path FROM source_files
    WHERE snapshot_id = ? AND section_key = 'photos_and_videos'
      AND detected_format = 'html' AND status IN ('discovered', 'failed', 'unsupported')
    ORDER BY relative_path COLLATE NOCASE
  `).all(snapshotId) as unknown as SourceFileRow[];
  const files = candidates.filter((file) => {
    const parts = file.relative_path.replace(/\\\\/gu, '/').split('/');
    return parts.length === 2 && parts[0] === 'photos_and_videos';
  });
  const summary: PhotoAlbumsImportSectionResult = {
    filesAttempted: 0, recordsImported: 0, mediaReferences: 0, unsupportedFiles: 0, failedFiles: 0
  };

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
    database.exec('SAVEPOINT photo_albums_file');
    try {
      const parsed = parsePhotoAlbumsIndex(await readArchiveUtf8File(archiveRoot, file.relative_path), file.relative_path);
      const timestamp = new Date().toISOString();
      const insertRecord = database.prepare(`
        INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
          title, body_text, normalized_text, event_time_raw, event_time_utc, sensitivity, search_enabled, payload_json, created_at)
        VALUES (?, ?, ?, 'photos_and_videos', 'photo_album', ?, ?, ?, ?, NULL, 'personal', 1, ?, ?)
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
        VALUES (?, ?, 0, 'album_cover')
        ON CONFLICT(record_id, media_asset_id) DO UPDATE SET role=excluded.role
      `);

      for (const album of parsed.records) {
        const countText = album.photoCount === null
          ? null
          : album.photoCount.toLocaleString() + (album.photoCount === 1 ? ' photo' : ' photos');
        insertRecord.run(
          snapshotId,
          file.id,
          album.sourceCardIndex,
          album.albumTitle,
          countText,
          normalizeSearchText([album.albumTitle, countText].filter(Boolean).join(' ')),
          album.dateRaw,
          JSON.stringify({
            heading_raw: album.headingRaw,
            photo_count: album.photoCount,
            photo_count_raw: album.photoCountRaw,
            album_path: album.albumPath,
            cover_path: album.coverPath
          }),
          timestamp
        );

        const savedRecord = getRecord.get(file.id, album.sourceCardIndex) as { id: number };
        database.prepare('DELETE FROM record_media WHERE record_id = ?').run(savedRecord.id);
        if (album.coverPath) {
          const sourceMedia = findSourceMedia.get(snapshotId, album.coverPath) as { id: number } | undefined;
          if (sourceMedia) {
            insertMediaAsset.run(snapshotId, sourceMedia.id, album.coverPath, timestamp);
            const asset = getMediaAsset.get(snapshotId, album.coverPath) as { id: number };
            linkMedia.run(savedRecord.id, asset.id);
            summary.mediaReferences += 1;
          } else {
            database.prepare(`
              INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
              VALUES (?, ?, 'warning', 'ALBUM_COVER_NOT_IN_ARCHIVE', 'An album preview image was not found in the discovered image inventory.', ?, ?)
            `).run(runId, file.id, JSON.stringify({ sourceCardIndex: album.sourceCardIndex }), timestamp);
          }
        }
      }

      for (const issue of parsed.issues) {
        database.prepare(`
          INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
          VALUES (?, ?, 'warning', ?, ?, ?, ?)
        `).run(
          runId, file.id, issue.code.toUpperCase(),
          'An album card in the Photos & Videos index could not be fully interpreted.',
          JSON.stringify({ sourceCardIndex: issue.sourceCardIndex }), timestamp
        );
      }

      const unsupported = parsed.records.length === 0;
      if (unsupported) {
        database.prepare(`
          INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
          VALUES (?, ?, 'warning', 'PHOTO_ALBUM_INDEX_NOT_RECOGNIZED', 'This HTML file is not a recognized Photos & Videos album index. Album detail pages are not imported yet.', '{}', ?)
        `).run(runId, file.id, timestamp);
      }
      database.prepare('UPDATE source_files SET status=?, record_count=?, safe_error_code=?, processed_at=? WHERE id=? AND snapshot_id=?')
        .run(unsupported ? 'unsupported' : 'completed', parsed.records.length,
          unsupported ? 'PHOTO_ALBUM_INDEX_NOT_RECOGNIZED' : null, timestamp, file.id, snapshotId);
      database.prepare("UPDATE import_runs SET status='completed', finished_at=?, files_processed=1, records_imported=?, errors_count=? WHERE id=?")
        .run(timestamp, parsed.records.length, parsed.issues.length + (unsupported ? 1 : 0), runId);
      database.exec('RELEASE photo_albums_file');
      summary.recordsImported += parsed.records.length;
      if (unsupported) summary.unsupportedFiles += 1;
    } catch (error) {
      database.exec('ROLLBACK TO photo_albums_file');
      database.exec('RELEASE photo_albums_file');
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


/** Imports TNG JSON album details and the legacy HTML album index. */
export async function importPhotoAlbumsSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<PhotoAlbumsImportSectionResult> {
  const tng = await importTngPhotoAlbumJsonSection(database, snapshotId, archiveRoot, onProgress);
  const legacy = await importLegacyPhotoAlbumsSection(database, snapshotId, archiveRoot, onProgress);
  return {
    filesAttempted: tng.filesAttempted + legacy.filesAttempted,
    recordsImported: tng.recordsImported + legacy.recordsImported,
    mediaReferences: tng.mediaReferences + legacy.mediaReferences,
    unsupportedFiles: tng.unsupportedFiles + legacy.unsupportedFiles,
    failedFiles: tng.failedFiles + legacy.failedFiles
  };
}
