import type { DatabaseSync } from 'node:sqlite';
import type { MarketplaceListingSummary } from '../../shared/archive/inspection';

interface MarketplacePayload {
  listing_key?: unknown;
  facebook_id?: unknown;
  price?: unknown;
  category?: unknown;
  marketplace?: unknown;
  description?: unknown;
  location?: unknown;
}

function parsePayload(value: string): MarketplacePayload {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed as MarketplacePayload : {};
  } catch {
    return {};
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseLocation(value: unknown): {
  name: string | null; address: string | null; latitude: number | null; longitude: number | null;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { name: null, address: null, latitude: null, longitude: null };
  }
  const raw = value as Record<string, unknown>;
  return {
    name: nullableString(raw.name),
    address: nullableString(raw.address),
    latitude: typeof raw.latitude === 'number' && Number.isFinite(raw.latitude) ? raw.latitude : null,
    longitude: typeof raw.longitude === 'number' && Number.isFinite(raw.longitude) ? raw.longitude : null
  };
}

export function listMarketplaceListings(
  database: DatabaseSync,
  snapshotId: string
): MarketplaceListingSummary[] {
  const rows = database.prepare(`
    SELECT records.id AS id, records.title AS title, records.body_text AS body,
      records.event_time_raw AS dateRaw, records.event_time_utc AS dateUtc,
      records.payload_json AS payloadJson, source.relative_path AS sourcePath,
      source.file_name AS fileName, records.source_record_index AS sourceCardIndex
    FROM records
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE records.snapshot_id = ? AND records.section_key = 'marketplace'
      AND records.record_type = 'listing'
    ORDER BY source.relative_path COLLATE NOCASE, records.source_record_index ASC
  `).all(snapshotId) as Array<{
    id: number; title: string; body: string | null; dateRaw: string | null;
    dateUtc: string | null; payloadJson: string; sourcePath: string;
    fileName: string; sourceCardIndex: number;
  }>;

  const merged = new Map<string, MarketplaceListingSummary>();
  for (const row of rows) {
    const payload = parsePayload(row.payloadJson);
    const key = typeof payload.listing_key === 'string' && payload.listing_key
      ? payload.listing_key
      : 'record:' + row.id;
    const location = parseLocation(payload.location);
    const source = {
      sourcePath: row.sourcePath,
      sourceCardIndex: row.sourceCardIndex,
      recordId: row.id
    };
    const next: MarketplaceListingSummary = {
      id: row.id,
      listingKey: key,
      facebookId: nullableString(payload.facebook_id),
      title: row.title,
      price: nullableString(payload.price),
      description: nullableString(payload.description),
      category: nullableString(payload.category),
      marketplace: nullableString(payload.marketplace),
      listingDateRaw: row.dateRaw,
      listingDateUtc: row.dateUtc,
      locationName: location.name,
      address: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
      sources: [source]
    };

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, next);
      continue;
    }

    existing.sources.push(source);
    const isCleanListing = row.fileName.toLocaleLowerCase() === 'items_sold.json';
    if (isCleanListing) {
      existing.id = row.id;
      existing.title = row.title;
      existing.price ||= next.price;
      existing.description ||= next.description;
      existing.category ||= next.category;
      existing.marketplace ||= next.marketplace;
    } else {
      existing.facebookId ||= next.facebookId;
      existing.price ||= next.price;
      existing.description ||= next.description;
      existing.category ||= next.category;
      existing.marketplace ||= next.marketplace;
    }
    existing.listingDateRaw ||= next.listingDateRaw;
    existing.listingDateUtc ||= next.listingDateUtc;
    existing.locationName ||= next.locationName;
    existing.address ||= next.address;
    existing.latitude ??= next.latitude;
    existing.longitude ??= next.longitude;
  }

  return [...merged.values()].sort((left, right) => {
    if (left.listingDateUtc && right.listingDateUtc) return right.listingDateUtc.localeCompare(left.listingDateUtc);
    if (left.listingDateUtc) return -1;
    if (right.listingDateUtc) return 1;
    return left.title.localeCompare(right.title);
  });
}
