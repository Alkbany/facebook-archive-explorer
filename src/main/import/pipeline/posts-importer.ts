import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { parsePostsExport, parsePostsJsonExport } from '../parsers/posts-parser';

export interface PostsImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  mediaReferences: number;
  unsupportedFiles: number;
  failedFiles: number;
}
interface SourceFileRow { id: number; relative_path: string; file_name: string; detected_format: string; }

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) return { code: error.code, message: 'The source file could not be safely read from the selected backup.' };
  return { code: 'POSTS_IMPORT_FAILED', message: 'The posts source file could not be imported.' };
}

function mediaKind(path: string): 'image' | 'video' | 'audio' | null {
  const extension = path.split('.').pop()?.toLocaleLowerCase() ?? '';
  if (['jpg','jpeg','png','gif','webp','bmp','heic','tif','tiff'].includes(extension)) return 'image';
  if (['mp4','mov','m4v','webm','avi','mkv','3gp'].includes(extension)) return 'video';
  if (['mp3','m4a','aac','wav','ogg','opus','flac'].includes(extension)) return 'audio';
  return null;
}

/** Imports reviewed Posts HTML cards and observed TNG timeline-post JSON files, linking only local media without copying files. */
export async function importPostsSection(database: DatabaseSync, snapshotId: string, archiveRoot: string, onProgress?: ImportProgressReporter): Promise<PostsImportSectionResult> {
  const files = database.prepare(`
    SELECT id, relative_path, file_name, detected_format FROM source_files
    WHERE snapshot_id = ? AND section_key = 'posts'
      AND ((detected_format = 'html') OR (detected_format = 'json' AND lower(file_name) GLOB 'your_posts__check_ins__photos_and_videos*.json'))
      AND status IN ('discovered', 'failed', 'unsupported')
    ORDER BY relative_path COLLATE NOCASE
  `).all(snapshotId) as unknown as SourceFileRow[];
  const summary: PostsImportSectionResult = { filesAttempted: 0, recordsImported: 0, mediaReferences: 0, unsupportedFiles: 0, failedFiles: 0 };

  const emitProgress = (phase: 'started' | 'progress' | 'completed') => reportImportProgress(onProgress, {
    sectionKey: 'posts',
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
    database.exec('SAVEPOINT posts_file');
    try {
      const sourceText = await readArchiveUtf8File(archiveRoot, file.relative_path);
      const parsed = file.detected_format === 'json'
        ? parsePostsJsonExport(sourceText.replace(/^\\uFEFF/u, ''), file.relative_path)
        : parsePostsExport(sourceText, file.relative_path);
      const now = new Date().toISOString();
      const insertRecord = database.prepare(`
        INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
          title, body_text, normalized_text, event_time_raw, event_time_utc, sensitivity, search_enabled, payload_json, created_at)
        VALUES (?, ?, ?, 'posts', 'post', ?, ?, ?, ?, NULL, 'personal', 1, ?, ?)
        ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET
          title=excluded.title, body_text=excluded.body_text, normalized_text=excluded.normalized_text,
          event_time_raw=excluded.event_time_raw, payload_json=excluded.payload_json, created_at=excluded.created_at
      `);
      const insertMedia = database.prepare(`
        INSERT INTO media_assets (snapshot_id, source_file_id, relative_path, media_kind, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(snapshot_id, relative_path) DO UPDATE SET source_file_id=excluded.source_file_id, media_kind=excluded.media_kind
      `);
      const getMedia = database.prepare('SELECT id FROM media_assets WHERE snapshot_id = ? AND relative_path = ?');
      const getSourceMedia = database.prepare('SELECT id FROM source_files WHERE snapshot_id = ? AND relative_path = ?');
      const linkMedia = database.prepare(`
        INSERT INTO record_media (record_id, media_asset_id, display_order, role)
        VALUES (?, ?, ?, 'post_attachment')
        ON CONFLICT(record_id, media_asset_id) DO UPDATE SET display_order=excluded.display_order
      `);
      const getRecord = database.prepare('SELECT id FROM records WHERE source_file_id = ? AND source_record_index = ?');
      for (const record of parsed.records) {
        const title = record.activityRaw;
        const normalized = normalizeSearchText([title, record.bodyRaw].filter(Boolean).join(' '));
        insertRecord.run(snapshotId, file.id, record.sourceCardIndex, title, record.bodyRaw, normalized,
          record.dateRaw, JSON.stringify({ permalink_raw: record.permalinkRaw }), now);
        const savedRecord = getRecord.get(file.id, record.sourceCardIndex) as { id: number };
        for (const media of record.media) {
          const kind = mediaKind(media.relativePath);
          if (!kind) continue;
          const sourceMedia = getSourceMedia.get(snapshotId, media.relativePath) as { id: number } | undefined;
          if (!sourceMedia) {
            database.prepare(`
              INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
              VALUES (?, ?, 'warning', 'POST_MEDIA_NOT_IN_ARCHIVE', 'A post media reference was not found in the discovered archive inventory.', ?, ?)
            `).run(runId, file.id, JSON.stringify({ sourceCardIndex: record.sourceCardIndex, mediaPath: media.relativePath }), now);
            continue;
          }
          insertMedia.run(snapshotId, sourceMedia.id, media.relativePath, kind, now);
          const asset = getMedia.get(snapshotId, media.relativePath) as { id: number };
          linkMedia.run(savedRecord.id, asset.id, media.displayOrder);
          summary.mediaReferences += 1;
        }
      }
      for (const issue of parsed.issues) {
        database.prepare(`
          INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
          VALUES (?, ?, 'warning', ?, ?, ?, ?)
        `).run(runId, file.id, issue.code.toUpperCase(), 'A post card could not be fully interpreted.', JSON.stringify({ sourceCardIndex: issue.sourceCardIndex }), now);
      }
      const unsupported = parsed.records.length === 0;
      database.prepare('UPDATE source_files SET status=?, record_count=?, safe_error_code=?, processed_at=? WHERE id=? AND snapshot_id=?')
        .run(unsupported ? 'unsupported' : 'completed', parsed.records.length, unsupported ? 'POST_CARDS_NOT_FOUND' : null, now, file.id, snapshotId);
      database.prepare("UPDATE import_runs SET status='completed', finished_at=?, files_processed=1, records_imported=?, errors_count=? WHERE id=?")
        .run(now, parsed.records.length, unsupported ? 1 : 0, runId);
      database.exec('RELEASE posts_file');
      summary.recordsImported += parsed.records.length;
      if (unsupported) summary.unsupportedFiles += 1;
    } catch (error) {
      database.exec('ROLLBACK TO posts_file');
      database.exec('RELEASE posts_file');
      const failure = safeFailure(error);
      const now = new Date().toISOString();
      database.prepare("UPDATE source_files SET status='failed', safe_error_code=?, processed_at=? WHERE id=? AND snapshot_id=?")
        .run(failure.code, now, file.id, snapshotId);
      database.prepare(`INSERT INTO import_issues (import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at)
        VALUES (?, ?, 'error', ?, ?, '{}', ?)`).run(runId, file.id, failure.code, failure.message, now);
      database.prepare("UPDATE import_runs SET status='failed', finished_at=?, files_processed=1, errors_count=1 WHERE id=?")
        .run(now, runId);
      summary.failedFiles += 1;
    }
    emitProgress('progress');
  }
  emitProgress('completed');
  return summary;
}
