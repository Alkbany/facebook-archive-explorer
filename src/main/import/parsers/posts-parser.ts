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
  activityRaw: string | null;
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
const MEDIA_PATH_PREFIXES = ['photos_and_videos/', 'photos/', 'your_facebook_activity/posts/media/'];

function cleanText(value: string): string {
  return value.replace(/\u00a0/gu, ' ').trim();
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
    const block = $(element).clone();
    block.find('br').replaceWith('\n');
    const text = cleanText(block.text());
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
    const activityRaw = cleanText(card.find(AUTHOR_SELECTOR).first().text()) || null;
    const dateNode = card.find(DATE_SELECTOR).first();
    const dateRaw = cleanText(dateNode.text()) || null;
    const permalinkRaw = dateNode.find('a[href]').first().attr('href') ?? null;
    if (!bodyRaw && media.length === 0 && !activityRaw) {
      result.issues.push({ code: 'card_without_content', sourceCardIndex });
      return;
    }
    result.records.push({
      activityRaw,
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


function jsonString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeTngMediaPath(value: unknown): string | null {
  const path = jsonString(value);
  if (!path || path.length > 2000 || path.startsWith('/') ||
      /^[a-z][a-z0-9+.-]*:/iu.test(path) ||
      path.split(/[\\/]/u).some((part) => part === '..' || part === '.')) return null;
  return path.startsWith('your_facebook_activity/posts/media/') ? path : null;
}

/** Parses the observed TNG timeline-post array and only keeps local media URIs. */
export function parsePostsJsonExport(jsonText: string, sourceFile: string): PostsParseResult {
  const lowerPath = sourceFile.toLocaleLowerCase().replace(/\\/gu, '/');
  const fileName = basename(lowerPath);
  if (!lowerPath.includes('/your_facebook_activity/posts/') ||
      !/^your_posts__check_ins__photos_and_videos(?:_\\d+)?\\.json$/u.test(fileName)) {
    throw new Error('Unsupported TNG posts JSON source.');
  }

  const parsed: unknown = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    return { records: [], issues: [{ code: 'no_cards_found', sourceCardIndex: null }] };
  }
  if (parsed.length === 0) {
    return { records: [], issues: [{ code: 'no_cards_found', sourceCardIndex: null }] };
  }

  const records: PostRecord[] = [];
  const issues: PostsParseIssue[] = [];
  parsed.forEach((value, sourceCardIndex) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      issues.push({ code: 'card_without_content', sourceCardIndex });
      return;
    }
    const row = value as Record<string, unknown>;
    const activityRaw = jsonString(row.title);
    const bodyParts: string[] = [];
    const addBody = (text: string | null) => {
      if (text && !bodyParts.includes(text)) bodyParts.push(text);
    };

    const data = Array.isArray(row.data) ? row.data : [];
    for (const item of data) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      addBody(jsonString((item as Record<string, unknown>).post));
    }

    const media: PostMediaReference[] = [];
    const seenMedia = new Set<string>();
    const attachments = Array.isArray(row.attachments) ? row.attachments : [];
    for (const attachment of attachments) {
      if (typeof attachment !== 'object' || attachment === null || Array.isArray(attachment)) continue;
      const entries = Array.isArray((attachment as Record<string, unknown>).data)
        ? (attachment as Record<string, unknown>).data as unknown[]
        : [];
      for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const detail = entry as Record<string, unknown>;
        const mediaObject = typeof detail.media === 'object' && detail.media !== null && !Array.isArray(detail.media)
          ? detail.media as Record<string, unknown>
          : null;
        if (mediaObject) {
          const relativePath = safeTngMediaPath(mediaObject.uri);
          if (relativePath && !seenMedia.has(relativePath)) {
            seenMedia.add(relativePath);
            const extension = relativePath.split('.').pop()?.toLocaleLowerCase() ?? '';
            const isVideo = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', '3gp', '3gpp'].includes(extension);
            media.push({
              relativePath,
              tagName: isVideo ? 'video' : 'img',
              sourceAttribute: 'src',
              displayOrder: media.length
            });
          }
          addBody(jsonString(mediaObject.description));
        }
        const lifeEvent = typeof detail.life_event === 'object' && detail.life_event !== null && !Array.isArray(detail.life_event)
          ? detail.life_event as Record<string, unknown>
          : null;
        if (lifeEvent) {
          addBody(jsonString(lifeEvent.title));
          addBody(jsonString(lifeEvent.description));
        }
        // Place coordinates/addresses and external URLs are deliberately not indexed.
      }
    }

    const dateValue = row.timestamp;
    const dateRaw = typeof dateValue === 'number' && Number.isFinite(dateValue)
      ? String(dateValue)
      : jsonString(dateValue);
    const bodyRaw = bodyParts.join('\n') || null;
    if (!activityRaw && !bodyRaw && media.length === 0) {
      issues.push({ code: 'card_without_content', sourceCardIndex });
      return;
    }
    records.push({
      activityRaw,
      bodyRaw,
      dateRaw,
      permalinkRaw: null,
      media,
      sourceFile,
      sourceCardIndex
    });
  });
  return { records, issues };
}
