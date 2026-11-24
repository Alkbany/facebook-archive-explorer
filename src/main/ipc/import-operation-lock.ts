let activeImportName: string | null = null;
let pauseRequested = false;
let pauseWaiters: Array<() => void> = [];

export function assertNoImportInProgress(action: string): void {
  if (activeImportName) {
    throw new Error('Cannot ' + action + ' while ' + activeImportName + ' import is running.');
  }
}

export async function runExclusiveImport<T>(
  importName: string,
  operation: () => Promise<T>
): Promise<T> {
  if (activeImportName) {
    throw new Error('Another import is already running: ' + activeImportName + '.');
  }

  activeImportName = importName;
  pauseRequested = false;
  try {
    return await operation();
  } finally {
    activeImportName = null;
    pauseRequested = false;
    const waiters = pauseWaiters;
    pauseWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

/** Requests a pause at the next source-file boundary; the current file remains atomic. */
export function pauseActiveImport(): boolean {
  if (!activeImportName) return false;
  pauseRequested = true;
  return true;
}

/** Resumes a paused import and releases all workers waiting at a file boundary. */
export function resumeActiveImport(): boolean {
  if (!activeImportName) return false;
  pauseRequested = false;
  const waiters = pauseWaiters;
  pauseWaiters = [];
  waiters.forEach((resolve) => resolve());
  return true;
}

/** Called by importers before starting each file so a pause never interrupts a file transaction. */
export async function waitIfImportPaused(): Promise<void> {
  while (pauseRequested) {
    await new Promise<void>((resolve) => pauseWaiters.push(resolve));
  }
}

export function isImportPaused(): boolean {
  return pauseRequested;
}

export function getActiveImportName(): string | null {
  return activeImportName;
}
