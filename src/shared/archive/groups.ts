export type GroupActivityKind = 'post' | 'comment' | 'membership' | 'unknown';

export interface GroupActivityMetadata {
  kind: GroupActivityKind;
  label: string;
  groupName: string | null;
  authorName: string | null;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null;
}

function firstDataEntry(payload: JsonObject): JsonObject | null {
  const data = payload.data;
  return Array.isArray(data) ? asObject(data[0]) : null;
}

/**
 * Derives only fields present in the three reviewed Accounts Center Groups schemas.
 * Unknown filenames or incomplete payload previews never get guessed metadata.
 */
export function getGroupActivityMetadata(sourcePath: string, payloadPreview: string): GroupActivityMetadata {
  const fileName = sourcePath.split(/[\\/]/u).pop()?.toLocaleLowerCase() ?? '';
  let payload: JsonObject | null = null;
  try {
    payload = asObject(JSON.parse(payloadPreview) as unknown);
  } catch {
    // The stored preview can be truncated; retain the filename-derived activity label only.
  }

  if (fileName === 'group_posts_and_comments.json') {
    return { kind: 'post', label: 'Group post', groupName: null, authorName: null };
  }

  if (fileName === 'your_comments_in_groups.json') {
    const comment = asObject(firstDataEntry(payload ?? {})?.comment);
    return {
      kind: 'comment',
      label: 'Group comment',
      groupName: asText(comment?.group),
      authorName: asText(comment?.author)
    };
  }

  if (fileName === 'your_group_membership_activity.json') {
    return {
      kind: 'membership',
      label: 'Group membership',
      groupName: asText(firstDataEntry(payload ?? {})?.name),
      authorName: null
    };
  }

  return { kind: 'unknown', label: 'Group record', groupName: null, authorName: null };
}
