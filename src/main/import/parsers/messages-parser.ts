import * as cheerio from 'cheerio';
import { basename, dirname, posix } from 'node:path';

export type MessageMediaKind = 'image' | 'video' | 'audio' | 'sticker' | 'other';

export interface MessageMediaReference {
  kind: MessageMediaKind;
  relativePath: string;
  element: 'img' | 'video' | 'audio' | 'source' | 'link';
}

export interface ParsedMessage {
  senderRaw: string | null;
  bodyRaw: string | null;
  timestampRaw: string | null;
  reactionsRaw: string[];
  media: MessageMediaReference[];
  sourceCardIndex: number;
  recordType: 'message' | 'call_event' | 'attachment';
}

export interface MessageParseIssue {
  code: 'no_message_cards_found' | 'missing_message_content';
  sourceCardIndex: number | null;
}

export interface MessageParseResult {
  messages: ParsedMessage[];
  issues: MessageParseIssue[];
}

const CARD_SELECTOR = 'div.pam._3-95._2pi0._2lej.uiBoxWhite.noborder';
const SENDER_SELECTOR = 'div._3-96._2pio._2lek._2lel';
const BODY_SELECTOR = 'div._3-96._2let';
const TIMESTAMP_SELECTOR = 'div._3-94._2lem';

function cleanText(value: string): string {
  return value.replace(/\u00a0/gu, ' ').trim();
}

function resolveLocalMediaPath(
  sourceFile: string,
  baseHref: string,
  candidate: string
): string | null {
  const value = candidate.trim();
  if (!value || value.startsWith('/') || value.startsWith('\\\\') ||
      /^[a-z][a-z0-9+.-]*:/iu.test(value) || value.startsWith('//')) {
    return null;
  }

  const base = baseHref && !/^[a-z][a-z0-9+.-]*:/iu.test(baseHref)
    ? baseHref
    : '.';
  const resolved = posix.normalize(posix.join(dirname(sourceFile), base, value));

  if (resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) {
    return null;
  }

  return resolved;
}

function mediaKind(path: string, element: MessageMediaReference['element']): MessageMediaKind {
  const lower = path.toLocaleLowerCase();
  if (lower.includes('/stickers_used/') || lower.startsWith('stickers_used/')) return 'sticker';
  if (element === 'audio') return 'audio';
  if (element === 'video') return 'video';
  if (/\.(mp4|mov|webm|m4v)(?:$|[?#])/iu.test(lower)) return 'video';
  if (/\.(mp3|m4a|aac|wav|ogg|opus)(?:$|[?#])/iu.test(lower)) return 'audio';
  if (/\.(png|jpe?g|gif|webp|bmp)(?:$|[?#])/iu.test(lower)) return 'image';
  return 'other';
}

/**
 * Parses one conversation HTML file. It preserves source order and raw dates,
 * extracts reactions separately, and records only safe archive-relative media
 * references. It never downloads or reads attachment bytes.
 */
export function parseMessageConversation(html: string, sourceFile: string): MessageParseResult {
  if (basename(sourceFile).length === 0 || sourceFile.includes('\\')) {
    throw new Error('Invalid conversation source path.');
  }

  const $ = cheerio.load(html);
  const baseHref = $('base[href]').first().attr('href') ?? '.';
  const cards = $(CARD_SELECTOR);
  const result: MessageParseResult = { messages: [], issues: [] };

  if (cards.length === 0) {
    result.issues.push({ code: 'no_message_cards_found', sourceCardIndex: null });
    return result;
  }

  cards.each((sourceCardIndex, element) => {
    const card = $(element);
    const senderText = cleanText(card.find(SENDER_SELECTOR).first().text());
    const bodyElement = card.find(BODY_SELECTOR).first();
    const bodyTextElement = bodyElement.clone();
    bodyTextElement.find('ul._tqp').remove();
    const bodyText = cleanText(bodyTextElement.text());
    const timestampText = cleanText(card.find(TIMESTAMP_SELECTOR).first().text());

    const reactionsRaw = card.find('ul._tqp li')
      .map((_index, reaction) => cleanText($(reaction).text()))
      .get()
      .filter(Boolean);

    const media: MessageMediaReference[] = [];
    const seen = new Set<string>();
    const addMedia = (
      candidate: string | undefined,
      elementType: MessageMediaReference['element']
    ): void => {
      if (!candidate) return;
      const relativePath = resolveLocalMediaPath(sourceFile, baseHref, candidate);
      if (!relativePath) return;
      const key = `${elementType}:${relativePath}`;
      if (seen.has(key)) return;
      seen.add(key);
      media.push({ kind: mediaKind(relativePath, elementType), relativePath, element: elementType });
    };

    bodyElement.find('img[src], video[src], audio[src], video source[src], audio source[src], a[href]')
      .each((_index, node) => {
        const element = $(node);
        const tagName = node.tagName?.toLowerCase();
        if (tagName === 'img') {
          addMedia(element.attr('src'), 'img');
          return;
        }
        if (tagName === 'video' || tagName === 'audio') {
          addMedia(element.attr('src'), tagName);
          return;
        }
        if (tagName === 'source') {
          const parent = element.parent().get(0)?.tagName?.toLowerCase();
          addMedia(element.attr('src'), parent === 'video' ? 'video' : 'audio');
          return;
        }
        const href = element.attr('href');
        if (href && /\\.(png|jpe?g|gif|webp|bmp|mp4|mov|webm|m4v|mp3|m4a|aac|wav|ogg|opus)(?:$|[?#])/iu.test(href)) {
          addMedia(href, 'link');
        }
      });

    const hasContent = Boolean(bodyText || media.length || reactionsRaw.length);
    if (!hasContent) {
      result.issues.push({ code: 'missing_message_content', sourceCardIndex });
      return;
    }

    const isCallEvent = /(?:اتصلت|اتصل|مكالمة|لم يتم الرد|مكالمة فائتة)/iu.test(bodyText);
    result.messages.push({
      senderRaw: senderText || null,
      bodyRaw: bodyText || null,
      timestampRaw: timestampText || null,
      reactionsRaw,
      media,
      sourceCardIndex,
      recordType: isCallEvent ? 'call_event' : media.length > 0 && !bodyText ? 'attachment' : 'message'
    });
  });

  return result;
}
