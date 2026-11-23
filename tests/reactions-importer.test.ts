import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { importReactionsSection } from '../src/main/import/pipeline/reactions-importer';
import { listReactionRecords } from '../src/main/database/activity-repository';

describe('Likes & Reactions import', () => {
  let database: DatabaseSync;
  let root: string;
  let snapshotId: string;

  beforeEach(async () => {
    const migrations = [
      { version: 1, name: 'initial_schema', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') },
      { version: 2, name: 'unique_account_display_names', sql: await readFile(join(process.cwd(), 'src/main/database/migrations/002_account_names.sql'), 'utf8') }
    ];
    database = openAppDatabase(':memory:', migrations);
    root = await mkdtemp(join(tmpdir(), 'reactions-import-test-'));
    await mkdir(join(root, 'likes_and_reactions'), { recursive: true });
    const accountId = getOrCreateAccount(database, 'Synthetic reactions account');
    snapshotId = 'reactions-snapshot-test';
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO archive_snapshots (id, account_id, display_name, source_kind, source_path, status, created_at, updated_at) VALUES (?, ?, ?, 'directory', ?, 'discovered', ?, ?)`)
      .run(snapshotId, accountId, 'Synthetic export', root, now, now);
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('imports raw descriptions and dates while preserving reaction type', async () => {
    const html = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">Synthetic reaction description</div>
      <div class="_3-96 _2let"><div class="_2pin"><img src="reaction/love.png"></div></div>
      <div class="_3-94 _2lem"><a>Raw reaction date</a></div>
    </div>`;
    await writeFile(join(root, 'likes_and_reactions', 'sample.html'), html, 'utf8');
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) VALUES (?, ?, ?, 'likes_and_reactions', 'html', 'discovered', ?)`)
      .run(snapshotId, 'likes_and_reactions/sample.html', 'sample.html', now);

    const result = await importReactionsSection(database, snapshotId, root);
    expect(result).toEqual({ filesAttempted: 1, recordsImported: 1, unsupportedFiles: 0, failedFiles: 0 });
    const record = database.prepare('SELECT title, body_text, event_time_raw, payload_json FROM records WHERE snapshot_id = ?')
      .get(snapshotId) as { title: string; body_text: string; event_time_raw: string; payload_json: string };
    expect(record).toMatchObject({
      title: 'love',
      body_text: 'Synthetic reaction description',
      event_time_raw: 'Raw reaction date'
    });
    expect(record.payload_json).toContain('reaction/love.png');
    const visible = listReactionRecords(database, snapshotId);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ reactionType: 'love', descriptionRaw: 'Synthetic reaction description', dateRaw: 'Raw reaction date' });
  });

  it('marks unrecognized reaction pages as unsupported', async () => {
    await writeFile(join(root, 'likes_and_reactions', 'unknown.html'), '<html><body>Unknown layout</body></html>', 'utf8');
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO source_files (snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at) VALUES (?, ?, ?, 'likes_and_reactions', 'html', 'discovered', ?)`)
      .run(snapshotId, 'likes_and_reactions/unknown.html', 'unknown.html', now);
    const result = await importReactionsSection(database, snapshotId, root);
    expect(result.unsupportedFiles).toBe(1);
    const row = database.prepare('SELECT status FROM source_files WHERE snapshot_id = ?').get(snapshotId) as { status: string };
    expect(row.status).toBe('unsupported');
  });
});
