import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { listMarketplaceListings } from '../src/main/database/marketplace-repository';
import { listSavedItems } from '../src/main/database/saved-items-repository';
import { importMarketplaceJsonSection } from '../src/main/import/pipeline/marketplace-json-importer';
import { importSavedItemsJsonSection } from '../src/main/import/pipeline/saved-items-json-importer';

const migrationFiles = [
  '001_initial_schema.sql',
  '002_account_names.sql',
  '003_backfill_verified_event_times.sql',
  '004_backfill_fallback_parser_keys.sql',
  '005_media_metadata_scan_state.sql',
  '006_search_preferences.sql',
  '007_semantic_search.sql',
  '008_ai_assistant.sql'
];

const migrations = migrationFiles.map((fileName, index) => ({
  version: index + 1,
  name: fileName.slice(4, -4),
  sql: readFileSync(join(process.cwd(), 'src/main/database/migrations', fileName), 'utf8')
}));

describe('Marketplace and Saved Items JSON importers', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'marketplace-saved-test-'));
    const accountId = getOrCreateAccount(database, 'Synthetic Marketplace account');
    snapshotId = 'marketplace-saved-snapshot';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, 'Synthetic marketplace backup', 'directory', ?, 'discovered', ?, ?)
    `).run(snapshotId, accountId, root, now, now);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  async function addJsonFile(
    section: 'marketplace' | 'saved_items_and_collections',
    relativePath: string,
    fileName: string,
    value: unknown
  ): Promise<number> {
    const absolute = join(root, relativePath);
    await mkdir(join(absolute, '..'), { recursive: true });
    await writeFile(absolute, JSON.stringify(value), 'utf8');
    const now = new Date().toISOString();
    return Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, ?, ?, ?, 'json', 'discovered', ?)
    `).run(snapshotId, relativePath, fileName, section, now).lastInsertRowid);
  }

  it('merges clean Marketplace listings with their label-value FBID details', async () => {
    const listing = {
      title: 'Fallen City of Karez',
      price: '$50',
      seller: 'Synthetic Seller',
      created_timestamp: 1_791_220_991,
      category: 'Toys & Games',
      marketplace: 'Sample Marketplace',
      location: { coordinate: { latitude: 31.2001, longitude: 29.9187 } },
      description: 'Synthetic item description'
    };
    await addJsonFile('marketplace', 'your_facebook_activity/facebook_marketplace/items_sold.json',
      'items_sold.json', {
        items_selling_v2: [listing, { title: 'Unmatched second listing', price: '$5', created_timestamp: 1_791_230_000 }]
      });
    await addJsonFile('marketplace', 'your_facebook_activity/facebook_marketplace/your_marketplace_items.json',
      'your_marketplace_items.json', {
        fbid: '1505220154752693',
        media: [],
        label_values: [
          { label: 'Title', value: 'fallen city of karez' },
          { label: 'Creation time', timestamp_value: 1_791_220_991 }
        ]
      });

    const imported = await importMarketplaceJsonSection(database, snapshotId, root);
    expect(imported).toMatchObject({ filesAttempted: 2, recordsImported: 3, unsupportedFiles: 0, failedFiles: 0 });

    const listings = listMarketplaceListings(database, snapshotId);
    expect(listings).toHaveLength(2);
    const mergedListing = listings.find((item) => item.facebookId === '1505220154752693');
    expect(mergedListing).toBeDefined();
    expect(mergedListing).toMatchObject({
      facebookId: '1505220154752693',
      title: 'Fallen City of Karez',
      price: '$50',
      description: 'Synthetic item description',
      category: 'Toys & Games',
      marketplace: 'Sample Marketplace',
      listingDateRaw: '1791220991',
      locationName: null,
      latitude: 31.2001,
      longitude: 29.9187,
      sources: expect.arrayContaining([
        expect.objectContaining({ sourcePath: 'your_facebook_activity/facebook_marketplace/items_sold.json' }),
        expect.objectContaining({ sourcePath: 'your_facebook_activity/facebook_marketplace/your_marketplace_items.json' })
      ])
    });
    expect(listings.map((item) => item.title)).toContain('Unmatched second listing');
  });

  it('fills a missing listing description from the matched label-value details', async () => {
    await addJsonFile('marketplace', 'facebook_marketplace/items_sold.json', 'items_sold.json', {
      items_selling_v2: [{
        title: 'Description supplied by details',
        price: '$25',
        created_timestamp: 1_791_220_991
      }]
    });
    await addJsonFile('marketplace', 'your_facebook_activity/facebook_marketplace/your_marketplace_items.json',
      'your_marketplace_items.json', {
        fbid: 'synthetic-description-fbid',
        label_values: [
          { label: 'Title', value: 'Description supplied by details' },
          { label: 'Creation time', timestamp_value: 1_791_220_991 },
          { label: 'Description', value: 'Description recovered from the details file' }
        ]
      });

    await importMarketplaceJsonSection(database, snapshotId, root);

    expect(listMarketplaceListings(database, snapshotId)).toMatchObject([
      {
        title: 'Description supplied by details',
        facebookId: 'synthetic-description-fbid',
        description: 'Description recovered from the details file'
      }
    ]);
  });

  it('retains a listing record when the optional details file is absent', async () => {
    await addJsonFile('marketplace', 'facebook_marketplace/items_sold.json', 'items_sold.json', {
      items_selling_v2: [{ title: 'Standalone listing', price: '$10', created_timestamp: 1_791_220_991 }]
    });
    const result = await importMarketplaceJsonSection(database, snapshotId, root);
    expect(result.recordsImported).toBe(1);
    expect(listMarketplaceListings(database, snapshotId)).toMatchObject([
      { title: 'Standalone listing', price: '$10', facebookId: null }
    ]);
  });

  it('keeps unrecognized Marketplace listing structures for the generic fallback', async () => {
    await addJsonFile('marketplace', 'facebook_marketplace/items_sold.json', 'items_sold.json', {
      items_selling_v99: [{ title: 'Unknown synthetic marketplace entry' }]
    });
    const result = await importMarketplaceJsonSection(database, snapshotId, root);
    expect(result.unsupportedFiles).toBe(1);
    expect(database.prepare("SELECT status FROM source_files WHERE file_name = 'items_sold.json'").get())
      .toMatchObject({ status: 'unsupported' });
  });

  it('imports saves_v2 titles, external context and HTTP(S) links while rejecting unsafe schemes', async () => {
    await addJsonFile('saved_items_and_collections',
      'your_facebook_activity/saved_items_and_collections/your_saved_items.json',
      'your_saved_items.json', {
        saves_v2: [
          {
            timestamp: 1_760_227_200,
            title: 'Sample User saved a link.',
            attachments: [{ data: [{ external_context: {
              name: 'Sample meal-prep article',
              source: 'example.com',
              url: 'https://example.com/saved-article'
            } }] }]
          },
          {
            timestamp: 1_760_140_800,
            title: 'Sample User saved a video.',
            attachments: [{ data: [
              { external_context: { name: 'Saved video', url: 'https://www.facebook.com/watch/?v=12345' } },
              { external_context: { name: 'Unsafe link', url: 'javascript:alert(1)' } },
              { external_context: { name: 'Credential-bearing link', url: 'https://user:password@example.com/private' } }
            ] }]
          }
        ]
      });

    const result = await importSavedItemsJsonSection(database, snapshotId, root);
    expect(result).toMatchObject({ filesAttempted: 1, recordsImported: 2, unsupportedFiles: 0, failedFiles: 0 });
    const storedPayload = database.prepare(
      "SELECT payload_json AS payload FROM records WHERE snapshot_id = ? AND section_key = 'saved_items_and_collections' AND source_record_index = 1"
    ).get(snapshotId) as { payload: string };
    const storedContexts = (JSON.parse(storedPayload.payload) as { contexts: Array<{ name: string | null; url: string | null }> }).contexts;
    expect(storedContexts.find((context) => context.name === 'Credential-bearing link')?.url).toBeNull();

    const items = listSavedItems(database, snapshotId);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Sample User saved a link.',
      savedDateRaw: '1760227200',
      contexts: [{ name: 'Sample meal-prep article', source: 'example.com', url: 'https://example.com/saved-article' }],
      sourcePath: 'your_facebook_activity/saved_items_and_collections/your_saved_items.json'
    });
    expect(items[1].contexts).toEqual([
      { name: 'Saved video', url: 'https://www.facebook.com/watch/?v=12345', source: null },
      { name: 'Unsafe link', url: null, source: null },
      { name: 'Credential-bearing link', url: null, source: null }
    ]);
  });

  it('filters credential-bearing URLs from previously stored Saved Items payloads', async () => {
    const sourceFileId = await addJsonFile('saved_items_and_collections',
      'your_facebook_activity/saved_items_and_collections/legacy_saved_items.json',
      'legacy_saved_items.json', { saves_v2: [] });
    const now = new Date().toISOString();
    database.prepare(
      'INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type, ' +
      'title, body_text, normalized_text, event_time_raw, event_time_utc, sensitivity, search_enabled, payload_json, created_at) ' +
      "VALUES (?, ?, 0, 'saved_items_and_collections', 'saved_item', ?, NULL, NULL, NULL, NULL, 'personal', 1, ?, ?)"
    ).run(snapshotId, sourceFileId, 'Legacy saved item', JSON.stringify({
      contexts: [{ name: 'Legacy private URL', source: 'example.com', url: 'https://user:password@example.com/private' }]
    }), now);

    expect(listSavedItems(database, snapshotId)).toMatchObject([{
      title: 'Legacy saved item',
      contexts: [{ name: 'Legacy private URL', source: 'example.com', url: null }]
    }]);
  });

  it('keeps unknown Saved Items layouts in the generic fallback', async () => {
    await addJsonFile('saved_items_and_collections',
      'your_facebook_activity/saved_items_and_collections/your_saved_items.json',
      'your_saved_items.json', { saves_v9: [{ title: 'Unknown saved collection item' }] });
    const result = await importSavedItemsJsonSection(database, snapshotId, root);
    expect(result.unsupportedFiles).toBe(1);
    expect(database.prepare("SELECT status FROM source_files WHERE file_name = 'your_saved_items.json'").get())
      .toMatchObject({ status: 'unsupported' });
  });
});
