import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { importMessagesSection } from '../src/main/import/pipeline/messages-importer';
import { getMessageConversation, listMessageConversations } from '../src/main/database/messages-repository';

describe('Messages conversation import', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    const migrations = [
      {
        version: 1,
        name: 'initial_schema',
        sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8')
      },
      {
        version: 2,
        name: 'unique_account_display_names',
        sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8')
      }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'messages-import-test-'));
    await mkdir(join(root, 'messages/inbox/thread-1/photos'), { recursive: true });
    await mkdir(join(root, 'messages/inbox/thread-1/audio'), { recursive: true });

    const accountId = getOrCreateAccount(database, 'Synthetic messages account');
    snapshotId = 'messages-snapshot-test';
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)
    `).run(snapshotId, accountId, 'Synthetic messages export', root, timestamp, timestamp);

    const addSource = database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, ?, ?, 'messages', ?, 'discovered', ?)
    `);
    addSource.run(snapshotId, 'messages/inbox/thread-1/thread.html', 'thread.html', 'html', timestamp);
    addSource.run(snapshotId, 'messages/inbox/thread-1/photos/photo.jpg', 'photo.jpg', 'image', timestamp);
    addSource.run(snapshotId, 'messages/inbox/thread-1/audio/clip.mp4', 'clip.mp4', 'video', timestamp);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('imports message content and local media references without indexing sensitive text', async () => {
    const html = `<!doctype html><html><head><base href="../../../"></head><body>
      <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
        <div class="_3-96 _2pio _2lek _2lel">Synthetic Sender</div>
        <div class="_3-96 _2let">
          Message Search Exclusion Needle
          <ul class="_tqp"><li>Like</li></ul>
          <img src="messages/inbox/thread-1/photos/photo.jpg">
          <audio src="messages/inbox/thread-1/audio/clip.mp4"></audio>
          <img src="https://example.invalid/external.jpg">
        </div>
        <div class="_3-94 _2lem">Raw message date</div>
      </div>
    </body></html>`;
    const htmlPath = join(root, 'messages/inbox/thread-1/thread.html');
    await writeFile(htmlPath, html, 'utf8');

    const result = await importMessagesSection(database, snapshotId, root);
    expect(result).toEqual({
      filesAttempted: 1,
      recordsImported: 1,
      unsupportedFiles: 0,
      failedFiles: 0,
      mediaReferences: 2
    });

    const record = database.prepare(`
      SELECT title, body_text, event_time_raw, sensitivity, search_enabled, payload_json
      FROM records WHERE snapshot_id = ?
    `).get(snapshotId) as {
      title: string; body_text: string; event_time_raw: string;
      sensitivity: string; search_enabled: number; payload_json: string;
    };
    expect(record).toMatchObject({
      title: 'Synthetic Sender',
      event_time_raw: 'Raw message date',
      sensitivity: 'sensitive',
      search_enabled: 0
    });
    expect(record.body_text).toContain('Message Search Exclusion Needle');
    expect(record.body_text).not.toContain('Like');
    expect(record.payload_json).toContain('"reactions_raw":["Like"]');
    expect(record.payload_json).toContain('"conversation_type":"inbox"');

    const media = database.prepare(`
      SELECT media_kind, relative_path FROM media_assets ORDER BY relative_path
    `).all() as Array<{ media_kind: string; relative_path: string }>;
    expect(media).toEqual([
      { media_kind: 'audio', relative_path: 'messages/inbox/thread-1/audio/clip.mp4' },
      { media_kind: 'image', relative_path: 'messages/inbox/thread-1/photos/photo.jpg' }
    ]);
    const links = database.prepare('SELECT COUNT(*) AS count FROM record_media').get() as { count: number };
    expect(links.count).toBe(2);

    const conversations = listMessageConversations(database, snapshotId);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      relativePath: 'messages/inbox/thread-1/thread.html',
      conversationType: 'inbox',
      messageCount: 1,
      participants: ['Synthetic Sender']
    });
    const displayedMessages = getMessageConversation(database, snapshotId, conversations[0].sourceFileId);
    expect(displayedMessages[0]).toMatchObject({
      sender: 'Synthetic Sender',
      body: expect.stringContaining('Message Search Exclusion Needle'),
      timestampRaw: 'Raw message date',
      reactions: ['Like'],
      media: expect.arrayContaining([
        expect.objectContaining({ mediaKind: 'audio' }),
        expect.objectContaining({ mediaKind: 'image' })
      ])
    });

    const indexed = database.prepare(
      "SELECT record_id FROM record_search WHERE record_search MATCH 'exclusion'"
    ).all();
    expect(indexed).toHaveLength(0);
    await expect(readFile(htmlPath, 'utf8')).resolves.toBe(html);
  });

  it('does not import arbitrary HTML outside conversation folders', async () => {
    database.prepare("UPDATE source_files SET status = 'completed' WHERE relative_path = 'messages/inbox/thread-1/thread.html'").run();
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, 'messages/your_messages.html', 'your_messages.html', 'messages', 'html', 'discovered', ?)
    `).run(snapshotId, timestamp);
    const result = await importMessagesSection(database, snapshotId, root);
    expect(result.filesAttempted).toBe(0);
  });

  it('marks an unrecognized conversation layout as unsupported', async () => {
    await writeFile(
      join(root, 'messages/inbox/thread-1/thread.html'),
      '<html><body><p>Unexpected structure</p></body></html>',
      'utf8'
    );
    const result = await importMessagesSection(database, snapshotId, root);
    expect(result).toMatchObject({ filesAttempted: 1, recordsImported: 0, unsupportedFiles: 1, failedFiles: 0 });
  });
});
