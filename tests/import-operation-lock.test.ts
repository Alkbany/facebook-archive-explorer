import { describe, expect, it } from 'vitest';
import {
  assertNoImportInProgress,
  getActiveImportName,
  pauseActiveImport,
  resumeActiveImport,
  waitIfImportPaused,
  runExclusiveImport
} from '../src/main/ipc/import-operation-lock';

describe('archive import operation lock', () => {
  it('prevents overlapping import requests and releases the lock after completion', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstOperation = runExclusiveImport('Posts', () => new Promise<string>((resolve) => {
      releaseFirst = () => resolve('completed');
    }));

    expect(getActiveImportName()).toBe('Posts');
    expect(() => assertNoImportInProgress('switch backups')).toThrow('Posts import is running.');
    await expect(runExclusiveImport('Messages', async () => 'should not run'))
      .rejects.toThrow('Another import is already running: Posts.');

    releaseFirst();
    await expect(firstOperation).resolves.toBe('completed');
    expect(getActiveImportName()).toBeNull();
    expect(() => assertNoImportInProgress('switch backups')).not.toThrow();
  });

  it('pauses at a file boundary and resumes without releasing the import lock', async () => {
    let allowCheckpoint: () => void = () => undefined;
    let announceReady: () => void = () => undefined;
    let finished = false;
    const checkpointBarrier = new Promise<void>((resolve) => { allowCheckpoint = resolve; });
    const ready = new Promise<void>((resolve) => { announceReady = resolve; });
    const operation = runExclusiveImport('Import All', async () => {
      announceReady();
      await checkpointBarrier;
      await waitIfImportPaused();
      finished = true;
      return 'continued';
    });

    await ready;
    expect(pauseActiveImport()).toBe(true);
    allowCheckpoint();
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(getActiveImportName()).toBe('Import All');

    expect(resumeActiveImport()).toBe(true);
    await expect(operation).resolves.toBe('continued');
    expect(finished).toBe(true);
    expect(getActiveImportName()).toBeNull();
    expect(pauseActiveImport()).toBe(false);
  });

  it('releases the lock when an import throws', async () => {
    await expect(runExclusiveImport('Comments', async () => {
      throw new Error('synthetic importer failure');
    })).rejects.toThrow('synthetic importer failure');

    expect(getActiveImportName()).toBeNull();
  });
});
