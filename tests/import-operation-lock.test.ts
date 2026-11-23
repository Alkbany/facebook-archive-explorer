import { describe, expect, it } from 'vitest';
import {
  assertNoImportInProgress,
  getActiveImportName,
  runExclusiveImport
} from '../src/main/ipc/import-operation-lock';

describe('archive import operation lock', () => {
  it('prevents overlapping import requests and releases the lock after completion', async () => {
    let releaseFirst: (() => void) | null = null;
    const firstOperation = runExclusiveImport('Posts', () => new Promise<string>((resolve) => {
      releaseFirst = () => resolve('completed');
    }));

    expect(getActiveImportName()).toBe('Posts');
    expect(() => assertNoImportInProgress('switch backups')).toThrow('Posts import is running.');
    await expect(runExclusiveImport('Messages', async () => 'should not run'))
      .rejects.toThrow('Another import is already running: Posts.');

    releaseFirst?.();
    await expect(firstOperation).resolves.toBe('completed');
    expect(getActiveImportName()).toBeNull();
    expect(() => assertNoImportInProgress('switch backups')).not.toThrow();
  });

  it('releases the lock when an import throws', async () => {
    await expect(runExclusiveImport('Comments', async () => {
      throw new Error('synthetic importer failure');
    })).rejects.toThrow('synthetic importer failure');

    expect(getActiveImportName()).toBeNull();
  });
});
