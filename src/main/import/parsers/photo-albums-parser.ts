import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

export interface PhotoAlbumRecord {
  albumTitle: string;
  headingRaw: string;
  photoCount: number | null;
  photoCountRaw: string | null;
  albumPath: string;
  coverPath: string | null;
  dateRaw: string | null;
  sourceFile: string;
  sourceCardIndex: number;
}

export interface PhotoAlbumsParseIssue {
  code: 'no_album_cards_found' | 'album_link_missing' | 'album_title_missing';
  sourceCardIndex: number | null;
}

export interface PhotoAlbumsParseResult {
  records: PhotoAlbumRecord[];
  issues: PhotoAlbumsParseIssue[];
}

const CARD_SELECTOR = 'div.pam._3-95._2pi0._2lej.uiBoxWhite.noborder';
const TITLE_SELECTOR = 'div._3-96._2pio._2lek._2lel';
const DATE_SELECTOR = 'div._3-94._2lem';
const ALBUM_PATH_PATTERN = /^photos_and_videos\/album\/[0-9]+\.html$/u;
const DIRECTIONAL_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

function cleanText(value: string): string {
  return value.replace(/\u00a0/gu, ' ').replace(DIRECTIONAL_MARKS, '').replace(/\s+/gu, ' ').trim();
}

function isSafeArchivePath(value: string): boolean {
  if (!value || value.includes('\\') || value.startsWith('/') ||
      /^(?:https?:|data:|file:|javascript:)/iu.test(value) ||
      value.includes('?') || value.includes('#')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function normalizeDigits(value: string): string {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const easternArabicIndic = '۰۱۲۳۴۵۶۷۸۹';
  return value.replace(/[٠-٩۰-۹]/gu, (digit) => {
    const arabicIndex = arabicIndic.indexOf(digit);
    if (arabicIndex >= 0) return String(arabicIndex);
    const easternIndex = easternArabicIndic.indexOf(digit);
    return easternIndex >= 0 ? String(easternIndex) : digit;
  });
}

function parseAlbumHeading(headingRaw: string): {
  albumTitle: string;
  photoCount: number | null;
  photoCountRaw: string | null;
} {
  const heading = cleanText(headingRaw);
  const countMatch = /(?:^|\s[-–—]\s*)([0-9٠-٩۰-۹]+)\s*(?:photos?|صور|صورة|صوره)\s*$/iu.exec(heading);
  if (!countMatch) {
    return { albumTitle: heading, photoCount: null, photoCountRaw: null };
  }

  const albumTitle = heading.slice(0, countMatch.index).replace(/\s*[-–—]\s*$/u, '').trim();
  const photoCountRaw = countMatch[1];
  const parsed = Number(normalizeDigits(photoCountRaw));
  return {
    albumTitle: albumTitle || heading,
    photoCount: Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null,
    photoCountRaw
  };
}

function getCoverPath($: cheerio.CheerioAPI, card: cheerio.Cheerio<Element>): string | null {
  const image = card.find('a[href] img[src]').first();
  const raw = image.attr('src');
  if (!raw) return null;
  const path = raw.trim();
  if (!path.startsWith('photos_and_videos/') || !isSafeArchivePath(path)) return null;
  return path;
}

/**
 * Parses the Facebook "Your Photos" album index page. It intentionally does
 * not parse album detail pages; those have a separate, not-yet-verified layout.
 */
export function parsePhotoAlbumsIndex(html: string, sourceFile: string): PhotoAlbumsParseResult {
  const normalizedSource = sourceFile.replace(/\\/gu, '/');
  if (!normalizedSource.startsWith('photos_and_videos/') ||
      normalizedSource.split('/').some((segment) => segment === '..') ||
      !/\.html?$/iu.test(normalizedSource) ||
      normalizedSource.split('/').length !== 2) {
    throw new Error('Unsupported Photos & Videos index source.');
  }

  const $ = cheerio.load(html);
  const cards = $(CARD_SELECTOR);
  const result: PhotoAlbumsParseResult = { records: [], issues: [] };
  if (cards.length === 0) {
    result.issues.push({ code: 'no_album_cards_found', sourceCardIndex: null });
    return result;
  }

  const seenAlbumPaths = new Set<string>();
  cards.each((sourceCardIndex, element) => {
    const card = $(element);
    const rawPath = card.find('a[href]').first().attr('href');
    const albumPath = typeof rawPath === 'string' ? rawPath.trim().replace(/&amp;/gu, '&') : '';
    if (!ALBUM_PATH_PATTERN.test(albumPath) || !isSafeArchivePath(albumPath)) {
      result.issues.push({ code: 'album_link_missing', sourceCardIndex });
      return;
    }
    if (seenAlbumPaths.has(albumPath)) return;
    seenAlbumPaths.add(albumPath);

    const headingRaw = card.find(TITLE_SELECTOR).first().text();
    const parsedHeading = parseAlbumHeading(headingRaw);
    if (!parsedHeading.albumTitle) {
      result.issues.push({ code: 'album_title_missing', sourceCardIndex });
      return;
    }

    const dateRaw = cleanText(card.find(DATE_SELECTOR).first().text()) || null;
    result.records.push({
      ...parsedHeading,
      albumTitle: parsedHeading.albumTitle,
      headingRaw: cleanText(headingRaw),
      albumPath,
      coverPath: getCoverPath($, card),
      dateRaw,
      sourceFile: normalizedSource,
      sourceCardIndex
    });
  });

  return result;
}
