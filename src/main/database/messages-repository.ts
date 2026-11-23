import type { DatabaseSync } from 'node:sqlite';

export interface MessageConversationSummary {
  sourceFileId: number;
  relativePath: string;
  conversationType: string;
  messageCount: number;
  participants: string[];
}

export interface MessageMediaSummary {
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
    return {
      sourceFileId: row.sourceFileId,
      relativePath: row.relativePath,
      conversationType: parts[1] ?? 'unknown',
      messageCount: row.messageCount,
      participants
    };
  });
}

export function getMessageConversation(
  database: DatabaseSync,
  snapshotId: string,
  sourceFileId: number
): MessageRecordSummary[] {
  const source = database.prepare(`
    SELECT id FROM source_files
    WHERE id = ? AND snapshot_id = ? AND section_key = 'messages'
  `).get(sourceFileId, snapshotId) as { id: number } | undefined;
  if (!source) throw new Error('The selected conversation does not belong to this backup.');

  const rows = database.prepare(`
    SELECT id, source_record_index AS sourceCardIndex, title AS sender,
      body_text AS body, event_time_raw AS timestampRaw, payload_json AS payloadJson,
      record_type AS recordType
    FROM records
    WHERE source_file_id = ? AND snapshot_id = ? AND section_key = 'messages'
    ORDER BY source_record_index ASC
  `).all(sourceFileId, snapshotId) as unknown as MessageRow[];

  const mediaQuery = database.prepare(`
    SELECT assets.id AS id, assets.relative_path AS relativePath, assets.media_kind AS mediaKind,
      links.role AS role
    FROM record_media AS links
    INNER JOIN media_assets AS assets ON assets.id = links.media_asset_id
    WHERE links.record_id = ?
    ORDER BY links.display_order ASC
  `);

  return rows.map((row) => ({
    id: row.id,
    sourceCardIndex: row.sourceCardIndex,
    sender: row.sender,
    body: row.body,
    timestampRaw: row.timestampRaw,
    reactions: parseReactions(row.payloadJson),
    recordType: row.recordType,
    media: mediaQuery.all(row.id) as unknown as MessageMediaSummary[]
  }));
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
