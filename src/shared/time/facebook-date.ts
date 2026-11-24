/**
 * Converts only unambiguous Facebook timestamps to UTC.
 *
 * Numeric values are treated as Unix seconds (10 digits) or milliseconds
 * (13 digits). ISO strings are accepted only when they carry an explicit
 * timezone. Locale-formatted HTML dates remain raw because their timezone
 * cannot be inferred safely.
 */
export function facebookDateToUtc(value: string | null): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  let milliseconds: number | null = null;
  if (/^\d{10}$/u.test(raw)) {
    milliseconds = Number(raw) * 1000;
  } else if (/^\d{13}$/u.test(raw)) {
    milliseconds = Number(raw);
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/u.test(raw)) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) milliseconds = parsed;
  }

  if (milliseconds === null || !Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 2000 || year > 2100) return null;
  return date.toISOString();
}
