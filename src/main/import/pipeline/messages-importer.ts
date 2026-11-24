import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { clearSourceFileRecords } from './source-file-records';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { parseMessageConversation, parseMessageConversationJson } from '../parsers/messages-parser';

interface MessageSourceFileRow {
  id: number;
  relative_path: string;
  file_name: string;
  detected_format: string;
  file_size_bytes?: number | null;
}

export interface MessagesImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
  mediaReferences: number;
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) {
    const messages: Record<string, string> = {
      INVALID_RELATIVE_PATH: 'The stored source path is invalid.',
      FILE_NOT_FOUND: 'The conversation file is no longer present in the selected archive.',
      SYMLINK_NOT_ALLOWED: 'Symbolic links are not read by the archive importer.',
      NOT_A_FILE: 'The conversation source is not a regular file.',
      FILE_TOO_LARGE: 'The conversation file exceeded the parsing size limit.',
      PATH_OUTSIDE_ARCHIVE: 'The conversation path resolves outside the selected archive.'
    };
    return { code: error.code, message: messages[error.code] ?? 'The conversation file could not be read.' };
  }
  return { code: 'MESSAGES_FILE_PARSING_FAILED', message: 'The conversation HTML could not be parsed.' };
}

function insertIssue(
  database: DatabaseSync,
  runId: string,
  sourceFileId: number,
  severity: 'warning' | 'error',
  code: string,
  message: string,
  context: Record<string, number | string | null> = {}
): void {
  database.prepare(`
    INSERT INTO import_issues (
      import_run_id, source_file_id, severity, issue_code, safe_message, context_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(runId, sourceFileId, severity, code, message, JSON.stringify(context), new Date().toISOString());
}

const MAX_MESSAGE_FILE_BYTES = 50 * 1024 * 1024;

async function importOneConversation(
  database: DatabaseSync,
  snapshotId: string,
  source: MessageSourceFileRow,
  archiveRoot: string
): Promise<{ records: number; media: number; unsupported: boolean }> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered)
    VALUES (?, ?, 'import', 'running', ?, 1)
  `).run(runId, snapshotId, startedAt);
  database.prepare(`
    UPDATE source_files SET status = 'processing', safe_error_code = NULL
    WHERE id = ? AND snapshot_id = ?
  `).run(source.id, snapshotId);

  database.exec('SAVEPOINT messages_file_import');
  try {
    if (source.file_size_bytes !== null && source.file_size_bytes !== undefined &&
        source.file_size_bytes > MAX_MESSAGE_FILE_BYTES) {
      throw new ArchiveReadError('FILE_TOO_LARGE');
    }
    const sourceText = await readArchiveUtf8File(archiveRoot, source.relative_path, MAX_MESSAGE_FILE_BYTES);
    const parsed = source.detected_format === 'json'
      ? parseMessageConversationJson(sourceText.replace(/^\uFEFF/u, ''), source.relative_path)
      : source.detected_format === 'html'
        ? parseMessageConversation(sourceText, source.relative_path)
        : (() => { throw new Error('MESSAGES_FORMAT_UNSUPPORTED'); })();
    clearSourceFileRecords(database, source.id);
    const timestamp = new Date().toISOString();
    const insertRecord = database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, event_time_raw, event_time_utc,
        sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, ?, 'messages', ?, ?, ?, ?, ?, NULL, 'sensitive', 0, ?, ?)
      ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET
        record_type = excluded.record_type,
        title = excluded.title,
        body_text = excluded.body_text,
        normalized_text = excluded.normalized_text,
        event_time_raw = excluded.event_time_raw,
        event_time_utc = NULL,
        sensitivity = excluded.sensitivity,
        search_enabled = excluded.search_enabled,
        payload_json = excluded.payload_json,
        created_at = excluded.created_at
    `);

    const insertAsset = database.prepare(`
      INSERT INTO media_assets (snapshot_id, source_file_id, relative_path, media_kind, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_id, relative_path) DO UPDATE SET
        media_kind = excluded.media_kind
    `);
    const getAsset = database.prepare(
      'SELECT id FROM media_assets WHERE snapshot_id = ? AND relative_path = ?'
    );
    const linkMedia = database.prepare(`
      INSERT INTO record_media (record_id, media_asset_id, display_order, role)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(record_id, media_asset_id) DO UPDATE SET
        display_order = excluded.display_order, role = excluded.role
    `);
    const getRecord = database.prepare(
      'SELECT id FROM records WHERE source_file_id = ? AND source_record_index = ?'
    );

    let mediaReferences = 0;
    for (const message of parsed.messages) {
      insertRecord.run(
        snapshotId,
        source.id,
        message.sourceCardIndex,
        message.recordType,
        message.senderRaw,
        message.bodyRaw,
        message.bodyRaw ? normalizeSearchText(message.bodyRaw) : null,
        message.timestampRaw,
        JSON.stringify({
          sender_raw: message.senderRaw,
          reactions_raw: message.reactionsRaw,
          conversation_type: source.relative_path.split('/')[0] === 'your_facebook_activity'
            ? source.relative_path.split('/')[2] ?? 'unknown'
            : source.relative_path.split('/')[1] ?? 'unknown',
          message_raw: message.rawPayload ?? null,
          media_references: message.media
        }),
        timestamp
      );
      const record = getRecord.get(source.id, message.sourceCardIndex) as { id: number };
      for (const [displayOrder, media] of message.media.entries()) {
        const sourceMedia = database.prepare(`
          SELECT id FROM source_files WHERE snapshot_id = ? AND relative_path = ?
        `).get(snapshotId, media.relativePath) as { id: number } | undefined;
        // Keep references only when the media file was part of this discovered snapshot.
        if (!sourceMedia) {
          insertIssue(database, runId, source.id, 'warning', 'MESSAGE_MEDIA_NOT_IN_ARCHIVE',
            'A referenced attachment was not found in the discovered archive inventory.',
            { sourceCardIndex: message.sourceCardIndex, mediaPath: media.relativePath });
          continue;
        }
        const mediaKind = media.kind === 'other' ? 'unknown' : media.kind;
        insertAsset.run(snapshotId, sourceMedia.id, media.relativePath, mediaKind, timestamp);
        const asset = getAsset.get(snapshotId, media.relativePath) as { id: number };
        linkMedia.run(record.id, asset.id, displayOrder, media.element);
        mediaReferences += 1;
      }
    }

    for (const issue of parsed.issues) {
      const missing = issue.code === 'missing_message_content';
      insertIssue(database, runId, source.id, missing ? 'warning' : 'error',
        missing ? 'MESSAGE_CARD_EMPTY' : 'MESSAGE_CARDS_NOT_FOUND',
        missing ? 'A message card had no readable content or attachment.' : 'No recognized message cards were found.',
        { sourceCardIndex: issue.sourceCardIndex });
    }

    const unsupported = parsed.issues.some((issue) => issue.code === 'no_message_cards_found');
    database.prepare(`
      UPDATE source_files SET status = ?, record_count = ?, safe_error_code = ?, processed_at = ?
      WHERE id = ? AND snapshot_id = ?
    `).run(unsupported ? 'unsupported' : 'completed', parsed.messages.length,
      unsupported ? 'MESSAGE_CARDS_NOT_FOUND' : null, timestamp, source.id, snapshotId);
    database.prepare(`
      UPDATE import_runs SET status = 'completed', finished_at = ?, files_processed = 1,
        records_imported = ?, errors_count = ? WHERE id = ?
    `).run(timestamp, parsed.messages.length, unsupported ? 1 : 0, runId);
    database.exec('RELEASE messages_file_import');
    return { records: parsed.messages.length, media: mediaReferences, unsupported };
  } catch (error) {
    database.exec('ROLLBACK TO messages_file_import');
    database.exec('RELEASE messages_file_import');
    const failure = safeFailure(error);
    const timestamp = new Date().toISOString();
    database.exec('SAVEPOINT messages_file_failure');
    try {
      database.prepare(`
        UPDATE source_files SET status = 'failed', safe_error_code = ?, processed_at = ?
        WHERE id = ? AND snapshot_id = ?
      `).run(failure.code, timestamp, source.id, snapshotId);
      insertIssue(database, runId, source.id, 'error', failure.code, failure.message);
      database.prepare(`
        UPDATE import_runs SET status = 'failed', finished_at = ?, files_processed = 1, errors_count = 1
        WHERE id = ?
      `).run(timestamp, runId);
      database.exec('RELEASE messages_file_failure');
    } catch (writeError) {
      database.exec('ROLLBACK TO messages_file_failure');
      database.exec('RELEASE messages_file_failure');
      throw writeError;
    }
    throw new Error('The conversation file could not be imported. See the local import report.');
  }
}

/** Imports legacy HTML conversations and observed Accounts Center message_*.json chunks. */
export async function importMessagesSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<MessagesImportSectionResult> {
  const files = database.prepare(`
    SELECT id, relative_path, file_name, detected_format
    FROM source_files
    WHERE snapshot_id = ? AND section_key = 'messages'
      AND (
        (
          detected_format = 'html'
          AND (
            lower(relative_path) LIKE 'messages/inbox/%'
            OR lower(relative_path) LIKE 'messages/archived_threads/%'
            OR lower(relative_path) LIKE 'messages/filtered_threads/%'
            OR lower(relative_path) LIKE 'messages/message_requests/%'
          )
          AND (length(relative_path) - length(replace(relative_path, '/', ''))) = 3
        )
        OR (
          detected_format = 'json'
          AND lower(relative_path) LIKE 'your_facebook_activity/messages/%'
          AND lower(file_name) GLOB 'message_*.json'
        )
      )
      AND status IN ('discovered', 'failed', 'unsupported')
    ORDER BY relative_path
  `).all(snapshotId) as unknown as MessageSourceFileRow[];

  const summary: MessagesImportSectionResult = {
    filesAttempted: 0, recordsImported: 0, unsupportedFiles: 0, failedFiles: 0, mediaReferences: 0
  };

  const emitProgress = (phase: 'started' | 'progress' | 'completed') => reportImportProgress(onProgress, {
    sectionKey: 'messages',
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
    try {
      const result = await importOneConversation(database, snapshotId, file, archiveRoot);
      summary.recordsImported += result.records;
      summary.mediaReferences += result.media;
      if (result.unsupported) summary.unsupportedFiles += 1;
    } catch {
      summary.failedFiles += 1;
    }
    emitProgress('progress');
  }
  emitProgress('completed');
  return summary;
}
