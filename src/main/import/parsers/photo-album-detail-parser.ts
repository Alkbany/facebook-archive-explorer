import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

export interface PhotoCommentRecord {
  authorRaw: string | null;
  bodyRaw: string | null;
  dateRaw: string | null;
}

export interface AlbumPhotoRecord {
  albumTitle: string | null;
  imagePath: string;
  originalPath: string | null;
  captionRaw: string | null;
  dateRaw: string | null;
  comments: PhotoCommentRecord[];
  sourceFile: string;
  sourceCardIndex: number;
}

export interface AlbumPhotoParseIssue {
  code: 'no_photo_cards_found' | 'photo_image_path_missing' | 'photo_card_without_image';
  sourceCardIndex: number | null;
}

export interface AlbumPhotoParseResult {
  albumTitle: string | null;
  photos: AlbumPhotoRecord[];
  issues: AlbumPhotoParseIssue[];
}

const CARD_SELECTOR = 'div.pam._3-95._2pi0._2lej.uiBoxWhite.noborder';
const CONTENT_SELECTOR = 'div._3-96._2let';
const COMMENT_SELECTOR = 'div.pas._3-94.uiBoxGray.noborder';
const DIRECTIONAL_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

function cleanText(value: string): string {
  return value.replace(/\u00a0/gu, ' ').replace(DIRECTIONAL_MARKS, '').replace(/\s+/gu, ' ').trim();
}

function rawText(value: string): string {
  return value.replace(/\u00a0/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function isSafePhotoPath(value: string): boolean {
  if (!value || value.startsWith('/') || value.includes('\\') ||
      /^(?:https?:|data:|file:|javascript:)/iu.test(value) ||
      value.includes('?') || value.includes('#')) return false;
  const segments = value.split('/');
  return segments[0] === 'photos_and_videos' &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function getCommentText($: cheerio.CheerioAPI, element: cheerio.Cheerio<Element>): string | null {
  const copy = element.clone();
  copy.find('span._3-8_._2oao').remove();
  copy.find('div._67gx').remove();
  copy.find('br').replaceWith('\n');
  const value = cleanText(copy.text());
  return value || null;
}

function parseComments($: cheerio.CheerioAPI, content: cheerio.Cheerio<Element>): PhotoCommentRecord[] {
  const comments: PhotoCommentRecord[] = [];
  content.children(COMMENT_SELECTOR).each((_index, element) => {
    const comment = $(element);
    const authorRaw = cleanText(comment.find('span._3-8_._2oao').first().text()) || null;
    const bodyRaw = getCommentText($, comment);
    const dateRaw = rawText(comment.find('div._67gx').first().text()) || null;
    if (!authorRaw && !bodyRaw && !dateRaw) return;
    comments.push({ authorRaw, bodyRaw, dateRaw });
  });
  return comments;
}

/**
 * Parses the sampled Facebook album-detail page. Comment and photo dates are
 * retained exactly as exported; no date conversion or timezone inference occurs.
 */
export function parsePhotoAlbumDetail(html: string, sourceFile: string): AlbumPhotoParseResult {
  const normalizedSource = sourceFile.replace(/\\/gu, '/');
  if (!/^photos_and_videos\/album\/[0-9]+\.html?$/u.test(normalizedSource)) {
    throw new Error('Unsupported Photos & Videos album detail source.');
  }

  const $ = cheerio.load(html);
  const result: AlbumPhotoParseResult = {
    albumTitle: cleanText($('div._3b0d').first().text()) || cleanText($('title').first().text()) || null,
    photos: [],
    issues: []
  };
  const cards = $(CARD_SELECTOR);
  if (cards.length === 0) {
    result.issues.push({ code: 'no_photo_cards_found', sourceCardIndex: null });
    return result;
  }

  cards.each((sourceCardIndex, element) => {
    const card = $(element);
    const content = card.children(CONTENT_SELECTOR).first();
    const anchor = content.find('a[href]').first();
    const image = anchor.find('img[src]').first();
    const hrefRaw = anchor.attr('href')?.trim().replace(/&amp;/gu, '&') ?? '';
    const srcRaw = image.attr('src')?.trim().replace(/&amp;/gu, '&') ?? '';
    const imagePath = isSafePhotoPath(srcRaw) ? srcRaw : (isSafePhotoPath(hrefRaw) ? hrefRaw : '');
    if (!imagePath) {
      result.issues.push({
        code: hrefRaw || srcRaw ? 'photo_image_path_missing' : 'photo_card_without_image',
        sourceCardIndex
      });
      return;
    }

    const captionRaw = cleanText(content.children('div._3-95').first().text()) || null;
    const dateRaw = rawText(card.children('div._3-94._2lem').first().text()) || null;
    result.photos.push({
      albumTitle: result.albumTitle,
      imagePath,
      originalPath: isSafePhotoPath(hrefRaw) ? hrefRaw : null,
      captionRaw,
      dateRaw,
      comments: parseComments($, content),
      sourceFile: normalizedSource,
      sourceCardIndex
    });
  });

  return result;
}
