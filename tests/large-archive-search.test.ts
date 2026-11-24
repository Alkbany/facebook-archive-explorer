import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openAppDatabase } from '../src/main/database/connection';
import { getOrCreateAccount } from '../src/main/database/archive-repository';
import { searchArchiveRecords } from '../src/main/database/search-repository';

const migrationFiles = [
  { version: 1, name: 'initial_schema', file: '001_initial_schema.sql' },
  { version: 2, name: 'account_names', file: '002_account_names.sql' },
  { version: 6, name: 'search_preferences', file: '006_search_preferences.sql' },
  { version: 7, name: 'semantic_search', file: '007_semantic_search.sql' }
];
const migrations = migrationFiles.map(({ version, name, file }) => ({
  version,
  name,
  sql: readFileSync(join(process.cwd(), 'src/main/database/migrations', file), 'utf8')
}));

const SYNTHETIC_RECORD_COUNT = 50_000;
const EXPECTED_MATCHES = SYNTHETIC_RECORD_COUNT / 10;
const PAGE_LIMIT = 250;

function tokenFor(index: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let value = index;
  let token = '';
  do {
    token = alphabet[value % alphabet.length] + token;
    value = Math.floor(value / alphabet.length);
  } while (value > 0);
  return token.padStart(8, 'a');
}

describe('large synthetic archive search benchmark', () => {
  let database: DatabaseSync | null = null;

  afterEach(() => {
    database?.close();
    database = null;
  });

  it('benchmarks Exact and Fuzzy Search over 50,000 indexed records', () => {
    database = openAppDatabase(':memory:', migrations);
    const accountId = getOrCreateAccount(database, 'Synthetic 50k performance account');
    const snapshotId = 'synthetic-50k-search-snapshot';
    const now = new Date().toISOString();

    database.prepare(`
      INSERT INTO archive_snapshots (
        id, account_id, display_name, source_kind, source_path, status, created_at, updated_at
      ) VALUES (?, ?, 'Synthetic 50k archive', 'directory', '/synthetic/50k', 'completed', ?, ?)
    `).run(snapshotId, accountId, now, now);

    const sourceFileId = Number(database.prepare(`
      INSERT INTO source_files (
        snapshot_id, relative_path, file_name, section_key, detected_format, status, discovered_at
      ) VALUES (?, 'posts/large_synthetic_archive.html', 'large_synthetic_archive.html',
        'posts', 'html', 'completed', ?)
    `).run(snapshotId, now).lastInsertRowid);

    const insertRecord = database.prepare(`
      INSERT INTO records (
        snapshot_id, source_file_id, source_record_index, section_key, record_type,
        title, body_text, normalized_text, sensitivity, search_enabled, payload_json, created_at
      ) VALUES (?, ?, ?, 'posts', 'post', ?, ?, ?, 'personal', 1, '{}', ?)
    `);

    // Keep the fixture deterministic and insert in one transaction so this
    // measures the search engine rather than per-row SQLite commit overhead.
    database.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < SYNTHETIC_RECORD_COUNT; index += 1) {
        const uniqueToken = tokenFor(index);
        const hasTargetTerm = index % 10 === 0;
        const title = `Synthetic archive entry ${index}`;
        const body = hasTargetTerm
          ? `Alexandria archive phrase ${uniqueToken}`
          : `Local archive phrase ${uniqueToken}`;
        const normalized = (title + ' ' + body).toLocaleLowerCase();
        insertRecord.run(
          snapshotId, sourceFileId, index, title, body, normalized, now
        );
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }

    const indexedCount = database.prepare(
      'SELECT COUNT(*) AS count FROM record_search'
    ).get() as { count: number };
    expect(indexedCount.count).toBe(SYNTHETIC_RECORD_COUNT);

    const exactStart = performance.now();
    const exactResults = searchArchiveRecords(
      database, snapshotId, 'Alexandria', 'posts', 'exact'
    );
    const exactElapsedMs = performance.now() - exactStart;

    expect(exactResults).toHaveLength(PAGE_LIMIT);
    expect(exactResults.every((result) =>
      result.sectionKey === 'posts' &&
      result.matchType === 'exact' &&
      (result.body ?? '').includes('Alexandria')
    )).toBe(true);
    const exactSecondPage = searchArchiveRecords(
      database, snapshotId, 'Alexandria', 'posts', 'exact', 0.8, null, null, PAGE_LIMIT
    );
    expect(exactSecondPage).toHaveLength(PAGE_LIMIT);
    expect(new Set([...exactResults, ...exactSecondPage].map((result) => result.id)).size)
      .toBe(PAGE_LIMIT * 2);

    const fuzzyStart = performance.now();
    const fuzzyResults = searchArchiveRecords(
      database, snapshotId, 'Alexandrea', 'posts', 'fuzzy', 0.8
    );
    const fuzzyElapsedMs = performance.now() - fuzzyStart;

    expect(fuzzyResults).toHaveLength(PAGE_LIMIT);
    expect(fuzzyResults.every((result) =>
      result.sectionKey === 'posts' &&
      result.matchType === 'fuzzy' &&
      result.similarity >= 0.8 &&
      (result.body ?? '').includes('Alexandria')
    )).toBe(true);
    const fuzzySecondPage = searchArchiveRecords(
      database, snapshotId, 'Alexandrea', 'posts', 'fuzzy', 0.8, null, null, PAGE_LIMIT
    );
    expect(fuzzySecondPage).toHaveLength(PAGE_LIMIT);
    expect(new Set([...fuzzyResults, ...fuzzySecondPage].map((result) => result.id)).size)
      .toBe(PAGE_LIMIT * 2);

    console.info(
      '[synthetic-search-benchmark]',
      JSON.stringify({
        indexedRecords: indexedCount.count,
        expectedMatchingRecords: EXPECTED_MATCHES,
        returnedPerMode: PAGE_LIMIT,
        exactSearchMs: Number(exactElapsedMs.toFixed(2)),
        fuzzySearchMs: Number(fuzzyElapsedMs.toFixed(2))
      })
    );
  });
});
