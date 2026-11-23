import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { load } from 'cheerio';
import type { ImportProgressEvent } from '../../../shared/archive/inspection';
import { getArchiveSection } from '../../../shared/archive/section-registry';
import { normalizeSearchText } from '../../../shared/text/normalize';
import { ArchiveReadError, readArchiveUtf8File } from '../discovery/read-archive-file';
import { waitIfImportPaused } from '../../ipc/import-operation-lock';
import { reportImportProgress, type ImportProgressReporter } from './import-progress';

interface HtmlSourceFile {
  id: number;
  relative_path: string;
  file_size_bytes: number | null;
  section_key: string;
}

export interface HtmlFallbackImportSectionResult {
  filesAttempted: number;
  recordsImported: number;
  unsupportedFiles: number;
  failedFiles: number;
}

const MAX_HTML_FILE_BYTES = 20 * 1024 * 1024;
const MAX_HTML_RECORDS_PER_FILE = 5000;
const MAX_HTML_TEXT_LENGTH = 20_000;
const HTML_NOISE_SELECTOR = 'script, style, noscript, svg, button, input, select, textarea, template, [hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"], [style*="visibility:hidden"], [style*="visibility: hidden"]';

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/gu, ' ')
    .replace(/\r/gu, '')
    .replace(/[\t ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, MAX_HTML_TEXT_LENGTH);
}

function extractElementText($: any, element: any): string {
  const clone = $(element).clone();
  clone.find(HTML_NOISE_SELECTOR).remove();
  clone.find('br').replaceWith('\n');
  clone.find('p, div, li, section, h1, h2, h3, h4, blockquote').each((_index: number, child: any) => {
    $(child).after('\n');
  });
  return cleanText(clone.text());
}

function rawDate($: any, element: any): string | null {
  const localDate = $(element).find('time[datetime]').first().attr('datetime')
    ?? $(element).find('meta[property="article:published_time"]').first().attr('content');
  if (localDate && localDate.trim()) return localDate.trim().slice(0, 500);

  const documentDate = $('meta[property="article:published_time"], meta[property="og:updated_time"]')
    .first().attr('content');
  return documentDate?.trim().slice(0, 500) || null;
}

function makeHtmlItems(html: string): Array<{ element: string; title: string | null; text: string; dateRaw: string | null }> {
  const $ = load(html);
  const body: any = $('body').length > 0 ? $('body') : $.root();
  const candidateSelector = 'article, [role="article"], li, .pam';
  const candidates = body.find(candidateSelector).toArray();
  const topLevelCandidates = candidates.filter((element: any) =>
    $(element).parents(candidateSelector).length === 0
  );
  const elements = topLevelCandidates.length > 0
    ? topLevelCandidates
    : body.find('h1, h2, h3, h4, p, blockquote').toArray();

  const items: Array<{ element: string; title: string | null; text: string; dateRaw: string | null }> = [];
  const seenText = new Set<string>();
  const append = (element: any | null, text: string) => {
    const normalized = cleanText(text);
    if (!normalized || seenText.has(normalized)) return;
    seenText.add(normalized);
    const node = element ? $(element) : null;
    const heading = node?.find('h1, h2, h3, h4, strong').first().text();
    const ownHeading = node && element?.type === 'tag' && /^h[1-4]$/u.test(element.tagName.toLocaleLowerCase())
      ? node.text()
      : '';
    const title = cleanText(ownHeading || heading || '').slice(0, 200) || null;
    const tagName = element?.type === 'tag' ? element.tagName.toLocaleLowerCase() : 'document';
    items.push({
      element: tagName,
      title,
      text: normalized,
      dateRaw: node && element ? rawDate($, element) : rawDate($, $.root().get(0))
    });
  };

  for (const element of elements.slice(0, MAX_HTML_RECORDS_PER_FILE)) {
    append(element, extractElementText($, element));
  }

  if (items.length === 0) {
    const text = extractElementText($, body.get(0) ?? $.root().get(0));
    if (text) append(null, text);
  }
  return items;
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

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ArchiveReadError) {
    return { code: error.code, message: 'The HTML source file could not be safely read from the selected archive.' };
  }
  return { code: 'HTML_FALLBACK_FAILED', message: 'The HTML source file could not be converted into safe text records.' };
}

async function importHtmlFile(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  file: HtmlSourceFile
): Promise<number> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered)
    VALUES (?, ?, 'import', 'running', ?, 1)
  `).run(runId, snapshotId, startedAt);
  database.prepare(`
    UPDATE source_files SET status = 'processing', safe_error_code = NULL
    WHERE id = ? AND snapshot_id = ?
  `).run(file.id, snapshotId);

  database.exec('SAVEPOINT html_fallback_file');
  try {
    if (file.file_size_bytes !== null && file.file_size_bytes > MAX_HTML_FILE_BYTES) {
      throw new ArchiveReadError('FILE_TOO_LARGE');
    }
    const html = await readArchiveUtf8File(archiveRoot, file.relative_path, MAX_HTML_FILE_BYTES);
    const items = makeHtmlItems(html);
    const section = getArchiveSection(file.section_key);
    const sensitivity = section?.sensitivity ?? 'sensitive';
    const searchEnabled = sensitivity === 'sensitive' ? 0 : 1;
    const createdAt = new Date().toISOString();
    const insertRecord = database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, event_time_raw, event_time_utc,
        sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, ?, ?, 'html_item', ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      ON CONFLICT(source_file_id, source_record_index) DO UPDATE SET
        section_key = excluded.section_key,
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

    for (const [index, item] of items.entries()) {
      const payload = JSON.stringify({ element: item.element, text: item.text });
      const title = item.title ?? (index === 0 ? file.relative_path : 'Entry ' + (index + 1));
      const normalized = searchEnabled
        ? normalizeSearchText([title, item.text].filter(Boolean).join(' '))
        : null;
      insertRecord.run(
        snapshotId, file.id, index, file.section_key, title, item.text,
        normalized, item.dateRaw, sensitivity, searchEnabled, payload, createdAt
      );
    }

    const timestamp = new Date().toISOString();
    database.prepare(`
      UPDATE source_files
      SET status = ?, parser_key = 'html_fallback', record_count = ?,
        safe_error_code = NULL, processed_at = ?
      WHERE id = ? AND snapshot_id = ?
    `).run(items.length === 0 ? 'empty' : 'completed', items.length, timestamp, file.id, snapshotId);

    if (items.length >= MAX_HTML_RECORDS_PER_FILE) {
      insertIssue(database, runId, file.id, 'warning', 'HTML_RECORD_LIMIT_REACHED',
        'The HTML file exceeded the maximum number of text blocks imported from one source file.',
        { maximumRecords: MAX_HTML_RECORDS_PER_FILE });
    }
    database.prepare(`
      UPDATE import_runs SET status = 'completed', finished_at = ?, files_processed = 1,
        records_imported = ? WHERE id = ?
    `).run(timestamp, items.length, runId);
    database.exec('RELEASE html_fallback_file');
    return items.length;
  } catch (error) {
    database.exec('ROLLBACK TO html_fallback_file');
    database.exec('RELEASE html_fallback_file');
    const failure = safeFailure(error);
    const timestamp = new Date().toISOString();
    database.prepare(`
      UPDATE source_files SET status = 'failed', safe_error_code = ?, processed_at = ?
      WHERE id = ? AND snapshot_id = ?
    `).run(failure.code, timestamp, file.id, snapshotId);
    insertIssue(database, runId, file.id, 'error', failure.code, failure.message);
    database.prepare(`
      UPDATE import_runs SET status = 'failed', finished_at = ?, files_processed = 1, errors_count = 1
      WHERE id = ?
    `).run(timestamp, runId);
    throw new Error('An HTML file could not be imported. See the local import report.');
  }
}

/**
 * Generic HTML fallback for files not covered by a reviewed importer.
 * It extracts bounded visible text while leaving original files untouched.
 * Sensitive and unknown sections are persisted locally but never indexed.
 */
export async function importHtmlFallbackFilesSection(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string,
  onProgress?: ImportProgressReporter
): Promise<HtmlFallbackImportSectionResult> {
  const files = database.prepare(`
    SELECT id, relative_path, file_size_bytes, section_key
    FROM source_files
    WHERE snapshot_id = ? AND detected_format = 'html'
      AND status IN ('discovered', 'failed', 'unsupported')
      AND section_key NOT IN (
        'friends', 'messages', 'posts', 'comments', 'likes_and_reactions', 'photos_and_videos'
      )
    ORDER BY section_key COLLATE NOCASE, relative_path COLLATE NOCASE
  `).all(snapshotId) as unknown as HtmlSourceFile[];

  const summary: HtmlFallbackImportSectionResult = {
    filesAttempted: 0, recordsImported: 0, unsupportedFiles: 0, failedFiles: 0
  };
  if (files.length === 0) return summary;

  const emitProgress = (phase: ImportProgressEvent['phase']) => reportImportProgress(onProgress, {
    sectionKey: 'html_fallback',
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
      summary.recordsImported += await importHtmlFile(database, snapshotId, archiveRoot, file);
    } catch {
      summary.failedFiles += 1;
    }
    emitProgress('progress');
  }
  emitProgress('completed');
  return summary;
}
