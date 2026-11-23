let activeImportName: string | null = null;

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
  try {
    return await operation();
  } finally {
    activeImportName = null;
  }
}

export function getActiveImportName(): string | null {
  return activeImportName;
}
