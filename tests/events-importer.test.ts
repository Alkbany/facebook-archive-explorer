import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { listEventRecords } from '../src/main/database/activity-repository';
import { importEventsJsonSection } from '../src/main/import/pipeline/events-json-importer';
import { importJsonFilesSection } from '../src/main/import/pipeline/json-importer';

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

describe('Accounts Center Events JSON importer', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'events-import-test-'));
    const accountId = getOrCreateAccount(database, 'Synthetic Events account');
    snapshotId = 'events-snapshot-test';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, 'Synthetic Events backup', 'directory', ?, 'discovered', ?, ?)
    `).run(snapshotId, accountId, root, now, now);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  async function addJsonFile(relativePath: string, fileName: string, content: unknown): Promise<number> {
    const absolutePath = join(root, relativePath);
    await mkdir(join(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, '\uFEFF' + JSON.stringify(content), 'utf8');
    const now = new Date().toISOString();
    return Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, ?, ?, 'events', 'json', 'discovered', ?)
    `).run(snapshotId, relativePath, fileName, now).lastInsertRowid);
  }

  it('imports joined, interested, declined, invited and hosted entries and merges duplicate source records', async () => {
    const event = {
      name: 'Synthetic Community Meetup',
      start_timestamp: 1_800_000_000,
      end_timestamp: 1_800_003_600,
      description: 'A synthetic event description',
      response_time: 1_799_000_000,
      place: {
        name: 'Synthetic Hall',
        address: '1 Example Street',
        coordinate: { latitude: 31.2001, longitude: 29.9187 }
      },
      url: 'https://www.facebook.com/events/123456789/'
    };

    await addJsonFile(
      'your_facebook_activity/events/your_event_responses.json',
      'your_event_responses.json',
      { event_responses_v2: {
        events_joined: [event],
        events_interested: [{ ...event, description: null }],
        events_declined: [{ ...event, name: 'A declined synthetic event', start_timestamp: 1_800_100_000 }]
      } }
    );
    await addJsonFile(
      'your_facebook_activity/events/event_invitations.json',
      'event_invitations.json',
      { events_invited_v2: [event, { ...event, name: 'An unanswered synthetic invitation', start_timestamp: 1_800_200_000 }] }
    );
    await addJsonFile(
      'your_facebook_activity/events/your_events.json',
      'your_events.json',
      { your_events_v2: [{ ...event, description: 'Description from hosted copy' }] }
    );

    const result = await importEventsJsonSection(database, snapshotId, root);
    expect(result).toMatchObject({
      filesAttempted: 3,
      recordsImported: 6,
      unsupportedFiles: 0,
      failedFiles: 0
    });

    const events = listEventRecords(database, snapshotId);
    expect(events).toHaveLength(4);
    expect(events.find((item) => item.title === 'Synthetic Community Meetup')).toMatchObject({
      rsvp: 'joined',
      description: 'A synthetic event description',
      startDateRaw: '1800000000',
      startDateUtc: '2027-01-15T08:00:00.000Z',
      endDateRaw: '1800003600',
      locationName: 'Synthetic Hall',
      address: '1 Example Street',
      latitude: 31.2001,
      longitude: 29.9187,
      url: 'https://www.facebook.com/events/123456789/',
      sources: expect.arrayContaining([
        expect.objectContaining({ sourcePath: 'your_facebook_activity/events/your_event_responses.json' }),
        expect.objectContaining({ sourcePath: 'your_facebook_activity/events/your_events.json' }),
        expect.objectContaining({ sourcePath: 'your_facebook_activity/events/event_invitations.json' })
      ])
    });
    expect(events.find((item) => item.title === 'A declined synthetic event')?.rsvp).toBe('declined');
    expect(events.find((item) => item.title === 'An unanswered synthetic invitation')?.rsvp).toBe('invited');
  });

  it('reads label-value hosted events but never uses the Event host Name as the event title', async () => {
    await addJsonFile(
      'your_facebook_activity/events/events_you_hosted.json',
      'events_you_hosted.json',
      [{
        timestamp: 1,
        label_values: [
          {
            title: 'Event',
            dict: [
              { label: 'Name', value: 'Synthetic Label Event' },
              { label: 'Start time', timestamp_value: 1_800_000_000 },
              { label: 'Description', value: 'Synthetic label event details' },
              { label: 'URL', href: 'https://www.facebook.com/events/987654321/' }
            ]
          },
          {
            title: 'Event host',
            dict: [{ label: 'Name', value: 'Must Not Become Event Title' }]
          }
        ]
      }]
    );

    const result = await importEventsJsonSection(database, snapshotId, root);
    expect(result.recordsImported).toBe(1);
    expect(listEventRecords(database, snapshotId)).toMatchObject([{
      title: 'Synthetic Label Event',
      description: 'Synthetic label event details',
      rsvp: 'hosted',
      url: 'https://www.facebook.com/events/987654321/'
    }]);
  });

  it('keeps an unknown Events JSON layout unsupported so the generic JSON fallback can preserve it', async () => {
    await addJsonFile(
      'your_facebook_activity/events/event_history_v99.json',
      'event_history_v99.json',
      { unknown_events_v99: [{ event_name: 'Unknown synthetic event shape' }] }
    );
    await addJsonFile(
      'your_facebook_activity/events/your_event_responses.json',
      'your_event_responses.json',
      { event_responses_v2: 'unknown-shape' }
    );

    const result = await importEventsJsonSection(database, snapshotId, root);
    expect(result.unsupportedFiles).toBe(1);
    expect(database.prepare("SELECT status FROM source_files WHERE file_name = 'your_event_responses.json'").get())
      .toMatchObject({ status: 'unsupported' });

    // Unknown file names and structures are left to the generic JSON fallback.
    const fallback = await importJsonFilesSection(database, snapshotId, root);
    expect(fallback.filesAttempted).toBe(2);
    expect(fallback.recordsImported).toBeGreaterThan(0);
  });

  it('replaces outdated event records on retry but keeps the last good records when reading fails', async () => {
    const relativePath = 'your_facebook_activity/events/your_events.json';
    const fileId = await addJsonFile(relativePath, 'your_events.json', {
      your_events_v2: [{
        name: 'Synthetic event before retry',
        start_timestamp: 1_800_000_000
      }]
    });

    expect((await importEventsJsonSection(database, snapshotId, root)).recordsImported).toBe(1);
    await writeFile(join(root, relativePath), JSON.stringify({
      your_events_v2: [{
        name: 'Synthetic event after retry',
        start_timestamp: 1_800_100_000
      }]
    }), 'utf8');
    database.prepare("UPDATE source_files SET status = 'failed' WHERE id = ?").run(fileId);
    expect((await importEventsJsonSection(database, snapshotId, root)).recordsImported).toBe(1);
    expect(listEventRecords(database, snapshotId).map((item) => item.title)).toEqual(['Synthetic event after retry']);

    await rm(join(root, relativePath));
    database.prepare("UPDATE source_files SET status = 'failed' WHERE id = ?").run(fileId);
    const failed = await importEventsJsonSection(database, snapshotId, root);
    expect(failed.failedFiles).toBe(1);
    expect(listEventRecords(database, snapshotId).map((item) => item.title)).toEqual(['Synthetic event after retry']);
  });
});
