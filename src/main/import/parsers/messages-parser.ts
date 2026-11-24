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
  rawPayload?: unknown;
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


function safeTngMessageMediaPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return null;
  const candidate = value.trim();
  if (
    !candidate.startsWith('your_facebook_activity/messages/') ||
    candidate.startsWith('/') ||
    /^[a-z][a-z0-9+.-]*:/iu.test(candidate) ||
    candidate.split('/').some((part) => part === '.' || part === '..' || !part)
  ) return null;
  return candidate;
}

/** Parses the observed Accounts Center message_*.json conversation structure. */
export function parseMessageConversationJson(jsonText: string, sourceFile: string): MessageParseResult {
  const normalizedPath = sourceFile.toLocaleLowerCase().replace(/\\/gu, '/');
  if (
    !normalizedPath.startsWith('your_facebook_activity/messages/') ||
    !/^message_\d+\.json$/u.test(basename(normalizedPath))
  ) {
    throw new Error('Unsupported Accounts Center message JSON source.');
  }

  const parsed: unknown = JSON.parse(jsonText);
  const root = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  const sourceMessages = root && Array.isArray(root.messages) ? root.messages : [];
  const result: MessageParseResult = { messages: [], issues: [] };
  if (sourceMessages.length === 0) {
    result.issues.push({ code: 'no_message_cards_found', sourceCardIndex: null });
    return result;
  }

  sourceMessages.slice(0, 10000).forEach((value, sourceCardIndex) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      result.issues.push({ code: 'missing_message_content', sourceCardIndex });
      return;
    }
    const message = value as Record<string, unknown>;
    const senderRaw = typeof message.sender_name === 'string' && message.sender_name.trim()
      ? cleanText(message.sender_name)
      : null;
    const bodyParts: string[] = [];
    const content = typeof message.content === 'string' ? cleanText(message.content) : '';
    const share = typeof message.share === 'object' && message.share !== null && !Array.isArray(message.share)
      ? message.share as Record<string, unknown>
      : null;
    const shareText = typeof share?.share_text === 'string' ? cleanText(share.share_text) : '';
    if (content) bodyParts.push(content);
    if (shareText && !bodyParts.includes(shareText)) bodyParts.push(shareText);
    if (message.is_unsent === true && bodyParts.length === 0) bodyParts.push('This message was unsent.');

    const media: MessageMediaReference[] = [];
    const seen = new Set<string>();
    const addMedia = (candidate: unknown, explicitKind?: MessageMediaKind) => {
      const relativePath = safeTngMessageMediaPath(candidate);
      if (!relativePath || seen.has(relativePath)) return;
      seen.add(relativePath);
      media.push({
        kind: explicitKind ?? mediaKind(relativePath, 'img'),
        relativePath,
        element: 'img'
      });
    };

    if (Array.isArray(message.photos)) {
      for (const photo of message.photos) {
        if (typeof photo !== 'object' || photo === null || Array.isArray(photo)) continue;
        addMedia((photo as Record<string, unknown>).uri);
      }
    }
    if (typeof message.sticker === 'object' && message.sticker !== null && !Array.isArray(message.sticker)) {
      addMedia((message.sticker as Record<string, unknown>).uri, 'sticker');
    }

    const reactionsRaw = Array.isArray(message.reactions)
      ? message.reactions.flatMap((reaction) => {
        if (typeof reaction !== 'object' || reaction === null || Array.isArray(reaction)) return [];
        const value = (reaction as Record<string, unknown>).reaction;
        return typeof value === 'string' && value.trim() ? [cleanText(value)] : [];
      })
      : [];
    const timestamp = message.timestamp_ms;
    const timestampRaw = typeof timestamp === 'number' && Number.isFinite(timestamp)
      ? String(timestamp)
      : typeof timestamp === 'string' && timestamp.trim()
        ? timestamp.trim()
        : null;
    const bodyRaw = bodyParts.join('\n') || null;
    if (!bodyRaw && media.length === 0 && reactionsRaw.length === 0) {
      result.issues.push({ code: 'missing_message_content', sourceCardIndex });
      return;
    }

    const isCallEvent = typeof message.call_duration === 'number' ||
      typeof message.video_chat === 'object' && message.video_chat !== null;
    result.messages.push({
      senderRaw,
      bodyRaw,
      timestampRaw,
      reactionsRaw,
      media,
      sourceCardIndex,
      recordType: isCallEvent ? 'call_event' : media.length > 0 && !bodyRaw ? 'attachment' : 'message',
      rawPayload: message
    });
  });

  return result;
}
