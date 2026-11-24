import type { DatabaseSync } from 'node:sqlite';
import { normalizeSearchText } from '../../shared/text/normalize';
import type { ArchiveMediaGalleryFilter, ArchiveMediaGalleryPage } from '../../shared/archive/media';
import { MESSAGE_CONVERSATION_PAGE_SIZE, type MessageConversationPage } from '../../shared/archive/messages';

export interface MessageConversationSummary {
  sourceFileId: number;
  relativePath: string;
  conversationType: string;
  messageCount: number;
  participants: string[];
}

export interface MessageMediaSummary {
  id: number;
  relativePath: string;
  mediaKind: string;
  role: string | null;
}

export interface MessageRecordSummary {
  id: number;
  sourceCardIndex: number;
  sender: string | null;
  body: string | null;
  timestampRaw: string | null;
  reactions: string[];
  recordType: string;
  media: MessageMediaSummary[];
}

interface ConversationRow {
  sourceFileId: number;
  relativePath: string;
  messageCount: number;
  participantsJson: string | null;
}

interface MessageRow {
  id: number;
  sourceCardIndex: number;
  sender: string | null;
  body: string | null;
  timestampRaw: string | null;
  payloadJson: string;
  recordType: string;
}

function parseReactions(payloadJson: string): string[] {
  try {
    const payload = JSON.parse(payloadJson) as { reactions_raw?: unknown };
    return Array.isArray(payload.reactions_raw)
      ? payload.reactions_raw.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function listMessageConversations(
  database: DatabaseSync,
  snapshotId: string
): MessageConversationSummary[] {
  const rows = database.prepare(`
    SELECT
      source.id AS sourceFileId,
      source.relative_path AS relativePath,
      COUNT(records.id) AS messageCount,
      (
        SELECT json_group_array(name) FROM (
          SELECT DISTINCT participant.title AS name
          FROM records AS participant
          WHERE participant.source_file_id = source.id
            AND participant.snapshot_id = source.snapshot_id
            AND participant.section_key = 'messages'
            AND participant.title IS NOT NULL
          ORDER BY name COLLATE NOCASE
        )
      ) AS participantsJson
    FROM source_files AS source
    INNER JOIN records ON records.source_file_id = source.id
      AND records.snapshot_id = source.snapshot_id
      AND records.section_key = 'messages'
    WHERE source.snapshot_id = ? AND source.section_key = 'messages'
    GROUP BY source.id, source.relative_path
    ORDER BY source.relative_path COLLATE NOCASE
  `).all(snapshotId) as unknown as ConversationRow[];

  return rows.map((row) => {
    let participants: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.participantsJson ?? '[]');
      if (Array.isArray(parsed)) participants = parsed.filter((value): value is string => typeof value === 'string');
    } catch {
      participants = [];
    }
    const parts = row.relativePath.split('/');
    const conversationType = parts[0]?.toLocaleLowerCase() === 'your_facebook_activity'
      ? parts[2]
      : parts[1];
    return {
      sourceFileId: row.sourceFileId,
      relativePath: row.relativePath,
      conversationType: conversationType ?? 'unknown',
      messageCount: row.messageCount,
      participants
    };
  });
}

export function getMessageConversation(
  database: DatabaseSync,
  snapshotId: string,
  sourceFileId: number,
  requestedPage = 1,
  searchQuery = ''
): MessageConversationPage {
  const source = database.prepare(`
    SELECT id FROM source_files
    WHERE id = ? AND snapshot_id = ? AND section_key = 'messages'
  `).get(sourceFileId, snapshotId) as { id: number } | undefined;
  if (!source) throw new Error('The selected conversation does not belong to this backup.');
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    throw new Error('The requested conversation page is invalid.');
  }
  if (typeof searchQuery !== 'string' || searchQuery.length > 120) {
    throw new Error('The conversation search query is invalid.');
  }

  // Query only the selected conversation; never populate the global message FTS index.
  const normalizedQuery = normalizeSearchText(searchQuery);
  const terms = [...new Set(normalizedQuery.match(/[\\p{L}\\p{N}_]+/gu) ?? [])];
  const searchClause = searchQuery.trim().length === 0
    ? ''
    : terms.length === 0
      ? 'AND 0 = 1'
      : terms.map(() => "AND instr(COALESCE(normalized_text, ''), ?) > 0").join('\\n      ');
  const baseWhere = `
    source_file_id = ? AND snapshot_id = ? AND section_key = 'messages'
    ${searchClause}
  `;
  const parameters = [sourceFileId, snapshotId, ...terms];
  const totalRow = database.prepare(`
    SELECT COUNT(*) AS total FROM records WHERE ${baseWhere}
  `).get(...parameters) as { total: number };
  const total = Number(totalRow.total);
  const maxPage = Math.max(1, Math.ceil(total / MESSAGE_CONVERSATION_PAGE_SIZE));
  const page = Math.min(requestedPage, maxPage);
  const rows = database.prepare(`
    SELECT id, source_record_index AS sourceCardIndex, title AS sender,
      body_text AS body, event_time_raw AS timestampRaw, payload_json AS payloadJson,
      record_type AS recordType
    FROM records
    WHERE ${baseWhere}
    ORDER BY source_record_index ASC, id ASC
    LIMIT ? OFFSET ?
  `).all(
    ...parameters, MESSAGE_CONVERSATION_PAGE_SIZE,
    (page - 1) * MESSAGE_CONVERSATION_PAGE_SIZE
  ) as unknown as MessageRow[];

  const mediaByRecord = new Map<number, MessageMediaSummary[]>();
  if (rows.length > 0) {
    const placeholders = rows.map(() => '?').join(', ');
    const mediaRows = database.prepare(`
      SELECT links.record_id AS recordId, assets.id AS id,
        assets.relative_path AS relativePath, assets.media_kind AS mediaKind,
        links.role AS role
      FROM record_media AS links
      INNER JOIN media_assets AS assets ON assets.id = links.media_asset_id
      WHERE links.record_id IN (${placeholders})
      ORDER BY links.record_id ASC, links.display_order ASC
    `).all(...rows.map((row) => row.id)) as unknown as Array<
      MessageMediaSummary & { recordId: number }
    >;
    for (const media of mediaRows) {
      const current = mediaByRecord.get(media.recordId) ?? [];
      current.push({ id: media.id, relativePath: media.relativePath, mediaKind: media.mediaKind, role: media.role });
      mediaByRecord.set(media.recordId, current);
    }
  }

  return {
    records: rows.map((row) => ({
      id: row.id,
      sourceCardIndex: row.sourceCardIndex,
      sender: row.sender,
      body: row.body,
      timestampRaw: row.timestampRaw,
      reactions: parseReactions(row.payloadJson),
      recordType: row.recordType,
      media: mediaByRecord.get(row.id) ?? []
    })),
    page,
    pageSize: MESSAGE_CONVERSATION_PAGE_SIZE,
    total
  };
}

export function listMessageMediaGallery(
  database: DatabaseSync,
  snapshotId: string
): Array<{
  id: number; relativePath: string; mediaKind: string; role: string | null;
  sourceFileId: number; conversationPath: string; sender: string | null;
  timestampRaw: string | null; body: string | null;
}> {
  return database.prepare(`
    SELECT assets.id AS id, assets.relative_path AS relativePath,
      assets.media_kind AS mediaKind, links.role AS role,
      source.id AS sourceFileId, source.relative_path AS conversationPath,
      records.title AS sender, records.event_time_raw AS timestampRaw,
      records.body_text AS body
    FROM media_assets AS assets
    INNER JOIN record_media AS links ON links.media_asset_id = assets.id
    INNER JOIN records ON records.id = links.record_id
    INNER JOIN source_files AS source ON source.id = records.source_file_id
    WHERE assets.snapshot_id = ? AND records.snapshot_id = ?
      AND records.section_key = 'messages'
    ORDER BY source.relative_path COLLATE NOCASE,
      records.source_record_index ASC, links.display_order ASC
    LIMIT 300
  `).all(snapshotId, snapshotId) as Array<{
    id: number; relativePath: string; mediaKind: string; role: string | null;
    sourceFileId: number; conversationPath: string; sender: string | null;
    timestampRaw: string | null; body: string | null;
  }>;
}

 
/**
 * Lists one page of distinct discovered media files. Multiple records may
 * reference the same asset; the gallery shows that file once and selects its
 * first stable association for context. Filtering and pagination run in SQLite
 * so large backups do not require loading the entire media inventory in React.
 */
export function listArchiveMediaGallery(
  database: DatabaseSync,
  snapshotId: string,
  filter: ArchiveMediaGalleryFilter = 'all',
  requestedPage = 1,
  searchQuery = '',
  requestedPageSize = 100
): ArchiveMediaGalleryPage {
  const pageSize = [50, 100, 250].includes(requestedPageSize) ? requestedPageSize : 100;
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(1_000_000, requestedPage)) : 1;
  const query = searchQuery.trim().slice(0, 180);
  const totalRow = database.prepare(`
    SELECT COUNT(*) AS total
    FROM media_assets
    WHERE snapshot_id = ? AND (? = 'all' OR media_kind = ?)
      AND (? = '' OR instr(lower(relative_path), lower(?)) > 0)
  `).get(snapshotId, filter, filter, query, query) as { total: number };
  const total = Number(totalRow.total);
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, maxPage);

  const items = database.prepare(`
    WITH primary_links AS (
      SELECT media_asset_id, record_id, role,
        ROW_NUMBER() OVER (
          PARTITION BY media_asset_id
          ORDER BY display_order ASC, record_id ASC
        ) AS link_rank
      FROM record_media
    )
    SELECT assets.id AS id, records.id AS recordId,
      assets.relative_path AS relativePath, assets.media_kind AS mediaKind,
      links.role AS role, media_source.id AS sourceFileId,
      COALESCE(media_source.relative_path, assets.relative_path) AS sourcePath,
      COALESCE(records.section_key, media_source.section_key, 'other') AS sectionKey,
      records.record_type AS recordType, records.source_record_index AS sourceCardIndex,
      records.title AS title, records.body_text AS body,
      records.event_time_raw AS timestampRaw,
      assets.width AS width, assets.height AS height, assets.duration_ms AS durationMs
    FROM media_assets AS assets
    LEFT JOIN source_files AS media_source ON media_source.id = assets.source_file_id
      AND media_source.snapshot_id = assets.snapshot_id
    LEFT JOIN primary_links AS links ON links.media_asset_id = assets.id AND links.link_rank = 1
    LEFT JOIN records ON records.id = links.record_id AND records.snapshot_id = assets.snapshot_id
    WHERE assets.snapshot_id = ? AND (? = 'all' OR assets.media_kind = ?)
      AND (? = '' OR instr(lower(assets.relative_path), lower(?)) > 0)
    ORDER BY sourcePath COLLATE NOCASE, assets.relative_path COLLATE NOCASE, assets.id ASC
    LIMIT ? OFFSET ?
  `).all(snapshotId, filter, filter, query, query, pageSize, (safePage - 1) * pageSize);

  return {
    items: items as unknown as ArchiveMediaGalleryPage['items'],
    page: safePage,
    pageSize,
    total
  };
}
