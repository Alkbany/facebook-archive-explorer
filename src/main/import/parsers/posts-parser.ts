import * as cheerio from 'cheerio';
import { basename } from 'node:path';
import type { Element } from 'domhandler';

export interface PostMediaReference {
  relativePath: string;
  tagName: 'img' | 'video' | 'audio' | 'link';
  sourceAttribute: 'src' | 'href';
  displayOrder: number;
}
export interface PostRecord {
  authorRaw: string | null;
  bodyRaw: string | null;
  dateRaw: string | null;
  permalinkRaw: string | null;
  media: PostMediaReference[];
  sourceFile: string;
  sourceCardIndex: number;
}
export interface PostsParseIssue { code: 'no_cards_found' | 'card_without_content'; sourceCardIndex: number | null; }
export interface PostsParseResult { records: PostRecord[]; issues: PostsParseIssue[]; }

const CARD_SELECTOR = 'div.pam._3-95._2pi0._2lej.uiBoxWhite.noborder';
const AUTHOR_SELECTOR = 'div._3-96._2pio._2lek._2lel';
const CONTENT_SELECTOR = 'div._3-96._2let';
const DATE_SELECTOR = 'div._3-94._2lem';
const MEDIA_PATH_PREFIXES = ['photos_and_videos/', 'photos/'];

function cleanText(value: string): string {
  return value.replace(/\u00a0/gu, ' ').replace(/[\u200e\u200f\u202a-\u202e]/gu, '').trim();
}

function collectMedia($: cheerio.CheerioAPI, content: cheerio.Cheerio<Element>): PostMediaReference[] {
  const found: PostMediaReference[] = [];
  const seen = new Map<string, number>();
  content.find('img[src], video[src], audio[src], video source[src], audio source[src], a[href]').each((_index, element) => {
    const node = $(element);
    const tag = element.tagName.toLowerCase();
    const attribute = tag === 'a' ? 'href' : 'src';
    const raw = node.attr(attribute);
    if (!raw) return;
    const normalized = raw.replace(/&amp;/gu, '&');
    if (/^(?:https?:|data:|file:|javascript:)/iu.test(normalized) ||
        normalized.startsWith('/') || normalized.split('/').includes('..') ||
        !MEDIA_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return;
    const key = normalized;
    const previousIndex = seen.get(key);
    if (previousIndex !== undefined) {
      if (tag === 'img' || tag === 'video' || tag === 'audio') {
        found[previousIndex].tagName = tag;
        found[previousIndex].sourceAttribute = 'src';
      }
      return;
    }
    seen.set(key, found.length);
    found.push({
      relativePath: normalized,
      tagName: tag === 'source' ? 'video' : tag as PostMediaReference['tagName'],
      sourceAttribute: attribute,
      displayOrder: found.length
    });
  });
  return found;
}

function extractBody($: cheerio.CheerioAPI, content: cheerio.Cheerio<Element>): string | null {
  const blocks: string[] = [];
  content.find('div._2pin').each((_index, element) => {
    const text = cleanText($(element).text());
    if (text && !blocks.includes(text)) blocks.push(text);
  });
  if (blocks.length === 0) {
    const fallback = cleanText(content.text());
    return fallback || null;
  }
  return blocks.join('\n');
}

/** Parses the supplied Facebook posts card layout. Original dates and links remain raw. */
export function parsePostsExport(html: string, sourceFile: string): PostsParseResult {
  const lowerPath = sourceFile.toLocaleLowerCase();
  if (!lowerPath.startsWith('posts/') || !/\.html?$/u.test(lowerPath)) {
    throw new Error(`Unsupported posts source: ${basename(sourceFile)}`);
  }
  const $ = cheerio.load(html);
  const cards = $(CARD_SELECTOR);
  const result: PostsParseResult = { records: [], issues: [] };
  if (cards.length === 0) {
    result.issues.push({ code: 'no_cards_found', sourceCardIndex: null });
    return result;
  }
  cards.each((sourceCardIndex, element) => {
    const card = $(element);
    const content = card.find(CONTENT_SELECTOR).first();
    const bodyRaw = extractBody($, content);
    const media = collectMedia($, content);
    const authorRaw = cleanText(card.find(AUTHOR_SELECTOR).first().text()) || null;
    const dateNode = card.find(DATE_SELECTOR).first();
    const dateRaw = cleanText(dateNode.text()) || null;
    const permalinkRaw = dateNode.find('a[href]').first().attr('href') ?? null;
    if (!bodyRaw && media.length === 0 && !authorRaw) {
      result.issues.push({ code: 'card_without_content', sourceCardIndex });
      return;
    }
    result.records.push({
      authorRaw,
      bodyRaw,
      dateRaw,
      permalinkRaw,
      media,
      sourceFile,
      sourceCardIndex
    });
  });
  return result;
}
