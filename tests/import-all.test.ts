import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { importAllSupportedData, importPhotosAndVideosSection, recoverAllInterruptedImports } from '../src/main/import/pipeline/import-all';
import type { ImportProgressEvent } from '../src/shared/archive/inspection';

describe('Import all supported data', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'import-all-test-'));
    const folders = [
      'friends',
      'messages/inbox/thread-1',
      'posts',
      'comments',
      'likes_and_reactions',
      'photos_and_videos'
    ];
    for (const folder of folders) await mkdir(join(root, folder), { recursive: true });
    const accountId = getOrCreateAccount(database, 'Synthetic import-all account');
    snapshotId = 'import-all-snapshot';
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at)
      VALUES (?, ?, 'Synthetic export', 'directory', ?, 'discovered', ?, ?)
    `).run(snapshotId, accountId, root, now, now);

    const files = [
      ['friends/friends.html', 'friends.html', 'friends'],
      ['messages/inbox/thread-1/thread.html', 'thread.html', 'messages'],
      ['posts/your_posts.html', 'your_posts.html', 'posts'],
      ['comments/comments.html', 'comments.html', 'comments'],
      ['likes_and_reactions/likes.html', 'likes.html', 'likes_and_reactions'],
      ['photos_and_videos/your_photos.html', 'your_photos.html', 'photos_and_videos']
    ] as const;
    for (const [path, name, section] of files) {
      await writeFile(join(root, path), '<html><body><p>Unrecognized synthetic structure</p></body></html>', 'utf8');
      database.prepare(`
        INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
        VALUES (?, ?, ?, ?, 'html', 'discovered', ?)
      `).run(snapshotId, path, name, section, now);
    }
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('runs every reviewed importer sequentially and reports unsupported structures', async () => {
    const progress: ImportProgressEvent[] = [];
    const result = await importAllSupportedData(database, snapshotId, root, (event) => progress.push(event));
    expect(progress.filter((event) => event.phase === 'started').map((event) => event.sectionKey)).toEqual([
      'friends', 'messages', 'posts', 'comments', 'likes_and_reactions', 'photos_and_videos', 'html_fallback'
    ]);
    expect(progress.filter((event) => event.phase === 'progress')).toHaveLength(12);
    expect(progress.filter((event) => event.phase === 'completed').map((event) => event.sectionKey)).toEqual([
      'friends', 'messages', 'posts', 'comments', 'likes_and_reactions', 'photos_and_videos', 'html_fallback'
    ]);
    expect(progress.find((event) => event.sectionKey === 'posts' && event.phase === 'progress')).toMatchObject({
      filesCompleted: 1, filesTotal: 1, recordsImported: 0, unsupportedFiles: 1, failedFiles: 0
    });
    expect(result.totals).toEqual({
      filesAttempted: 12,
      recordsImported: 6,
      mediaReferences: 0,
      unsupportedFiles: 6,
      failedFiles: 0
    });
    expect(result.sections.friends.filesAttempted).toBe(1);
    expect(result.sections.messages.filesAttempted).toBe(1);
    expect(result.sections.posts.filesAttempted).toBe(1);
    expect(result.sections.comments.filesAttempted).toBe(1);
    expect(result.sections.reactions.filesAttempted).toBe(1);
    expect(result.sections.photosAndVideos.filesAttempted).toBe(1);
    expect(result.sections.htmlFallback.filesAttempted).toBe(6);

    const statuses = database.prepare('SELECT status, parser_key AS parserKey FROM source_files WHERE snapshot_id = ? ORDER BY relative_path')
      .all(snapshotId) as Array<{ status: string; parserKey: string | null }>;
    expect(statuses.every((row) => row.status === 'completed' && row.parserKey === 'html_fallback')).toBe(true);
    const snapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?')
      .get(snapshotId) as { status: string };
    expect(snapshot.status).toBe('partial');
  });

  it('runs the plain-text fallback as part of Import All', async () => {
    await mkdir(join(root, 'events'), { recursive: true });
    const path = 'events/no-data.txt';
    const sourceText = 'No events were included in this export.';
    await writeFile(join(root, path), sourceText, 'utf8');
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format,
        file_size_bytes, status, discovered_at
      ) VALUES (?, ?, 'no-data.txt', 'events', 'text', ?, 'discovered', ?)
    `).run(snapshotId, path, Buffer.byteLength(sourceText), now);

    const result = await importAllSupportedData(database, snapshotId, root);
    expect(result.sections.textFallback).toMatchObject({
      filesAttempted: 1,
      recordsImported: 1,
      unsupportedFiles: 0,
      failedFiles: 0
    });
    const record = database.prepare(`
      SELECT record_type AS recordType, title, body_text AS body, sensitivity, search_enabled AS searchEnabled
      FROM records WHERE snapshot_id = ? AND section_key = 'events'
    `).get(snapshotId);
    expect(record).toMatchObject({
      recordType: 'text_item',
      title: sourceText,
      body: sourceText,
      sensitivity: 'personal',
      searchEnabled: 1
    });
  });

  it('imports unknown JSON shapes as safe raw records and disables search for sensitive sections', async () => {
    await mkdir(join(root, 'groups'), { recursive: true });
    await mkdir(join(root, 'security_and_login_information'), { recursive: true });
    await mkdir(join(root, 'future_section'), { recursive: true });
    const groupsPath = 'groups/groups.json';
    const securityPath = 'security_and_login_information/sessions.json';
    const unknownPath = 'future_section/future.json';
    const invalidPath = 'groups/malformed.json';
    await writeFile(join(root, groupsPath), '\uFEFF' + JSON.stringify({
      groups: [
        { name: 'Chess Club', description: 'Weekly chess games', created_time: 'Unparsed Facebook date', metadata: { value: 'Open chess community' }, email: 'private@example.test', access_token: 'synthetic-secret' },
        { name: 'Book Club', description: 'Monthly reading meetings' }
      ],
      exported_at: '2024-01-01'
    }), 'utf8');
    await writeFile(join(root, securityPath), JSON.stringify([
      { name: 'Recent login', description: 'Synthetic session details', ip_address: '192.0.2.10' }
    ]), 'utf8');
    await writeFile(join(root, unknownPath), JSON.stringify({ message: 'Unreviewed section text' }), 'utf8');
    await writeFile(join(root, invalidPath), '{ invalid json', 'utf8');

    const now = new Date().toISOString();
    for (const [relativePath, fileName, sectionKey] of [
      [groupsPath, 'groups.json', 'groups'],
      [securityPath, 'sessions.json', 'security_and_login_information'],
      [unknownPath, 'future.json', 'future_section'],
      [invalidPath, 'malformed.json', 'groups']
    ]) {
      database.prepare(`
        INSERT INTO source_files (
          snapshot_id, relative_path, file_name, section_key, detected_format, file_size_bytes, status, discovered_at
        ) VALUES (?, ?, ?, ?, 'json', ?, 'discovered', ?)
      `).run(snapshotId, relativePath, fileName, sectionKey,
        (await readFile(join(root, relativePath))).byteLength, now);
    }

    const result = await importAllSupportedData(database, snapshotId, root);
    expect(result.sections.json).toMatchObject({
      filesAttempted: 4,
      recordsImported: 5,
      unsupportedFiles: 0,
      failedFiles: 1
    });

    const records = database.prepare(`
      SELECT section_key AS sectionKey, title, body_text AS body,
        sensitivity, search_enabled AS searchEnabled, event_time_raw AS timestampRaw, payload_json AS payloadJson
      FROM records WHERE record_type = 'json_item'
      ORDER BY section_key, source_record_index
    `).all() as Array<{
      sectionKey: string; title: string | null; body: string | null;
      sensitivity: string; searchEnabled: number; timestampRaw: string | null; payloadJson: string;
    }>;
    const groupRecords = records.filter((record) => record.sectionKey === 'groups');
    expect(groupRecords).toHaveLength(3);
    expect(groupRecords[0]).toMatchObject({
      title: 'Chess Club',
      body: 'Weekly chess games\nOpen chess community',
      sensitivity: 'personal',
      searchEnabled: 1,
      timestampRaw: 'Unparsed Facebook date'
    });
    expect(groupRecords[0].body).not.toContain('private@example.test');
    expect(groupRecords[0].body).not.toContain('synthetic-secret');
    expect(JSON.parse(groupRecords[0].payloadJson)).toMatchObject({
      source_key: 'groups[0]',
      value: { name: 'Chess Club', description: 'Weekly chess games' }
    });
    const securityRecord = records.find((record) => record.sectionKey === 'security_and_login_information');
    expect(securityRecord).toMatchObject({
      title: 'Recent login',
      body: 'Synthetic session details',
      sensitivity: 'sensitive',
      searchEnabled: 0
    });

    const unknownRecord = records.find((record) => record.sectionKey === 'future_section');
    expect(unknownRecord).toMatchObject({
      body: 'Unreviewed section text',
      sensitivity: 'sensitive',
      searchEnabled: 0
    });

    const statuses = database.prepare(`
      SELECT relative_path AS relativePath, status
      FROM source_files WHERE snapshot_id = ? AND detected_format = 'json'
      ORDER BY relative_path
    `).all(snapshotId) as Array<{ relativePath: string; status: string }>;
    expect(statuses).toEqual([
      { relativePath: 'future_section/future.json', status: 'completed' },
      { relativePath: 'groups/groups.json', status: 'completed' },
      { relativePath: 'groups/malformed.json', status: 'failed' },
      { relativePath: 'security_and_login_information/sessions.json', status: 'completed' }
    ]);
  });

  it('imports referenced album detail pages, photo records, and local image links during Import All', async () => {
    const albumPath = 'photos_and_videos/album/0.html';
    const imagePath = 'photos_and_videos/sample_album/photo.jpg';
    await mkdir(join(root, 'photos_and_videos', 'album'), { recursive: true });
    await mkdir(join(root, 'photos_and_videos', 'sample_album'), { recursive: true });
    await writeFile(join(root, 'photos_and_videos', 'your_photos.html'), `
      <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
        <div class="_3-96 _2pio _2lek _2lel">My album - 1 photo</div>
        <div class="_3-96 _2let"><a href="${albumPath}"><img src="${imagePath}"></a></div>
        <div class="_3-94 _2lem">Raw album date</div>
      </div>`, 'utf8');
    await writeFile(join(root, albumPath), `
      <div class="_3b0d">My album</div>
      <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
        <div class="_3-96 _2let">
          <a href="${imagePath}"><img src="${imagePath}"></a>
          <div class="_3-95">A photo caption</div>
          <div class="pas _3-94 uiBoxGray noborder"><div><div><span class="_3-8_ _2oao">Photo commenter</span>Photo comment</div><div class="_67gx">Raw comment date</div></div></div>
        </div>
        <div class="_3-94 _2lem">Raw photo date</div>
      </div>`, 'utf8');
    await writeFile(join(root, imagePath), 'synthetic photo bytes', 'utf8');

    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, ?, '0.html', 'photos_and_videos', 'html', 'discovered', ?)
    `).run(snapshotId, albumPath, now);
    database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, ?, 'photo.jpg', 'photos_and_videos', 'image', 'discovered', ?)
    `).run(snapshotId, imagePath, now);

    const result = await importAllSupportedData(database, snapshotId, root);

    expect(result.sections.photosAndVideos).toMatchObject({
      filesAttempted: 2,
      recordsImported: 2,
      mediaReferences: 2,
      unsupportedFiles: 0,
      failedFiles: 0
    });
    const album = database.prepare(`
      SELECT id FROM records WHERE snapshot_id = ? AND section_key = 'photos_and_videos'
        AND record_type = 'photo_album'
    `).get(snapshotId) as { id: number };
    const photo = database.prepare(`
      SELECT body_text AS caption FROM records WHERE snapshot_id = ? AND section_key = 'photos_and_videos'
        AND record_type = 'photo'
    `).get(snapshotId) as { caption: string };
    expect(photo.caption).toBe('A photo caption');
    const linkedAssets = database.prepare('SELECT COUNT(*) AS count FROM record_media').get() as { count: number };
    expect(linkedAssets.count).toBe(2);
    expect(Number.isSafeInteger(album.id)).toBe(true);
    expect(database.prepare('SELECT status FROM source_files WHERE snapshot_id = ? AND relative_path = ?')
      .get(snapshotId, albumPath)).toMatchObject({ status: 'completed' });
  });

  it('imports Photos & Videos independently without running other sections', async () => {
    const albumPath = 'photos_and_videos/album/1.html';
    const imagePath = 'photos_and_videos/standalone/photo.jpg';
    await mkdir(join(root, 'photos_and_videos', 'album'), { recursive: true });
    await mkdir(join(root, 'photos_and_videos', 'standalone'), { recursive: true });
    await writeFile(join(root, 'photos_and_videos', 'your_photos.html'), `
      <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
        <div class="_3-96 _2pio _2lek _2lel">Standalone album - 1 photo</div>
        <div class="_3-96 _2let"><a href="${albumPath}"><img src="${imagePath}"></a></div>
        <div class="_3-94 _2lem">Raw album date</div>
      </div>`, 'utf8');
    await writeFile(join(root, albumPath), `
      <div class="_3b0d">Standalone album</div>
      <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
        <div class="_3-96 _2let">
          <a href="${imagePath}"><img src="${imagePath}"></a>
          <div class="_3-95">Independent photo caption</div>
        </div>
        <div class="_3-94 _2lem">Raw photo date</div>
      </div>`, 'utf8');
    await writeFile(join(root, imagePath), 'synthetic photo bytes', 'utf8');

    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, ?, '1.html', 'photos_and_videos', 'html', 'discovered', ?)
    `).run(snapshotId, albumPath, now);
    database.prepare(`
      INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at)
      VALUES (?, ?, 'photo.jpg', 'photos_and_videos', 'image', 'discovered', ?)
    `).run(snapshotId, imagePath, now);

    const result = await importPhotosAndVideosSection(database, snapshotId, root);

    expect(result).toEqual({
      filesAttempted: 2,
      recordsImported: 2,
      mediaReferences: 2,
      unsupportedFiles: 0,
      failedFiles: 0
    });
    const otherSections = database.prepare(
      "SELECT COUNT(*) AS count FROM records WHERE snapshot_id = ? AND section_key != 'photos_and_videos'"
    ).get(snapshotId) as { count: number };
    expect(otherSections.count).toBe(0);
    const photo = database.prepare(
      "SELECT body_text AS caption FROM records WHERE snapshot_id = ? AND record_type = 'photo'"
    ).get(snapshotId) as { caption: string };
    expect(photo.caption).toBe('Independent photo caption');
  });

  it('continues importing if a progress listener throws', async () => {
    await expect(importAllSupportedData(database, snapshotId, root, () => {
      throw new Error('Renderer progress listener is unavailable');
    })).resolves.toMatchObject({
      totals: { filesAttempted: 12, unsupportedFiles: 6, failedFiles: 0 }
    });
  });

  it('recovers interrupted individual imports across all saved backups at startup', () => {
    const accountId = getOrCreateAccount(database, 'Synthetic import-all account');
    const now = new Date().toISOString();
    const interruptedIds = ['interrupted-one', 'interrupted-two', 'interrupted-three'];
    const startingStatuses = ['importing', 'discovered', 'completed'] as const;

    for (const [index, id] of interruptedIds.entries()) {
      database.prepare(`
        INSERT INTO archive_snapshots (
          id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'directory', ?, ?, ?, ?)
      `).run(id, accountId, 'Interrupted backup ' + index, root, startingStatuses[index], now, now);
      const fileId = database.prepare(`
        INSERT INTO source_files (
          snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
        ) VALUES (?, 'posts/your_posts.html', 'your_posts.html', 'posts', 'html', 'processing', ?)
      `).run(id, now).lastInsertRowid;
      database.prepare(`
        INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered)
        VALUES (?, ?, 'import', 'running', ?, 1)
      `).run('run-' + id, id, now);
      expect(fileId).toBeGreaterThan(0);
    }

    expect(recoverAllInterruptedImports(database)).toBe(3);
    for (const id of interruptedIds) {
      const file = database.prepare('SELECT status, safe_error_code FROM source_files WHERE snapshot_id = ?')
        .get(id) as { status: string; safe_error_code: string | null };
      expect(file).toEqual({ status: 'failed', safe_error_code: 'IMPORT_INTERRUPTED' });
      const run = database.prepare('SELECT status FROM import_runs WHERE id = ?').get('run-' + id) as { status: string };
      expect(run.status).toBe('failed');
      const issue = database.prepare(`
        SELECT severity, issue_code, safe_message
        FROM import_issues WHERE import_run_id = ?
      `).get('run-' + id) as { severity: string; issue_code: string; safe_message: string };
      expect(issue).toMatchObject({
        severity: 'error',
        issue_code: 'IMPORT_INTERRUPTED'
      });
      expect(issue.safe_message).toContain('Retry the section');
      expect(issue.safe_message).not.toContain('your_posts.html');
      const snapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?').get(id) as { status: string };
      expect(snapshot.status).toBe('partial');
    }
  });

  it('creates a safe diagnostics record for an orphaned processing file without an import run', () => {
    const accountId = getOrCreateAccount(database, 'Synthetic import-all account');
    const now = new Date().toISOString();
    const orphanSnapshotId = 'orphaned-processing-snapshot';
    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, 'Orphaned import backup', 'directory', ?, 'completed', ?, ?)
    `).run(orphanSnapshotId, accountId, root, now, now);
    database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, 'posts/your_posts.html', 'your_posts.html', 'posts', 'html', 'processing', ?)
    `).run(orphanSnapshotId, now);

    expect(recoverAllInterruptedImports(database)).toBe(1);
    const run = database.prepare(`
      SELECT id, status, files_processed AS filesProcessed, errors_count AS errorsCount
      FROM import_runs WHERE snapshot_id = ?
    `).get(orphanSnapshotId) as { id: string; status: string; filesProcessed: number; errorsCount: number };
    expect(run).toMatchObject({ status: 'failed', filesProcessed: 1, errorsCount: 1 });
    const issue = database.prepare(`
      SELECT severity, issue_code AS issueCode, source_file_id AS sourceFileId
      FROM import_issues WHERE import_run_id = ?
    `).get(run.id) as { severity: string; issueCode: string; sourceFileId: number };
    expect(issue).toMatchObject({ severity: 'error', issueCode: 'IMPORT_INTERRUPTED' });
    expect(issue.sourceFileId).toBeGreaterThan(0);
  });

  it('rolls back startup recovery changes if a diagnostic cannot be recorded', () => {
    const now = new Date().toISOString();
    database.prepare("UPDATE source_files SET status = 'processing' WHERE snapshot_id = ?").run(snapshotId);
    database.prepare(`
      INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered)
      VALUES ('atomic-recovery-run', ?, 'import', 'running', ?, 5)
    `).run(snapshotId, now);
    database.exec(`
      CREATE TRIGGER reject_recovery_diagnostics
      BEFORE INSERT ON import_issues
      BEGIN
        SELECT RAISE(ABORT, 'synthetic diagnostics write failure');
      END;
    `);

    expect(() => recoverAllInterruptedImports(database)).toThrow('synthetic diagnostics write failure');
    const unchangedFiles = database.prepare('SELECT status FROM source_files WHERE snapshot_id = ?')
      .all(snapshotId) as Array<{ status: string }>;
    expect(unchangedFiles.every((file) => file.status === 'processing')).toBe(true);
    const unchangedRun = database.prepare("SELECT status FROM import_runs WHERE id = 'atomic-recovery-run'")
      .get() as { status: string };
    expect(unchangedRun.status).toBe('running');
    const unchangedSnapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?')
      .get(snapshotId) as { status: string };
    expect(unchangedSnapshot.status).toBe('discovered');

    database.exec('DROP TRIGGER reject_recovery_diagnostics');
    expect(recoverAllInterruptedImports(database)).toBe(1);
    const recoveredFiles = database.prepare('SELECT status FROM source_files WHERE snapshot_id = ?')
      .all(snapshotId) as Array<{ status: string }>;
    expect(recoveredFiles.every((file) => file.status === 'failed')).toBe(true);
  });

  it('skips completed files on a second import pass', async () => {
    await importAllSupportedData(database, snapshotId, root);
    database.prepare("UPDATE source_files SET status = 'completed' WHERE snapshot_id = ?").run(snapshotId);
    const result = await importAllSupportedData(database, snapshotId, root);
    expect(result.totals.filesAttempted).toBe(0);
    expect(result.totals.failedFiles).toBe(0);
    const snapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?')
      .get(snapshotId) as { status: string };
    expect(snapshot.status).toBe('completed');
  });
  it('recovers files and runs left in processing state after an interrupted session', async () => {
    const now = new Date().toISOString();
    database.prepare("UPDATE source_files SET status = 'processing' WHERE snapshot_id = ?").run(snapshotId);
    database.prepare(`
      INSERT INTO import_runs (id, snapshot_id, run_type, status, started_at, files_discovered)
      VALUES ('interrupted-run', ?, 'import', 'running', ?, 1)
    `).run(snapshotId, now);

    const result = await importAllSupportedData(database, snapshotId, root);
    expect(result.totals.filesAttempted).toBe(12);
    const recoveredFiles = database.prepare("SELECT status, safe_error_code, parser_key AS parserKey FROM source_files WHERE snapshot_id = ? ORDER BY relative_path")
      .all(snapshotId) as Array<{ status: string; safe_error_code: string | null; parserKey: string | null }>;
    expect(recoveredFiles.every((file) => file.status === 'completed' && file.safe_error_code === null && file.parserKey === 'html_fallback')).toBe(true);
    expect(recoveredFiles.map((file) => file.safe_error_code)).toEqual([
      null, null, null, null, null, null
    ]);
    const interruptedRun = database.prepare("SELECT status, errors_count FROM import_runs WHERE id = 'interrupted-run'")
      .get() as { status: string; errors_count: number };
    expect(interruptedRun).toEqual({ status: 'failed', errors_count: 6 });
    const interruptionIssues = database.prepare("SELECT COUNT(*) AS count FROM import_issues WHERE import_run_id = 'interrupted-run'")
      .get() as { count: number };
    expect(interruptionIssues.count).toBe(6);
    const snapshot = database.prepare('SELECT status FROM archive_snapshots WHERE id = ?')
      .get(snapshotId) as { status: string };
    expect(snapshot.status).toBe('partial');
  });

});
