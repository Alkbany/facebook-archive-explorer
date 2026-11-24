import type { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import type { ArchiveSearchResult, SemanticSearchStatus } from '../../shared/archive/search';

export const SEMANTIC_MODEL_ID = 'Xenova/multilingual-e5-small';
export const SEMANTIC_MODEL_VERSION = 'multilingual-e5-small-v1';
const EMBEDDING_DIMENSIONS = 384;
const MAX_BATCH_SIZE = 8;
const MAX_SOURCE_CHARACTERS = 4_000;
const MAX_SEARCH_RESULTS = 250;
const MIN_SEMANTIC_SIMILARITY = 0.35;

interface EmbeddingTensor {
  data: Float32Array;
  dims: number[];
}

interface FeatureExtractor {
  (
    texts: string[],
    options: { pooling: 'mean'; normalize: true }
  ): Promise<EmbeddingTensor>;
}

interface TransformersEnvironment {
  cacheDir: string;
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
  useBrowserCache: boolean;
}

interface TransformersRuntime {
  env: TransformersEnvironment;
  pipeline(
    task: 'feature-extraction',
    model: string,
    options: { progress_callback: (progress: unknown) => void }
  ): Promise<unknown>;
}

interface RuntimeState {
  phase: SemanticSearchStatus['phase'];
  progressPercent: number | null;
  lastErrorCode: string | null;
}

interface PendingSemanticRecord {
  recordId: number;
  snapshotId: string;
  title: string | null;
  body: string | null;
  normalizedText: string | null;
}

const runtimeState: RuntimeState = {
  phase: 'idle',
  progressPercent: null,
  lastErrorCode: null
};

let extractorPromise: Promise<FeatureExtractor> | null = null;
const activeIndexers = new WeakMap<DatabaseSync, Promise<void>>();

function recordRuntimeProgress(progress: unknown): void {
  if (typeof progress !== 'object' || progress === null) return;
  const item = progress as { status?: unknown; progress?: unknown };
  if (item.status === 'download' || item.status === 'progress') {
    runtimeState.phase = 'downloading';
  } else if (item.status === 'initiate' || item.status === 'ready') {
    runtimeState.phase = 'loading';
  }
  if (typeof item.progress === 'number' && Number.isFinite(item.progress)) {
    runtimeState.progressPercent = Math.max(0, Math.min(100, item.progress));
  }
}

async function getFeatureExtractor(modelCacheDirectory: string): Promise<FeatureExtractor> {
  if (extractorPromise) return extractorPromise;

  runtimeState.phase = 'loading';
  runtimeState.lastErrorCode = null;
  extractorPromise = (async () => {
    await mkdir(modelCacheDirectory, { recursive: true });
    const runtime = await import('@huggingface/transformers') as unknown as TransformersRuntime;
    runtime.env.cacheDir = modelCacheDirectory;
    runtime.env.allowRemoteModels = true;
    runtime.env.allowLocalModels = true;
    runtime.env.useBrowserCache = false;

    const loaded = await runtime.pipeline('feature-extraction', SEMANTIC_MODEL_ID, {
      progress_callback: recordRuntimeProgress
    });
    runtimeState.phase = 'ready';
    runtimeState.progressPercent = 100;
    return loaded as FeatureExtractor;
  })().catch((error: unknown) => {
    extractorPromise = null;
    runtimeState.phase = 'error';
    runtimeState.progressPercent = null;
    runtimeState.lastErrorCode = 'SEMANTIC_MODEL_LOAD_FAILED';
    throw error;
  });

  return extractorPromise;
}

function makePassageText(record: PendingSemanticRecord): string {
  const title = record.title?.trim() ?? '';
  const body = (record.body ?? record.normalizedText ?? '').trim();
  const combined = [title, body].filter(Boolean).join('\n').slice(0, MAX_SOURCE_CHARACTERS);
  return 'passage: ' + combined;
}

async function embedTexts(
  extractor: FeatureExtractor,
  texts: string[]
): Promise<Float32Array[]> {
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  if (
    !Array.isArray(output.dims) ||
    output.dims.length < 2 ||
    output.dims[output.dims.length - 1] !== EMBEDDING_DIMENSIONS ||
    output.data.length !== texts.length * EMBEDDING_DIMENSIONS
  ) {
    throw new Error('The semantic embedding model returned an unexpected vector shape.');
  }

  const vectors: Float32Array[] = [];
  for (let index = 0; index < texts.length; index += 1) {
    const start = index * EMBEDDING_DIMENSIONS;
    vectors.push(Float32Array.from(output.data.subarray(start, start + EMBEDDING_DIMENSIONS)));
  }
  return vectors;
}

function beginTransaction(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE');
}

function saveBatch(
  database: DatabaseSync,
  rows: PendingSemanticRecord[],
  vectors: Float32Array[]
): void {
  const now = new Date().toISOString();
  const insertEmbedding = database.prepare(`
    INSERT INTO semantic_embeddings (
      record_id, snapshot_id, model_id, model_version, dimensions, embedding, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT setting_value FROM app_settings WHERE setting_key = 'semantic_search_enabled') = 'true'
      AND EXISTS (
        SELECT 1 FROM records
        WHERE id = ? AND snapshot_id = ?
          AND (
            (search_enabled = 1 AND sensitivity <> 'sensitive')
            OR (section_key = 'messages' AND sensitivity = 'sensitive'
              AND (SELECT setting_value FROM app_settings WHERE setting_key = 'include_messages_in_global_search') = 'true')
          )
      )
    ON CONFLICT(record_id, model_id, model_version) DO UPDATE SET
      snapshot_id = excluded.snapshot_id,
      dimensions = excluded.dimensions,
      embedding = excluded.embedding,
      created_at = excluded.created_at
  `);
  const updateJob = database.prepare(`
    UPDATE semantic_index_jobs
    SET status = 'completed', safe_error_code = NULL, updated_at = ?
    WHERE record_id = ? AND model_id = ? AND model_version = ?
      AND (SELECT setting_value FROM app_settings WHERE setting_key = 'semantic_search_enabled') = 'true'
      AND EXISTS (SELECT 1 FROM semantic_embeddings
        WHERE record_id = ? AND model_id = ? AND model_version = ?)
  `);

  beginTransaction(database);
  try {
    rows.forEach((row, index) => {
      const vector = vectors[index];
      const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
      insertEmbedding.run(
        row.recordId, row.snapshotId, SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION,
        EMBEDDING_DIMENSIONS, buffer, now, row.recordId, row.snapshotId
      );
      updateJob.run(now, row.recordId, SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION,
        row.recordId, SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION);
    });
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function markBatchFailed(database: DatabaseSync, rows: PendingSemanticRecord[], errorCode: string): void {
  const update = database.prepare(`
    UPDATE semantic_index_jobs
    SET status = 'failed', safe_error_code = ?, updated_at = ?
    WHERE record_id = ? AND model_id = ? AND model_version = ?
  `);
  const now = new Date().toISOString();
  beginTransaction(database);
  try {
    for (const row of rows) {
      update.run(errorCode, now, row.recordId, SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function getPendingBatch(database: DatabaseSync): PendingSemanticRecord[] {
  return database.prepare(`
    SELECT jobs.record_id AS recordId, jobs.snapshot_id AS snapshotId,
      records.title AS title, records.body_text AS body,
      records.normalized_text AS normalizedText
    FROM semantic_index_jobs AS jobs
    INNER JOIN records ON records.id = jobs.record_id
      AND records.snapshot_id = jobs.snapshot_id
    WHERE jobs.model_id = ? AND jobs.model_version = ?
      AND jobs.status = 'pending'
      AND (
        (records.search_enabled = 1 AND records.sensitivity <> 'sensitive')
        OR (records.section_key = 'messages' AND records.sensitivity = 'sensitive'
          AND (SELECT setting_value FROM app_settings WHERE setting_key = 'include_messages_in_global_search') = 'true')
      )
    ORDER BY jobs.updated_at ASC, jobs.record_id ASC
    LIMIT ?
  `).all(SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION, MAX_BATCH_SIZE) as unknown as PendingSemanticRecord[];
}

function hasPendingJobs(database: DatabaseSync): boolean {
  const row = database.prepare(`
    SELECT 1 AS pending
    FROM semantic_index_jobs
    WHERE model_id = ? AND model_version = ? AND status = 'pending'
    LIMIT 1
  `).get(SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION) as { pending: number } | undefined;
  return row !== undefined;
}

async function drainIndexQueue(database: DatabaseSync, modelCacheDirectory: string): Promise<void> {
  const enabled = database.prepare(
    "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'semantic_search_enabled'"
  ).get() as { value: string } | undefined;
  if (enabled?.value !== 'true') {
    runtimeState.phase = 'disabled';
    runtimeState.progressPercent = null;
    return;
  }

  database.prepare(`
    UPDATE semantic_index_jobs
    SET status = 'pending', updated_at = ?
    WHERE model_id = ? AND model_version = ? AND status = 'processing'
  `).run(new Date().toISOString(), SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION);

  // Loading/downloading happens only after the user enabled this feature.
  // Load even for an empty archive so the explicit enable action prepares the model.
  const extractor = await getFeatureExtractor(modelCacheDirectory);

  while (true) {
    const currentEnabled = database.prepare(
      "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'semantic_search_enabled'"
    ).get() as { value: string } | undefined;
    if (currentEnabled?.value !== 'true') {
      database.prepare(
        "UPDATE semantic_index_jobs SET status = 'pending', updated_at = ? WHERE status = 'processing' AND model_id = ? AND model_version = ?"
      ).run(new Date().toISOString(), SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION);
      runtimeState.phase = 'disabled';
      runtimeState.progressPercent = null;
      return;
    }
    const batch = getPendingBatch(database);
    if (batch.length === 0) break;

    const markProcessing = database.prepare(`
      UPDATE semantic_index_jobs
      SET status = 'processing', attempts = attempts + 1, updated_at = ?
      WHERE record_id = ? AND model_id = ? AND model_version = ? AND status = 'pending'
    `);
    const now = new Date().toISOString();
    beginTransaction(database);
    try {
      for (const row of batch) {
        markProcessing.run(now, row.recordId, SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }

    try {
      runtimeState.phase = 'indexing';
      runtimeState.progressPercent = null;
      const vectors = await embedTexts(extractor, batch.map(makePassageText));
      saveBatch(database, batch, vectors);
      runtimeState.lastErrorCode = null;
    } catch {
      const errorCode = runtimeState.lastErrorCode === 'SEMANTIC_MODEL_LOAD_FAILED'
        ? 'SEMANTIC_MODEL_LOAD_FAILED'
        : 'SEMANTIC_EMBEDDING_FAILED';
      try {
        markBatchFailed(database, batch, errorCode);
      } catch {
        runtimeState.lastErrorCode = 'SEMANTIC_INDEX_WRITE_FAILED';
      }
      runtimeState.phase = 'error';
      runtimeState.lastErrorCode = errorCode;
      break;
    }
  }

  if (runtimeState.phase !== 'error') {
    runtimeState.phase = hasPendingJobs(database) ? 'indexing' : (extractorPromise ? 'ready' : 'idle');
    runtimeState.progressPercent = runtimeState.phase === 'ready' ? 100 : null;
    runtimeState.lastErrorCode = null;
  }
}

/**
 * Queue processing is best-effort and isolated from archive import transactions.
 * Each batch is persisted separately so a restart resumes from unfinished jobs.
 */
export async function processSemanticIndexQueue(
  database: DatabaseSync,
  modelCacheDirectory: string
): Promise<void> {
  const current = activeIndexers.get(database);
  if (current) {
    await current;
    if (hasPendingJobs(database)) return processSemanticIndexQueue(database, modelCacheDirectory);
    return;
  }

  const task = drainIndexQueue(database, modelCacheDirectory);
  activeIndexers.set(database, task);
  try {
    await task;
  } finally {
    activeIndexers.delete(database);
  }
}

export function retryFailedSemanticJobs(database: DatabaseSync): number {
  const result = database.prepare(`
    UPDATE semantic_index_jobs
    SET status = 'pending', safe_error_code = NULL, updated_at = ?
    WHERE status = 'failed'
      AND model_id = ? AND model_version = ?
  `).run(new Date().toISOString(), SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION);
  runtimeState.lastErrorCode = null;
  runtimeState.phase = 'idle';
  runtimeState.progressPercent = null;
  return Number(result.changes);
}

export function getSemanticSearchStatus(database: DatabaseSync): SemanticSearchStatus {
  const settings = database.prepare(
    "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'semantic_search_enabled'"
  ).get() as { value: string } | undefined;
  const counts = database.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM semantic_index_jobs
    WHERE model_id = ? AND model_version = ?
  `).get(SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION) as {
    total: number; completed: number | null; pending: number | null;
    processing: number | null; failed: number | null;
  };

  const enabled = settings?.value === 'true';
  const pending = counts.pending ?? 0;
  const processing = counts.processing ?? 0;
  const failed = counts.failed ?? 0;
  const completed = counts.completed ?? 0;
  let phase: SemanticSearchStatus['phase'] = 'disabled';

  if (enabled) {
    if (runtimeState.phase === 'downloading' || runtimeState.phase === 'loading') {
      phase = runtimeState.phase;
    } else if (runtimeState.phase === 'error' || failed > 0) {
      phase = 'error';
    } else if (pending > 0 || processing > 0 || runtimeState.phase === 'indexing') {
      phase = 'indexing';
    } else if (runtimeState.phase === 'ready' || completed > 0) {
      phase = 'ready';
    } else {
      phase = 'idle';
    }
  }

  return {
    enabled,
    modelId: SEMANTIC_MODEL_ID,
    modelVersion: SEMANTIC_MODEL_VERSION,
    phase,
    total: counts.total ?? 0,
    completed,
    pending,
    processing,
    failed,
    progressPercent: enabled ? runtimeState.progressPercent : null,
    lastErrorCode: enabled ? runtimeState.lastErrorCode : null
  };
}

export async function createSemanticQueryEmbedding(
  query: string,
  modelCacheDirectory: string
): Promise<Float32Array> {
  if (typeof query !== 'string' || !query.trim() || query.length > 2_000) {
    throw new Error('Semantic search query must be between 1 and 2,000 characters.');
  }
  runtimeState.phase = 'loading';
  const extractor = await getFeatureExtractor(modelCacheDirectory);
  const [vector] = await embedTexts(extractor, ['query: ' + query.trim().slice(0, 2_000)]);
  if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error('The semantic query model returned an invalid vector.');
  }
  runtimeState.phase = 'ready';
  return vector;
}

export function searchSemanticArchiveRecords(
  database: DatabaseSync,
  snapshotId: string,
  queryVector: Float32Array,
  sectionKey: string | null = null,
  minimumSimilarity = MIN_SEMANTIC_SIMILARITY
): ArchiveSearchResult[] {
  if (queryVector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error('The semantic query vector has an unexpected dimension.');
  }
  const semanticEnabled = database.prepare(
    "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'semantic_search_enabled'"
  ).get() as { value: string } | undefined;
  if (semanticEnabled?.value !== 'true') {
    throw new Error('Semantic Search is not enabled.');
  }
  if (sectionKey === 'messages') {
    const enabled = database.prepare(
      "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'include_messages_in_global_search'"
    ).get() as { value: string } | undefined;
    if (enabled?.value !== 'true') return [];
  }

  const messageIndexEnabled = (database.prepare(
    "SELECT setting_value AS value FROM app_settings WHERE setting_key = 'include_messages_in_global_search'"
  ).get() as { value: string } | undefined)?.value === 'true';

  const statement = database.prepare(`
    SELECT records.id AS id, records.section_key AS sectionKey,
      records.record_type AS recordType, source.relative_path AS sourcePath,
      records.source_record_index AS sourceCardIndex, records.title AS title,
      records.body_text AS body, records.event_time_raw AS dateRaw,
      embeddings.embedding AS embedding, embeddings.dimensions AS dimensions
    FROM semantic_embeddings AS embeddings
    INNER JOIN records ON records.id = embeddings.record_id
      AND records.snapshot_id = embeddings.snapshot_id
    INNER JOIN source_files AS source ON source.id = records.source_file_id
      AND source.snapshot_id = records.snapshot_id
    WHERE embeddings.snapshot_id = ? AND embeddings.model_id = ? AND embeddings.model_version = ?
      AND (
        (records.search_enabled = 1 AND records.sensitivity <> 'sensitive')
        OR (records.section_key = 'messages' AND records.sensitivity = 'sensitive' AND ? = 1)
      )
      AND (? IS NULL OR records.section_key = ?)
    ORDER BY records.id ASC
  `);
  const candidates = statement.iterate(
    snapshotId, SEMANTIC_MODEL_ID, SEMANTIC_MODEL_VERSION,
    messageIndexEnabled ? 1 : 0, sectionKey, sectionKey
  ) as unknown as Iterable<Record<string, unknown>>;

  const top: ArchiveSearchResult[] = [];
  for (const raw of candidates) {
    const blob = raw.embedding;
    const dimensions = Number(raw.dimensions);
    if (!(blob instanceof Uint8Array) || dimensions !== EMBEDDING_DIMENSIONS || blob.byteLength !== dimensions * 4) {
      continue;
    }
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    let similarity = 0;
    for (let index = 0; index < dimensions; index += 1) {
      similarity += view.getFloat32(index * 4, true) * queryVector[index];
    }
    if (similarity < minimumSimilarity) continue;

    top.push({
      id: Number(raw.id),
      sectionKey: String(raw.sectionKey),
      recordType: String(raw.recordType),
      sourcePath: String(raw.sourcePath),
      sourceCardIndex: Number(raw.sourceCardIndex),
      title: typeof raw.title === 'string' ? raw.title : null,
      body: typeof raw.body === 'string' ? raw.body : null,
      dateRaw: typeof raw.dateRaw === 'string' ? raw.dateRaw : null,
      relevance: -similarity,
      matchType: 'semantic',
      similarity
    });
    top.sort((left, right) => right.similarity - left.similarity);
    if (top.length > MAX_SEARCH_RESULTS) top.pop();
  }

  return top;
}
