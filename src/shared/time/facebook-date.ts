/**
 * Converts only unambiguous Facebook timestamps to UTC.
 *
 * Numeric values are treated as Unix seconds (10 digits) or milliseconds
 * (13 digits). ISO strings are accepted only when they carry an explicit
 * timezone. Localized HTML dates require an explicit offset from that same
 * export's footer; unsupported formats and missing offsets remain raw.
 */
export function facebookDateToUtc(value: string | null): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  let milliseconds: number | null = null;
  if (/^\\d{10}$/u.test(raw)) {
    milliseconds = Number(raw) * 1000;
  } else if (/^\\d{13}$/u.test(raw)) {
    milliseconds = Number(raw);
  } else if (/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,3})?)?(?:Z|[+-]\\d{2}:?\\d{2})$/u.test(raw)) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) milliseconds = parsed;
  }

  if (milliseconds === null || !Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 2000 || year > 2100) return null;
  return date.toISOString();
}

/** Returns an explicit UTC offset found in a Facebook export footer, in minutes. */
export function facebookExportUtcOffsetMinutes(footerText: string | null): number | null {
  if (!footerText) return null;
  const normalized = footerText.replace(/[\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]/gu, '');
  const matches = [...normalized.matchAll(/\\bUTC\\s*([+-])\\s*(\\d{2})(?::?(\\d{2}))?(?=$|[^\\d])/giu)];
  if (matches.length === 0) return null;

  const offsets = new Set<number>();
  for (const match of matches) {
    const hours = Number(match[2]);
    const minutes = match[3] === undefined ? 0 : Number(match[3]);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
    const absolute = hours * 60 + minutes;
    offsets.add(match[1] === '-' ? -absolute : absolute);
  }
  return offsets.size === 1 ? [...offsets][0] : null;
}

function normalizeFacebookDigits(value: string): string {
  return value.replace(/[\\u0660-\\u0669\\u06F0-\\u06F9]/gu, (digit) =>
    String(digit.codePointAt(0)! >= 0x06f0
      ? digit.codePointAt(0)! - 0x06f0
      : digit.codePointAt(0)! - 0x0660)
  );
}

/**
 * Converts the observed Arabic Facebook HTML date format (D/M/YYYY H:MM ص|م)
 * only when the same export footer provides an explicit UTC offset.
 * This applies a fixed offset, not historical daylight-saving rules.
 */
export function facebookLocalizedHtmlDateToUtc(
  value: string | null,
  offsetMinutes: number | null
): string | null {
  if (!value || offsetMinutes === null ||
      !Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 14 * 60) return null;

  const normalized = normalizeFacebookDigits(value)
    .replace(/[\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]/gu, '')
    .replace(/\\s+/gu, ' ')
    .trim();
  const match = /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})\\s+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*([صم])$/u.exec(normalized);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour12 = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const marker = match[7];
  if (year < 2000 || year > 2100 || month < 1 || month > 12 ||
      hour12 < 1 || hour12 > 12 || minute > 59 || second > 59) return null;

  const hour24 = (hour12 % 12) + (marker === 'م' ? 12 : 0);
  const localAsUtc = new Date(Date.UTC(year, month - 1, day, hour24, minute, second));
  if (localAsUtc.getUTCFullYear() !== year ||
      localAsUtc.getUTCMonth() !== month - 1 ||
      localAsUtc.getUTCDate() !== day) return null;

  const utcMilliseconds = localAsUtc.getTime() - offsetMinutes * 60_000;
  const result = new Date(utcMilliseconds);
  if (!Number.isFinite(result.getTime())) return null;
  return result.toISOString();
}
