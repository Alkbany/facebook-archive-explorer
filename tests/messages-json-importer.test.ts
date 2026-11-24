import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { getMessageConversation, listMessageConversations } from '../src/main/database/messages-repository';
import { importMessagesSection } from '../src/main/import/pipeline/messages-importer';

describe('TNG Messenger JSON importer', () => {
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
    root = await mkdtemp(join(tmpdir(), 'messages-json-import-test-'));
    const conversationDirectory = join(root, 'your_facebook_activity', 'messages', 'inbox', 'williamriker_1000000001');
    const photoDirectory = join(conversationDirectory, 'photos');
    const stickerDirectory = join(root, 'your_facebook_activity', 'messages', 'stickers_used');
    await mkdir(photoDirectory, { recursive: true });
    await mkdir(stickerDirectory, { recursive: true });

    const accountId = getOrCreateAccount(database, 'Synthetic TNG Messenger account');
    snapshotId = 'messages-json-snapshot';
    const now = new Date().toISOString();
    database.prepare(
      "INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at) " +
      "VALUES (?, ?, 'Synthetic TNG Messenger export', 'directory', ?, 'discovered', ?, ?)"
    ).run(snapshotId, accountId, root, now, now);

    const conversationPath = 'your_facebook_activity/messages/inbox/williamriker_1000000001/message_1.json';
    const source = {
      participants: [{ name: 'William Riker' }, { name: 'Jean-Luc Picard' }],
      title: 'William Riker',
      thread_path: 'inbox/williamriker_1000000001',
      messages: [
        {
          sender_name: 'Jean-Luc Picard',
          timestamp_ms: 12600000480000,
          content: 'Engage.',
          reactions: [{ reaction: '❤️', actor: 'William Riker' }],
          share: { link: 'https://private.example/share', share_text: 'A private share description.' }
        },
        {
          sender_name: 'William Riker',
          timestamp_ms: 12600000420000,
          photos: [{ uri: 'your_facebook_activity/messages/inbox/williamriker_1000000001/photos/photo.jpg' }]
        },
        {
          sender_name: 'William Riker',
          timestamp_ms: 12600000360000,
          sticker: { uri: 'your_facebook_activity/messages/stickers_used/sticker.png' }
        }
      ]
    };
    await writeFile(join(root, conversationPath), '\uFEFF' + JSON.stringify(source), 'utf8');
    database.prepare(
      "INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, file_size_bytes, status, discovered_at) " +
      "VALUES (?, ?, 'message_1.json', 'messages', 'json', ?, 'discovered', ?)"
    ).run(snapshotId, conversationPath, Buffer.byteLength(JSON.stringify(source), 'utf8') + 3, now);

    const photoPath = 'your_facebook_activity/messages/inbox/williamriker_1000000001/photos/photo.jpg';
    const stickerPath = 'your_facebook_activity/messages/stickers_used/sticker.png';
    await writeFile(join(root, photoPath), Buffer.from([0xff, 0xd8, 0xff]));
    await writeFile(join(root, stickerPath), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    database.prepare(
      "INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) " +
      "VALUES (?, ?, 'photo.jpg', 'messages', 'image', 'discovered', ?)"
    ).run(snapshotId, photoPath, now);
    database.prepare(
      "INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) " +
      "VALUES (?, ?, 'sticker.png', 'messages', 'image', 'discovered', ?)"
    ).run(snapshotId, stickerPath, now);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('imports JSON chunks into the existing conversation viewer and links discovered local media', async () => {
    const result = await importMessagesSection(database, snapshotId, root);
    expect(result).toEqual({
      filesAttempted: 1,
      recordsImported: 3,
      unsupportedFiles: 0,
      failedFiles: 0,
      mediaReferences: 2
    });

    const conversations = listMessageConversations(database, snapshotId);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      relativePath: 'your_facebook_activity/messages/inbox/williamriker_1000000001/message_1.json',
      conversationType: 'inbox',
      messageCount: 3,
      participants: ['Jean-Luc Picard', 'William Riker']
    });

    const messages = getMessageConversation(database, snapshotId, conversations[0].sourceFileId);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      sender: 'Jean-Luc Picard',
      body: 'Engage.\nA private share description.',
      timestampRaw: '12600000480000',
      reactions: ['❤️']
    });
    expect(messages[1].media).toEqual([
      expect.objectContaining({ relativePath: 'your_facebook_activity/messages/inbox/williamriker_1000000001/photos/photo.jpg', mediaKind: 'image' })
    ]);
    expect(messages[2].media).toEqual([
      expect.objectContaining({ relativePath: 'your_facebook_activity/messages/stickers_used/sticker.png', mediaKind: 'sticker' })
    ]);

    const sensitive = database.prepare(
      "SELECT sensitivity, search_enabled FROM records WHERE snapshot_id = ?"
    ).all(snapshotId) as Array<{ sensitivity: string; search_enabled: number }>;
    expect(sensitive.every((row) => row.sensitivity === 'sensitive' && row.search_enabled === 0)).toBe(true);
    expect(database.prepare('SELECT COUNT(*) AS count FROM record_search').get()).toMatchObject({ count: 0 });
    const links = database.prepare('SELECT COUNT(*) AS count FROM record_media').get() as { count: number };
    expect(links.count).toBe(2);
  });

  it('leaves unknown message JSON structures available for the generic fallback', async () => {
    const path = 'your_facebook_activity/messages/inbox/williamriker_1000000001/message_1.json';
    await writeFile(join(root, path), JSON.stringify({ conversation_items: [{ text: 'Unknown message shape' }] }), 'utf8');
    const result = await importMessagesSection(database, snapshotId, root);
    expect(result).toMatchObject({ filesAttempted: 1, recordsImported: 0, unsupportedFiles: 1, failedFiles: 0 });
    expect(database.prepare(
      'SELECT status FROM source_files WHERE snapshot_id = ? AND relative_path = ?'
    ).get(snapshotId, path)).toMatchObject({ status: 'unsupported' });
  });
});
