import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount, listArchiveSnapshots } from '../src/main/database/archive-repository';
import { indexDiscoveredMediaAssets } from '../src/main/database/media-indexer';
import { getMessageConversation, listArchiveMediaGallery } from '../src/main/database/messages-repository';
import { searchArchiveRecords } from '../src/main/database/search-repository';
import { listPostRecords, listCommentActivities, listReactionRecords } from '../src/main/database/activity-repository';
import { getArchiveSearchSettings, setIncludeMessagesInGlobalSearch } from '../src/main/database/search-settings-repository';
import { compareArchiveSnapshots, listArchiveComparisonChanges } from '../src/main/database/comparison-repository';

const migrations = [
  { version: 1, name: 'initial_schema', sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
  { version: 2, name: 'unique_account_display_names', sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') },
  { version: 6, name: 'search_preferences', sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/006_search_preferences.sql'), 'utf8') },
  { version: 7, name: 'semantic_search', sql: readFileSync(join(process.cwd(), 'src/main/database/migrations/007_semantic_search.sql'), 'utf8') }
];

describe('archive-wide media, search, and comparison', () => {
  let database: DatabaseSync;
  let accountId: string;
  let baselineId: string;
  let comparedId: string;

  beforeEach(() => {
    database = openAppDatabase(':memory:', migrations);
    accountId = getOrCreateAccount(database, 'Synthetic feature account');
    const now = new Date().toISOString();
    baselineId = 'features-baseline';
    comparedId = 'features-compared';
    for (const [id, name] of [[baselineId, 'Older backup'], [comparedId, 'Newer backup']] as const) {
      database.prepare(`
        INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at)
        VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)
      `).run(id, accountId, name, `/synthetic/${id}`, now, now);
    }
  });

  afterEach(() => database.close());

  function addSource(snapshotId: string, path: string, format: string, section: string): number {
    const now = new Date().toISOString();
    const row = database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, discovered_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(snapshotId, path, path.split('/').pop() ?? path, section, format, now);
    return Number(row.lastInsertRowid);
  }

  function addPost(snapshotId: string, sourceId: number, index: number, title: string, body: string): void {
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, event_time_raw, sensitivity, search_enabled, payload_json, created_at)
      VALUES (?, ?, ?, 'posts', 'post', ?, ?, ?, 'Raw date', 'personal', 1, '{}', ?)
    `).run(snapshotId, sourceId, index, title, body, `${title} ${body}`.toLocaleLowerCase(), now);
  }

  it('indexes all discovered media and keeps local record context when available', () => {
    const html = addSource(baselineId, 'posts/your_posts.html', 'html', 'posts');
    addSource(baselineId, 'photos_and_videos/your_posts/photo.jpg', 'image', 'photos_and_videos');
    addSource(baselineId, 'videos/video.mp4', 'video', 'videos');
    addPost(baselineId, html, 0, 'Synthetic author', 'Gallery context');
    const savedRecord = database.prepare('SELECT id FROM records WHERE snapshot_id = ?').get(baselineId) as { id: number };
    indexDiscoveredMediaAssets(database, baselineId);
    database.prepare(`
      INSERT INTO record_media (record_id, media_asset_id, display_order, role)
      SELECT ?, id, 0, 'post_attachment' FROM media_assets
      WHERE snapshot_id = ? AND relative_path = 'photos_and_videos/your_posts/photo.jpg'
    `).run(savedRecord.id, baselineId);

    const gallery = listArchiveMediaGallery(database, baselineId).items;
    expect(gallery).toHaveLength(2);
    expect(gallery).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'photos_and_videos/your_posts/photo.jpg', mediaKind: 'image', sectionKey: 'posts', title: 'Synthetic author', body: 'Gallery context' }),
      expect.objectContaining({ relativePath: 'videos/video.mp4', mediaKind: 'video', sectionKey: 'videos', recordId: null })
    ]));
    expect(indexDiscoveredMediaAssets(database, baselineId)).toBe(2);
  });

  it('loads long message conversations in ordered 50-message pages without overlap', () => {
    const sourceId = addSource(baselineId, 'messages/inbox/thread/thread.html', 'html', 'messages');
    const now = new Date().toISOString();
    const insertMessage = database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, ?, 'messages', 'message', ?, ?, 'sensitive', 0, ?, ?)
    `);
    for (let index = 0; index < 123; index += 1) {
      insertMessage.run(
        baselineId, sourceId, index, 'Sender ' + index, 'Message body ' + index,
        JSON.stringify({ reactions_raw: index === 0 ? ['Like'] : [] }), now
      );
    }

    const first = getMessageConversation(database, baselineId, sourceId, 1);
    const second = getMessageConversation(database, baselineId, sourceId, 2);
    const last = getMessageConversation(database, baselineId, sourceId, 3);

    expect(first).toMatchObject({ page: 1, pageSize: 50, total: 123 });
    expect(first.records.map((message) => message.sourceCardIndex)).toEqual(
      Array.from({ length: 50 }, (_, index) => index)
    );
    expect(first.records[0].reactions).toEqual(['Like']);
    expect(second.records.map((message) => message.sourceCardIndex)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 50)
    );
    expect(last).toMatchObject({ page: 3, pageSize: 50, total: 123 });
    expect(last.records.map((message) => message.sourceCardIndex)).toEqual(
      Array.from({ length: 23 }, (_, index) => index + 100)
    );
    expect(getMessageConversation(database, baselineId, sourceId, 999).page).toBe(3);
    expect(new Set([...first.records, ...second.records, ...last.records].map((message) => message.id)).size).toBe(123);
    expect(() => getMessageConversation(database, baselineId, sourceId, 0)).toThrow(/page/i);
  });

  it('searches indexed records by text and section while private messages remain excluded', () => {
    const posts = addSource(baselineId, 'posts/your_posts.html', 'html', 'posts');
    const comments = addSource(baselineId, 'comments/comments.html', 'html', 'comments');
    const messages = addSource(baselineId, 'messages/inbox/thread/thread.html', 'html', 'messages');
    addPost(baselineId, posts, 0, 'Sample person', 'Phoenix emulator discussion');
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
        body_text, normalized_text, sensitivity, search_enabled, created_at)
      VALUES (?, ?, 0, 'comments', 'comment_activity', 'Phoenix was discussed', 'phoenix was discussed', 'personal', 1, ?)
    `).run(baselineId, comments, now);
    database.prepare(`
      INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
        body_text, normalized_text, sensitivity, search_enabled, created_at)
      VALUES (?, ?, 0, 'messages', 'message', 'Phoenix private message', 'phoenix private message', 'sensitive', 0, ?)
    `).run(baselineId, messages, now);

    expect(searchArchiveRecords(database, baselineId, 'Phoenix emulator')).toMatchObject([
      { sectionKey: 'posts', body: 'Phoenix emulator discussion' }
    ]);
    expect(searchArchiveRecords(database, baselineId, 'Phoenix', 'comments')).toHaveLength(1);
    expect(searchArchiveRecords(database, baselineId, 'Phoenix', null)).toHaveLength(2);
    expect(searchArchiveRecords(database, baselineId, 'Phoenix', 'messages')).toMatchObject([
      { sectionKey: 'messages', body: 'Phoenix private message' }
    ]);
  });

  it('uses a separate opt-in index for sensitive message text and removes it when disabled', () => {
    const messages = addSource(baselineId, 'messages/inbox/thread/thread.html', 'html', 'messages');
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO records (snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, sensitivity, search_enabled, created_at)
      VALUES (?, ?, 0, 'messages', 'message', 'Trip planning', 'We discussed Alexandria travel', 'we discussed alexandria travel', 'sensitive', 0, ?)
    `).run(baselineId, messages, now);
    database.prepare("UPDATE records SET event_time_utc = '2022-06-15T12:00:00.000Z' WHERE source_file_id = ?").run(messages);

    expect(getArchiveSearchSettings(database).includeMessagesInGlobalSearch).toBe(false);
    expect(searchArchiveRecords(database, baselineId, 'Alexandria')).toHaveLength(0);
    expect(searchArchiveRecords(database, baselineId, 'Alexandria', 'messages')).toHaveLength(1);
    expect(searchArchiveRecords(
      database, baselineId, 'Alexandria', 'messages', 'exact', 0.8, '2022-06-01', '2022-06-30'
    )).toHaveLength(1);
    expect(searchArchiveRecords(
      database, baselineId, 'Alexandria', 'messages', 'exact', 0.8, '2022-07-01', null
    )).toHaveLength(0);

    setIncludeMessagesInGlobalSearch(database, true);
    expect(getArchiveSearchSettings(database).includeMessagesInGlobalSearch).toBe(true);
    expect(searchArchiveRecords(database, baselineId, 'Alexandria').map((record) => record.sectionKey)).toContain('messages');

    setIncludeMessagesInGlobalSearch(database, false);
    expect(searchArchiveRecords(database, baselineId, 'Alexandria').map((record) => record.sectionKey)).not.toContain('messages');
  });

  it('finds likely missing, extra, substituted, and transposed characters in Fuzzy Search', () => {
    const posts = addSource(baselineId, 'posts/travel.html', 'html', 'posts');
    addPost(baselineId, posts, 0, 'Alexandria trip', 'Planning a journey');
    const exactPhrase = searchArchiveRecords(database, baselineId, '"Alexandria trip"');
    expect(exactPhrase).toEqual([
      expect.objectContaining({ title: 'Alexandria trip', matchType: 'exact' })
    ]);
    expect(searchArchiveRecords(database, baselineId, 'travel.html')).toEqual([
      expect.objectContaining({ sourcePath: 'posts/travel.html', matchType: 'exact' })
    ]);
    database.prepare("UPDATE records SET event_time_raw = '2022-11-24' WHERE source_file_id = ?").run(posts);
    expect(searchArchiveRecords(database, baselineId, '2022-11-24')).toEqual([
      expect.objectContaining({ dateRaw: '2022-11-24', sourcePath: 'posts/travel.html' })
    ]);

    const missingOrExtra = searchArchiveRecords(database, baselineId, 'Alexandrea', null, 'fuzzy', 0.8);
    expect(missingOrExtra).toEqual([
      expect.objectContaining({ title: 'Alexandria trip', matchType: 'fuzzy' })
    ]);

    const transposed = searchArchiveRecords(database, baselineId, 'Alexandira', null, 'fuzzy', 0.8);
    expect(transposed).toEqual([
      expect.objectContaining({ title: 'Alexandria trip', matchType: 'fuzzy' })
    ]);

    const missingFirstCharacter = searchArchiveRecords(database, baselineId, 'lexandria', null, 'fuzzy', 0.8);
    expect(missingFirstCharacter).toEqual([
      expect.objectContaining({ title: 'Alexandria trip', matchType: 'fuzzy' })
    ]);
    const extraFirstCharacter = searchArchiveRecords(database, baselineId, 'aalexandria', null, 'fuzzy', 0.8);
    expect(extraFirstCharacter).toEqual([
      expect.objectContaining({ title: 'Alexandria trip', matchType: 'fuzzy' })
    ]);
    expect(searchArchiveRecords(database, baselineId, 'Alexandrea', null, 'fuzzy', 0.95)).toHaveLength(0);
  });

  it('paginates large Posts, Comments, and Reactions feeds without fixed record caps', () => {
    const postsSource = addSource(baselineId, 'posts/large-posts.html', 'html', 'posts');
    const commentsSource = addSource(baselineId, 'comments/large-comments.html', 'html', 'comments');
    const reactionsSource = addSource(baselineId, 'likes_and_reactions/large-reactions.html', 'html', 'likes_and_reactions');
    const now = new Date().toISOString();
    const insertComment = database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, event_time_raw, event_time_utc,
        sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, ?, 'comments', 'comment_activity', ?, ?, ?, ?, ?, 'personal', 1, ?, ?)
    `);
    const insertReaction = database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, event_time_raw, event_time_utc,
        sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, ?, 'likes_and_reactions', 'reaction', ?, ?, ?, ?, ?, 'personal', 1, '{}', ?)
    `);

    database.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 2_105; index += 1) {
        addPost(baselineId, postsSource, index, `Post ${index}`, `A large post body ${index}`);
        insertComment.run(
          baselineId, commentsSource, index, `Comment activity ${index}`,
          `Comment body ${index}`, `comment activity ${index} comment body ${index}`,
          String(1_700_000_000 + index), index === 2_104 ? '2023-11-14T22:13:24.000Z' : null,
          JSON.stringify({ group_raw: index === 2_104 ? 'Searchable Group' : null }), now
        );
        insertReaction.run(
          baselineId, reactionsSource, index, index % 2 === 0 ? 'like' : 'love',
          `Reaction description ${index}`, `reaction description ${index}`,
          String(1_700_000_000 + index), null, now
        );
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }

    const postsFirst = listPostRecords(database, baselineId, 1);
    const postsMiddle = listPostRecords(database, baselineId, 11);
    const postsLast = listPostRecords(database, baselineId, 22);
    expect(postsFirst).toMatchObject({ page: 1, pageSize: 100, total: 2_105 });
    expect(postsMiddle.items).toHaveLength(100);
    expect(postsLast.items).toHaveLength(5);
    expect(new Set([...postsFirst.items, ...postsMiddle.items, ...postsLast.items].map((item) => item.id)).size).toBe(205);

    const commentsFirst = listCommentActivities(database, baselineId, 1);
    const commentsLast = listCommentActivities(database, baselineId, 22);
    expect(commentsFirst.total).toBe(2_105);
    expect(commentsLast.items).toHaveLength(5);
    expect(commentsLast.items[0].sourceCardIndex).toBe(2_100);

    const reactionsFirst = listReactionRecords(database, baselineId, 1);
    const reactionsLast = listReactionRecords(database, baselineId, 22);
    expect(reactionsFirst.total).toBe(2_105);
    expect(reactionsLast.items).toHaveLength(5);
    expect(reactionsLast.items[4].sourceCardIndex).toBe(2_104);

    const commentSearch = listCommentActivities(database, baselineId, 1, 'comment body 2104');
    expect(commentSearch.total).toBe(1);
    expect(commentSearch.items[0].sourceCardIndex).toBe(2_104);
    const commentDateFilter = listCommentActivities(database, baselineId, 1, '', '2023-11-14', '2023-11-14');
    expect(commentDateFilter.total).toBe(1);
    expect(commentDateFilter.items[0].sourceCardIndex).toBe(2_104);
    const reactionSearch = listReactionRecords(database, baselineId, 1, 'description 204');
    expect(reactionSearch.total).toBe(11);
    expect(() => listPostRecords(database, baselineId, 0)).toThrow(/page/i);
  });

  it('filters Exact Search by inclusive UTC calendar days and excludes ambiguous timestamps', () => {
    const sourceId = addSource(baselineId, 'posts/utc-dates.html', 'html', 'posts');
    addPost(baselineId, sourceId, 0, 'Alexandria trip', 'A dated travel record');
    addPost(baselineId, sourceId, 1, 'Alexandria trip', 'A dated travel record');
    addPost(baselineId, sourceId, 2, 'Alexandria trip', 'A dated travel record');
    addPost(baselineId, sourceId, 3, 'Alexandria trip', 'A date without a verified timezone');

    database.prepare("UPDATE records SET event_time_utc = '2022-01-01T00:00:00.000Z' WHERE source_file_id = ? AND source_record_index = 0").run(sourceId);
    database.prepare("UPDATE records SET event_time_utc = '2022-12-31T23:59:59.999Z' WHERE source_file_id = ? AND source_record_index = 1").run(sourceId);
    database.prepare("UPDATE records SET event_time_utc = '2023-01-01T00:00:00.000Z' WHERE source_file_id = ? AND source_record_index = 2").run(sourceId);

    const inYear = searchArchiveRecords(
      database, baselineId, 'Alexandria trip', null, 'exact', 0.8, '2022-01-01', '2022-12-31'
    );
    expect(inYear.map((record) => record.sourceCardIndex)).toEqual([0, 1]);

    const fuzzyInYear = searchArchiveRecords(
      database, baselineId, 'Alexandria trip', null, 'fuzzy', 0.95, '2022-01-01', '2022-12-31'
    );
    expect(fuzzyInYear.map((record) => record.sourceCardIndex)).toEqual([0, 1]);

    const finalDay = searchArchiveRecords(
      database, baselineId, 'Alexandria trip', null, 'exact', 0.8, '2022-12-31', '2022-12-31'
    );
    expect(finalDay.map((record) => record.sourceCardIndex)).toEqual([1]);

    const afterStart = searchArchiveRecords(
      database, baselineId, 'Alexandria trip', null, 'exact', 0.8, '2023-01-01', null
    );
    expect(afterStart.map((record) => record.sourceCardIndex)).toEqual([2]);

    expect(() => searchArchiveRecords(
      database, baselineId, 'Alexandria trip', null, 'exact', 0.8, '2022-02-30', null
    )).toThrow(/calendar date/i);
    expect(() => searchArchiveRecords(
      database, baselineId, 'Alexandria trip', null, 'exact', 0.8, '2023-01-01', '2022-12-31'
    )).toThrow(/start date/i);
  });

  it('compares source-card positions and reports added, removed, changed, and unchanged counts', () => {
    const basePath = addSource(baselineId, 'posts/your_posts.html', 'html', 'posts');
    const newPath = addSource(comparedId, 'posts/your_posts.html', 'html', 'posts');
    addPost(baselineId, basePath, 0, 'Same', 'Unchanged body');
    addPost(baselineId, basePath, 1, 'Old title', 'Changed body');
    addPost(baselineId, basePath, 2, 'Removed', 'Removed body');
    addPost(comparedId, newPath, 0, 'Same', 'Unchanged body');
    addPost(comparedId, newPath, 1, 'New title', 'Changed body');
    addPost(comparedId, newPath, 3, 'Added', 'Added body');

    const report = compareArchiveSnapshots(database, baselineId, comparedId);
    expect(report).toMatchObject({ added: 1, removed: 1, changed: 1, unchanged: 1 });
    expect(report.sections).toEqual([{ sectionKey: 'posts', added: 1, removed: 1, changed: 1 }]);
  });

  it('browses paginated comparison details with source positions and previous/current values', () => {
    const basePath = addSource(baselineId, 'posts/your_posts.html', 'html', 'posts');
    const newPath = addSource(comparedId, 'posts/your_posts.html', 'html', 'posts');
    addPost(baselineId, basePath, 0, 'Same', 'Unchanged body');
    addPost(baselineId, basePath, 1, 'Old title', 'Changed body');
    addPost(baselineId, basePath, 2, 'Removed item', 'No longer present');
    addPost(comparedId, newPath, 0, 'Same', 'Unchanged body');
    addPost(comparedId, newPath, 1, 'New title', 'Changed body');
    addPost(comparedId, newPath, 3, 'Added item', 'Newly present');

    const firstPage = listArchiveComparisonChanges(database, baselineId, comparedId, 'all', 'all', '', 1, 2);
    expect(firstPage.total).toBe(3);
    expect(firstPage.page).toBe(1);
    expect(firstPage.pageSize).toBe(2);
    expect(firstPage.changes).toHaveLength(2);
    expect(firstPage.changes[0]).toMatchObject({
      changeKind: 'changed',
      sourcePath: 'posts/your_posts.html',
      sourceCardIndex: 1,
      previousTitle: 'Old title',
      previousBody: 'Changed body',
      comparedTitle: 'New title',
      comparedBody: 'Changed body'
    });
    expect(firstPage.changes[1]).toMatchObject({
      changeKind: 'removed',
      sourceCardIndex: 2,
      previousTitle: 'Removed item',
      comparedTitle: null
    });

    const addedOnly = listArchiveComparisonChanges(database, baselineId, comparedId, 'added', 'posts', 'Added item');
    expect(addedOnly).toMatchObject({
      total: 1,
      changes: [expect.objectContaining({ changeKind: 'added', comparedTitle: 'Added item', previousTitle: null })]
    });
    expect(listArchiveComparisonChanges(database, baselineId, comparedId, 'all', 'comments').total).toBe(0);
    expect(listArchiveComparisonChanges(database, baselineId, comparedId, 'all', 'all', 'New title').total).toBe(1);
    expect(() => listArchiveComparisonChanges(database, baselineId, comparedId, 'unknown' as never)).toThrow('filter');
  });

  it('treats SQL wildcard characters in detailed comparison search as literal text', () => {
    const basePath = addSource(baselineId, 'posts/your_posts.html', 'html', 'posts');
    const newPath = addSource(comparedId, 'posts/your_posts.html', 'html', 'posts');
    addPost(comparedId, newPath, 0, 'Literal 50%_match', 'Added');
    addPost(comparedId, newPath, 1, 'Literal 50XYmatch', 'Added');
    addPost(baselineId, basePath, 2, 'Literal 50%_gone', 'Removed');

    const results = listArchiveComparisonChanges(database, baselineId, comparedId, 'all', 'all', '50%_');
    expect(results.total).toBe(2);
  });

  it('lists every saved backup instead of hiding snapshots beyond the latest twenty', () => {
    const now = new Date().toISOString();
    for (let index = 0; index < 25; index += 1) {
      const id = 'additional-snapshot-' + index;
      database.prepare(`
        INSERT INTO archive_snapshots (
          id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)
      `).run(id, accountId, 'Backup ' + index, '/synthetic/' + id, now, now);
    }

    const backups = listArchiveSnapshots(database);
    expect(backups).toHaveLength(27);
    expect(backups.some((backup) => backup.id === baselineId)).toBe(true);
    expect(backups.some((backup) => backup.id === comparedId)).toBe(true);
    expect(new Set(backups.map((backup) => backup.id)).size).toBe(27);
  });

  it('rejects comparisons between backups from different accounts', () => {
    const otherAccount = getOrCreateAccount(database, 'Different synthetic account');
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at)
      VALUES ('different-account', ?, 'Other', 'directory', '/synthetic/other', 'discovered', ?, ?)
    `).run(otherAccount, now, now);
    expect(() => compareArchiveSnapshots(database, baselineId, 'different-account')).toThrow('same Facebook account');
  });
});
