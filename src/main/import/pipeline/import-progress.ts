import type { ImportProgressEvent } from '../../../shared/archive/inspection';

export type ImportProgressReporter = (progress: ImportProgressEvent) => void;

/** Progress delivery must never interrupt an import transaction or file loop. */
export function reportImportProgress(
  reporter: ImportProgressReporter | undefined,
  progress: ImportProgressEvent
): void {
  if (!reporter) return;
  try {
    reporter(progress);
  } catch {
    // Renderer closure or a failed progress subscriber does not cancel import work.
  }
}
