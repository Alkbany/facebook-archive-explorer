import type { DatabaseSync } from 'node:sqlite';
import type { ImportAllSupportedDataResult } from '../../../shared/archive/inspection';
import { importFriendsSection } from './friends-importer';
import { importMessagesSection } from './messages-importer';
import { importPostsSection } from './posts-importer';
import { importCommentsSection } from './comments-importer';
import { importReactionsSection } from './reactions-importer';

/**
 * Runs only importers backed by reviewed card structures. Each importer keeps
 * its own per-file transaction and status; completed files are skipped on
 * subsequent runs while failed/unsupported files remain eligible for retry.
 */
export async function importAllSupportedData(
  database: DatabaseSync,
  snapshotId: string,
  archiveRoot: string
): Promise<ImportAllSupportedDataResult> {
  const friends = await importFriendsSection(database, snapshotId, archiveRoot);
  const messages = await importMessagesSection(database, snapshotId, archiveRoot);
  const posts = await importPostsSection(database, snapshotId, archiveRoot);
  const comments = await importCommentsSection(database, snapshotId, archiveRoot);
  const reactions = await importReactionsSection(database, snapshotId, archiveRoot);

  const sections = { friends, messages, posts, comments, reactions };
  const totals = Object.values(sections).reduce<ImportAllSupportedDataResult['totals']>((result, section) => {
    const mediaReferences = 'mediaReferences' in section ? section.mediaReferences : 0;
    return {
      filesAttempted: result.filesAttempted + section.filesAttempted,
      recordsImported: result.recordsImported + section.recordsImported,
      mediaReferences: result.mediaReferences + mediaReferences,
      unsupportedFiles: result.unsupportedFiles + section.unsupportedFiles,
      failedFiles: result.failedFiles + section.failedFiles
    };
  }, {
    filesAttempted: 0,
    recordsImported: 0,
    mediaReferences: 0,
    unsupportedFiles: 0,
    failedFiles: 0
  });

  return { sections, totals };
}
