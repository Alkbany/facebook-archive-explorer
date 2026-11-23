const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

/**
 * Creates a search-only representation. Always keep the original exported text.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(BIDI_CONTROLS, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[إأآٱ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/ـ/gu, '')
    .toLocaleLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}
