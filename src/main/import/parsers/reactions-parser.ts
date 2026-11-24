import * as cheerio from 'cheerio';
import { basename } from 'node:path';

export interface ReactionRecord {
  descriptionRaw: string | null;
  reactionType: string | null;
  reactionImageRaw: string | null;
  dateRaw: string | null;
  sourceFile: string;
  sourceCardIndex: number;
}
export interface ReactionParseIssue { code: 'no_cards_found' | 'card_without_description_or_reaction'; sourceCardIndex: number | null; }
export interface ReactionParseResult { records: ReactionRecord[]; issues: ReactionParseIssue[]; }

const CARD_SELECTOR = 'div.pam._3-95._2pi0._2lej.uiBoxWhite.noborder';
const DESCRIPTION_SELECTOR = 'div._3-96._2pio._2lek._2lel';
const REACTION_IMAGE_SELECTOR = 'div._3-96._2let div._2pin img';
const DATE_SELECTOR = 'div._3-94._2lem';
const REACTION_BY_IMAGE: Readonly<Record<string, string>> = {
  'like.png': 'like', 'love.png': 'love', 'haha.png': 'haha',
  'wow.png': 'wow', 'sorry.png': 'sorry'
};

function cleanText(value: string): string {
  return value.replace(/\u00a0/gu, ' ').trim();
}

/** Parses only the observed Likes & Reactions card structure; dates stay raw. */
export function parseReactionsExport(html: string, sourceFile: string): ReactionParseResult {
  if (!sourceFile.toLocaleLowerCase().includes('likes_and_reactions')) {
    throw new Error(`Unsupported reactions source: ${basename(sourceFile)}`);
  }
  const $ = cheerio.load(html);
  const cards = $(CARD_SELECTOR);
  const result: ReactionParseResult = { records: [], issues: [] };
  if (cards.length === 0) {
    result.issues.push({ code: 'no_cards_found', sourceCardIndex: null });
    return result;
  }
  cards.each((sourceCardIndex, element) => {
    const card = $(element);
    const description = cleanText(card.find(DESCRIPTION_SELECTOR).first().text());
    const image = card.find(REACTION_IMAGE_SELECTOR).first();
    const imageRaw = image.attr('src') ?? image.attr('alt') ?? null;
    const imageName = imageRaw?.split(/[\\/]/u).pop()?.toLocaleLowerCase() ?? '';
    const reactionType = REACTION_BY_IMAGE[imageName] ?? null;
    if (!description && !imageRaw) {
      result.issues.push({ code: 'card_without_description_or_reaction', sourceCardIndex });
      return;
    }
    const date = cleanText(card.find(DATE_SELECTOR).first().text());
    result.records.push({
      descriptionRaw: description || null,
      reactionType,
      reactionImageRaw: imageRaw,
      dateRaw: date || null,
      sourceFile,
      sourceCardIndex
    });
  });
  return result;
}


function jsonLabelValue(labels: unknown[], targetLabel: string): string | null {
  for (const item of labels) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.label === 'string' && entry.label.toLocaleLowerCase() === targetLabel.toLocaleLowerCase() &&
        typeof entry.value === 'string' && entry.value.trim()) {
      return entry.value.trim();
    }
  }
  return null;
}

function nestedOwnerName(labels: unknown[]): string | null {
  for (const item of labels) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.title === 'string' && entry.title.toLocaleLowerCase() === 'owner' && Array.isArray(entry.dict)) {
      const pending: unknown[] = [...entry.dict];
      while (pending.length > 0) {
        const value = pending.shift();
        if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
        const nested = value as Record<string, unknown>;
        if (typeof nested.label === 'string' && nested.label.toLocaleLowerCase() === 'name' &&
            typeof nested.value === 'string' && nested.value.trim()) return nested.value.trim();
        if (Array.isArray(nested.dict)) pending.push(...nested.dict);
      }
    }
  }
  return null;
}

/** Parses both observed Accounts Center Likes & Reactions JSON representations. */
export function parseReactionsJsonExport(jsonText: string, sourceFile: string): ReactionParseResult {
  const lowerPath = sourceFile.toLocaleLowerCase();
  const fileName = basename(lowerPath);
  if (!/^likes_and_reactions(?:_\d+)?\.json$/u.test(fileName)) {
    throw new Error('Unsupported reactions JSON filename.');
  }
  const parsed: unknown = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    return { records: [], issues: [{ code: 'no_cards_found', sourceCardIndex: null }] };
  }

  const records: ReactionRecord[] = [];
  const issues: ReactionParseIssue[] = [];
  parsed.forEach((value, sourceCardIndex) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      issues.push({ code: 'card_without_description_or_reaction', sourceCardIndex });
      return;
    }
    const row = value as Record<string, unknown>;
    const dateRaw = typeof row.timestamp === 'number' && Number.isFinite(row.timestamp)
      ? String(row.timestamp)
      : typeof row.timestamp === 'string' && row.timestamp.trim()
        ? row.timestamp.trim()
        : null;
    const data = Array.isArray(row.data) ? row.data : [];
    const reactionEntry = data.find((entry) =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry) &&
      Object.prototype.hasOwnProperty.call(entry, 'reaction')
    ) as Record<string, unknown> | undefined;
    const reactionData = typeof reactionEntry?.reaction === 'object' &&
      reactionEntry.reaction !== null && !Array.isArray(reactionEntry.reaction)
      ? reactionEntry.reaction as Record<string, unknown>
      : null;
    const labels = Array.isArray(row.label_values) ? row.label_values : [];

    const reactionRaw = typeof reactionData?.reaction === 'string'
      ? reactionData.reaction
      : jsonLabelValue(labels, 'Reaction');
    const reactionType = reactionRaw ? reactionRaw.toLocaleLowerCase() : null;
    const activityTitle = typeof row.title === 'string' && row.title.trim()
      ? row.title.trim()
      : null;
    const ownerName = jsonLabelValue(labels, 'Name') ?? nestedOwnerName(labels);
    const descriptionRaw = activityTitle ??
      (ownerName ? 'Reaction involving ' + ownerName : null);
    if (!reactionType && !descriptionRaw) {
      issues.push({ code: 'card_without_description_or_reaction', sourceCardIndex });
      return;
    }
    records.push({
      descriptionRaw,
      reactionType,
      reactionImageRaw: null,
      dateRaw,
      sourceFile,
      sourceCardIndex
    });
  });
  return { records, issues };
}
