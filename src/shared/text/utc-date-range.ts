export interface UtcDateRangeBounds {
  fromInclusive: string | null;
  toExclusive: string | null;
}

/**
 * Converts calendar dates into a half-open UTC interval. Source records with
 * unknown/ambiguous event_time_utc are intentionally excluded whenever a
 * date-range bound is active by the corresponding SQL comparisons.
 */
export function getUtcDateRangeBounds(
  dateFrom: string | null = null,
  dateTo: string | null = null
): UtcDateRangeBounds {
  function parseCalendarDate(value: string | null, label: string): string | null {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      throw new Error(`Invalid ${label} date. Use YYYY-MM-DD.`);
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error(`Invalid ${label} calendar date.`);
    }
    return value;
  }

  const from = parseCalendarDate(dateFrom, 'start');
  const to = parseCalendarDate(dateTo, 'end');
  if (from !== null && to !== null && from > to) {
    throw new Error('The search start date must not be later than the end date.');
  }

  const fromInclusive = from === null ? null : `${from}T00:00:00.000Z`;
  const toExclusive = to === null
    ? null
    : new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString();

  return { fromInclusive, toExclusive };
}
