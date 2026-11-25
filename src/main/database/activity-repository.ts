import type { DatabaseSync } from 'node:sqlite';
import type { ReactionRecordSummary } from '../../shared/archive/inspection';
import { facebookDateToUtc } from '../../shared/time/facebook-date';
import { normalizeSafeExternalUrl } from '../../shared/text/safe-external-url';

export function listReactionRecords(database: DatabaseSync, snapshotId: string): ReactionRecordSummary[] {
  return database.prepare(`
    SELECT records.id AS id, records.source_file_id AS sourceFileId,
      source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex,
      records.title AS reactionType, records.body_text AS descriptionRaw,
      records.event_time_raw AS dateRaw,
      records.event_time_utc AS eventTimeUtc
    FROM records
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE records.snapshot_id = ? AND records.section_key = 'likes_and_reactions'
    ORDER BY source.relative_path COLLATE NOCASE, records.source_record_index ASC
    LIMIT 1000
  `).all(snapshotId) as unknown as ReactionRecordSummary[];
}

export function listPostRecords(database: DatabaseSync, snapshotId: string): import('../../shared/archive/inspection').PostRecordSummary[] {
  return database.prepare(`
    SELECT records.id AS id, source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex,
      records.title AS activityRaw, records.body_text AS bodyRaw,
      records.event_time_raw AS dateRaw, records.event_time_utc AS eventTimeUtc,
      COUNT(record_media.media_asset_id) AS mediaCount
    FROM records
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    LEFT JOIN record_media ON record_media.record_id = records.id
    WHERE records.snapshot_id = ? AND records.section_key = 'posts'
    GROUP BY records.id
    ORDER BY source.relative_path COLLATE NOCASE, records.source_record_index ASC
    LIMIT 1000
  `).all(snapshotId) as unknown as import('../../shared/archive/inspection').PostRecordSummary[];
}

 
export function listCommentActivities(database: DatabaseSync, snapshotId: string): import('../../shared/archive/inspection').CommentActivitySummary[] {
  return database.prepare(`
    SELECT records.id AS id, source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex,
      records.title AS activityRaw, records.body_text AS bodyRaw,
      json_extract(records.payload_json, '$.group_raw') AS groupRaw,
      records.event_time_raw AS dateRaw, records.event_time_utc AS eventTimeUtc
    FROM records
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE records.snapshot_id = ? AND records.section_key = 'comments'
    ORDER BY source.relative_path COLLATE NOCASE, records.source_record_index ASC
    LIMIT 2000
  `).all(snapshotId) as unknown as import('../../shared/archive/inspection').CommentActivitySummary[];
}

export function listPhotoAlbums(
  database: DatabaseSync,
  snapshotId: string
): import('../../shared/archive/inspection').PhotoAlbumRecordSummary[] {
  return database.prepare(`
    SELECT records.id AS id,
      source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex,
      records.title AS albumTitle,
      json_extract(records.payload_json, '$.photo_count') AS photoCount,
      json_extract(records.payload_json, '$.album_path') AS albumPath,
      json_extract(records.payload_json, '$.cover_path') AS coverPath,
      cover_asset.id AS coverAssetId,
      records.event_time_raw AS dateRaw,
      COALESCE(detail_source.status, 'not_found') AS detailStatus,
      COUNT(photo_records.id) AS importedPhotoCount
    FROM records
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    LEFT JOIN source_files AS detail_source ON detail_source.snapshot_id = records.snapshot_id
      AND detail_source.relative_path = json_extract(records.payload_json, '$.album_path')
    LEFT JOIN media_assets AS cover_asset ON cover_asset.snapshot_id = records.snapshot_id
      AND cover_asset.relative_path = json_extract(records.payload_json, '$.cover_path')
    LEFT JOIN records AS photo_records ON photo_records.source_file_id = detail_source.id
      AND photo_records.snapshot_id = records.snapshot_id
      AND photo_records.section_key = 'photos_and_videos'
      AND photo_records.record_type = 'photo'
    WHERE records.snapshot_id = ? AND records.section_key = 'photos_and_videos'
      AND records.record_type = 'photo_album'
    GROUP BY records.id, detail_source.status
    ORDER BY source.relative_path COLLATE NOCASE, records.source_record_index ASC
    LIMIT 1000
  `).all(snapshotId) as unknown as import('../../shared/archive/inspection').PhotoAlbumRecordSummary[];
}

interface PhotoAlbumRow {
  id: number;
  albumTitle: string;
  albumPath: string;
}

interface PhotoRow {
  id: number;
  sourcePath: string;
  sourceCardIndex: number;
  albumTitle: string;
  imageAssetId: number | null;
  imagePath: string;
  originalPath: string | null;
  captionRaw: string | null;
  dateRaw: string | null;
  commentsJson: string | null;
}

function parsePhotoComments(value: string | null): import('../../shared/archive/inspection').PhotoAlbumCommentSummary[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): import('../../shared/archive/inspection').PhotoAlbumCommentSummary[] => {
      if (typeof entry !== 'object' || entry === null) return [];
      const comment = entry as Record<string, unknown>;
      const authorRaw = typeof comment.author_raw === 'string' ? comment.author_raw : null;
      const bodyRaw = typeof comment.body_raw === 'string' ? comment.body_raw : null;
      const dateRaw = typeof comment.date_raw === 'string' ? comment.date_raw : null;
      return [{ authorRaw, bodyRaw, dateRaw }];
    });
  } catch {
    return [];
  }
}

/** Loads one album's imported photo cards and their original comment metadata. */
export function getPhotoAlbumDetail(
  database: DatabaseSync,
  snapshotId: string,
  albumRecordId: number
): import('../../shared/archive/inspection').PhotoAlbumDetailView {
  if (!Number.isSafeInteger(albumRecordId) || albumRecordId < 1) {
    throw new Error('Invalid photo album selection.');
  }
  const album = database.prepare(`
    SELECT id, title AS albumTitle,
      json_extract(payload_json, '$.album_path') AS albumPath
    FROM records
    WHERE id = ? AND snapshot_id = ? AND section_key = 'photos_and_videos'
      AND record_type = 'photo_album'
  `).get(albumRecordId, snapshotId) as PhotoAlbumRow | undefined;
  if (!album || !album.albumPath) throw new Error('The selected album does not belong to this backup.');

  const detailFile = database.prepare(`
    SELECT id, status FROM source_files
    WHERE snapshot_id = ? AND relative_path = ? AND section_key = 'photos_and_videos'
  `).get(snapshotId, album.albumPath) as { id: number; status: string } | undefined;

  if (!detailFile) {
    return {
      albumRecordId: album.id,
      albumTitle: album.albumTitle,
      albumPath: album.albumPath,
      detailFileStatus: 'not_found',
      photos: []
    };
  }

  const rows = database.prepare(`
    SELECT photos.id AS id,
      source.relative_path AS sourcePath,
      photos.source_record_index AS sourceCardIndex,
      photos.title AS albumTitle,
      assets.id AS imageAssetId,
      json_extract(photos.payload_json, '$.image_path') AS imagePath,
      json_extract(photos.payload_json, '$.original_path') AS originalPath,
      photos.body_text AS captionRaw,
      photos.event_time_raw AS dateRaw,
      json_extract(photos.payload_json, '$.comments_raw') AS commentsJson
    FROM records AS photos
    INNER JOIN source_files AS source ON source.id = photos.source_file_id
      AND source.snapshot_id = photos.snapshot_id
    LEFT JOIN record_media AS links ON links.record_id = photos.id AND links.role = 'album_photo'
    LEFT JOIN media_assets AS assets ON assets.id = links.media_asset_id
      AND assets.snapshot_id = photos.snapshot_id
    WHERE photos.snapshot_id = ? AND photos.source_file_id = ?
      AND photos.section_key = 'photos_and_videos' AND photos.record_type = 'photo'
    ORDER BY photos.source_record_index ASC
    LIMIT 2000
  `).all(snapshotId, detailFile.id) as unknown as PhotoRow[];

  return {
    albumRecordId: album.id,
    albumTitle: album.albumTitle,
    albumPath: album.albumPath,
    detailFileStatus: detailFile.status,
    photos: rows.map((row) => ({
      id: row.id,
      sourcePath: row.sourcePath,
      sourceCardIndex: row.sourceCardIndex,
      albumTitle: row.albumTitle,
      imageAssetId: row.imageAssetId,
      imagePath: row.imagePath,
      originalPath: row.originalPath,
      captionRaw: row.captionRaw,
      dateRaw: row.dateRaw,
      comments: parsePhotoComments(row.commentsJson)
    }))
  };
}

interface EventPayload {
  event_key?: unknown;
  rsvp?: unknown;
  start_timestamp?: unknown;
  end_timestamp?: unknown;
  response_time?: unknown;
  place?: {
    name?: unknown;
    address?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  };
  url?: unknown;
}

function parseEventPayload(value: string): EventPayload {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed as EventPayload : {};
  } catch {
    return {};
  }
}

/** Lists unique Events merged from the separately exported response/invitation/hosting files. */
export function listEventRecords(
  database: DatabaseSync,
  snapshotId: string
): import('../../shared/archive/inspection').EventRecordSummary[] {
  const rows = database.prepare(`
    SELECT records.id AS id, records.title AS title, records.body_text AS description,
      records.event_time_raw AS startDateRaw, records.event_time_utc AS startDateUtc,
      source.relative_path AS sourcePath, records.source_record_index AS sourceCardIndex,
      records.payload_json AS payloadJson
    FROM records
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE records.snapshot_id = ? AND records.section_key = 'events'
      AND records.record_type = 'event'
    ORDER BY source.relative_path COLLATE NOCASE, records.source_record_index ASC
  `).all(snapshotId) as Array<{
    id: number;
    title: string;
    description: string | null;
    startDateRaw: string | null;
    startDateUtc: string | null;
    sourcePath: string;
    sourceCardIndex: number;
    payloadJson: string;
  }>;

  const priority: Record<string, number> = {
    joined: 0, hosted: 1, interested: 2, declined: 3, invited: 4, unknown: 5
  };
  const merged = new Map<string, import('../../shared/archive/inspection').EventRecordSummary>();

  for (const row of rows) {
    const payload = parseEventPayload(row.payloadJson);
    const eventKey = typeof payload.event_key === 'string' && payload.event_key
      ? payload.event_key
      : `record:${row.id}`;
    const rsvp = typeof payload.rsvp === 'string' ? payload.rsvp : 'unknown';
    const place = payload.place ?? {};
    const source = {
      sourcePath: row.sourcePath,
      sourceCardIndex: row.sourceCardIndex,
      recordId: row.id
    };
    const next: import('../../shared/archive/inspection').EventRecordSummary = {
      id: row.id,
      eventKey,
      title: row.title,
      description: row.description,
      startDateRaw: row.startDateRaw,
      startDateUtc: row.startDateUtc,
      endDateRaw: typeof payload.end_timestamp === 'string' ? payload.end_timestamp : null,
      endDateUtc: typeof payload.end_timestamp === 'string' ? facebookDateToUtc(payload.end_timestamp) : null,
      responseTimeRaw: typeof payload.response_time === 'string' ? payload.response_time : null,
      rsvp,
      locationName: typeof place.name === 'string' ? place.name : null,
      address: typeof place.address === 'string' ? place.address : null,
      latitude: typeof place.latitude === 'number' && Number.isFinite(place.latitude) ? place.latitude : null,
      longitude: typeof place.longitude === 'number' && Number.isFinite(place.longitude) ? place.longitude : null,
      url: normalizeSafeExternalUrl(payload.url),
      sources: [source]
    };

    const previous = merged.get(eventKey);
    if (!previous) {
      merged.set(eventKey, next);
      continue;
    }

    previous.sources.push(source);
    if ((priority[rsvp] ?? 10) < (priority[previous.rsvp] ?? 10)) {
      previous.rsvp = rsvp;
      previous.id = row.id;
    }
    previous.description ||= next.description;
    previous.startDateRaw ||= next.startDateRaw;
    previous.startDateUtc ||= next.startDateUtc;
    previous.endDateRaw ||= next.endDateRaw;
    previous.endDateUtc ||= next.endDateUtc;
    previous.responseTimeRaw ||= next.responseTimeRaw;
    previous.locationName ||= next.locationName;
    previous.address ||= next.address;
    previous.latitude ??= next.latitude;
    previous.longitude ??= next.longitude;
    previous.url ||= next.url;
  }

  return [...merged.values()].sort((left, right) => {
    if (left.startDateUtc && right.startDateUtc) return left.startDateUtc.localeCompare(right.startDateUtc);
    if (left.startDateUtc) return -1;
    if (right.startDateUtc) return 1;
    return left.title.localeCompare(right.title);
  });
}

