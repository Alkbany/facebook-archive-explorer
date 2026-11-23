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
