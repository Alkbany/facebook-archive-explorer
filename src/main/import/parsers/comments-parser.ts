import * as cheerio from 'cheerio';
import { basename } from 'node:path';
import type { Element } from 'domhandler';

export interface CommentActivityRecord {
  activityRaw: string | null;
  bodyRaw: string | null;
  groupRaw: string | null;
  dateRaw: string | null;
  permalinkRaw: string | null;
  sourceFile: string;
  sourceCardIndex: number;
}
export interface CommentsParseIssue {
  code: 'no_cards_found' | 'card_without_content';
  sourceCardIndex: number | null;
}
export interface CommentsParseResult {
  records: CommentActivityRecord[];
  issues: CommentsParseIssue[];
}

const CARD_SELECTOR = 'div.pam._3-95._2pi0._2lej.uiBoxWhite.noborder';
const ACTIVITY_SELECTOR = 'div._3-96._2pio._2lek._2lel';
const CONTENT_SELECTOR = 'div._3-96._2let';
const DATE_SELECTOR = 'div._3-94._2lem';
const GROUP_META_SELECTOR = '._3-95:has(span._4mp8)';

function cleanText(value: string): string {
  return value.replace(/\u00a0/gu, ' ').trim();
}

function extractGroup(content: cheerio.Cheerio<Element>): string | null {
  const groupNode = content.find(GROUP_META_SELECTOR).first();
  if (groupNode.length === 0) return null;
  const copy = groupNode.clone();
  copy.find('span._4mp8').remove();
  const value = cleanText(copy.text()).replace(/^مجموعة\s*:\s*/u, '').trim();
  return value || null;
}

function extractBody($: cheerio.CheerioAPI, content: cheerio.Cheerio<Element>): string | null {
  const blocks: string[] = [];
  content.find('div._2pin').each((_index, element) => {
    const block = $(element).clone();
    block.find(GROUP_META_SELECTOR).remove();
    block.find('br').replaceWith('\n');
    const value = cleanText(block.text());
    if (value && !blocks.includes(value)) blocks.push(value);
  });
  if (blocks.length > 0) return blocks.join('\n');
  const fallback = content.clone();
  fallback.find(GROUP_META_SELECTOR).remove();
  fallback.find('br').replaceWith('\n');
  return cleanText(fallback.text()) || null;
}

/**
 * Parses the sampled Facebook comments/activity card layout. The activity
 * heading is retained verbatim because it distinguishes comments from replies.
 */
export function parseCommentsExport(html: string, sourceFile: string): CommentsParseResult {
  const lowerPath = sourceFile.toLocaleLowerCase();
  if (!lowerPath.startsWith('comments/') || !/\.html?$/u.test(lowerPath)) {
    throw new Error(`Unsupported comments source: ${basename(sourceFile)}`);
  }
  const $ = cheerio.load(html);
  const cards = $(CARD_SELECTOR);
  const result: CommentsParseResult = { records: [], issues: [] };
  if (cards.length === 0) {
    result.issues.push({ code: 'no_cards_found', sourceCardIndex: null });
    return result;
  }
  cards.each((sourceCardIndex, element) => {
    const card = $(element);
    const content = card.find(CONTENT_SELECTOR).first();
    const activityRaw = cleanText(card.find(ACTIVITY_SELECTOR).first().text()) || null;
    const bodyRaw = extractBody($, content);
    const groupRaw = extractGroup(content);
    const dateNode = card.find(DATE_SELECTOR).first();
    const dateRaw = cleanText(dateNode.text()) || null;
    const permalinkRaw = dateNode.find('a[href]').first().attr('href') ?? null;
    if (!activityRaw && !bodyRaw && !groupRaw) {
      result.issues.push({ code: 'card_without_content', sourceCardIndex });
      return;
    }
    result.records.push({
      activityRaw,
      bodyRaw,
      groupRaw,
      dateRaw,
      permalinkRaw,
      sourceFile,
      sourceCardIndex
    });
  });
  return result;
}


/** Parses the observed Accounts Center comments_v2 JSON array. */
export function parseCommentsJsonExport(jsonText: string, sourceFile: string): CommentsParseResult {
  const parsed: unknown = JSON.parse(jsonText);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { records: [], issues: [{ code: 'no_cards_found', sourceCardIndex: null }] };
  }
  const root = parsed as Record<string, unknown>;
  const items = Object.entries(root).find(([key]) => key.toLocaleLowerCase() === 'comments_v2')?.[1];
  if (!Array.isArray(items)) {
    return { records: [], issues: [{ code: 'no_cards_found', sourceCardIndex: null }] };
  }

  const records: CommentActivityRecord[] = [];
  const issues: CommentsParseIssue[] = [];
  items.forEach((item, sourceCardIndex) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      issues.push({ code: 'card_without_content', sourceCardIndex });
      return;
    }
    const row = item as Record<string, unknown>;
    const data = Array.isArray(row.data) ? row.data : [];
    const commentEntry = data.find((entry) =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry) &&
      Object.prototype.hasOwnProperty.call(entry, 'comment')
    ) as Record<string, unknown> | undefined;
    const comment = commentEntry?.comment;
    const detail = typeof comment === 'object' && comment !== null && !Array.isArray(comment)
      ? comment as Record<string, unknown>
      : {};
    const bodyRaw = typeof detail.comment === 'string' && detail.comment.trim()
      ? detail.comment.trim()
      : null;
    const activityRaw = typeof row.title === 'string' && row.title.trim()
      ? row.title.trim()
      : null;
    const groupRaw = typeof detail.group === 'string' && detail.group.trim()
      ? detail.group.trim()
      : null;
    const rawTime = typeof detail.timestamp === 'number' && Number.isFinite(detail.timestamp)
      ? detail.timestamp
      : row.timestamp;
    const dateRaw = typeof rawTime === 'number' && Number.isFinite(rawTime)
      ? String(rawTime)
      : typeof rawTime === 'string' && rawTime.trim()
        ? rawTime.trim()
        : null;

    if (!activityRaw && !bodyRaw && !groupRaw) {
      issues.push({ code: 'card_without_content', sourceCardIndex });
      return;
    }
    records.push({
      activityRaw,
      bodyRaw,
      groupRaw,
      dateRaw,
      permalinkRaw: null,
      sourceFile,
      sourceCardIndex
    });
  });
  return { records, issues };
}
