import { describe, expect, it } from 'vitest';
import { getUtcDateRangeBounds } from '../src/shared/text/utc-date-range';

describe('UTC search date range', () => {
  it('builds an inclusive calendar-day range using a half-open UTC interval', () => {
    expect(getUtcDateRangeBounds('2022-01-01', '2022-12-31')).toEqual({
      fromInclusive: '2022-01-01T00:00:00.000Z',
      toExclusive: '2023-01-01T00:00:00.000Z'
    });
  });

  it('supports an open-ended start or end', () => {
    expect(getUtcDateRangeBounds('2022-06-01', null)).toEqual({
      fromInclusive: '2022-06-01T00:00:00.000Z',
      toExclusive: null
    });
    expect(getUtcDateRangeBounds(null, '2022-06-01')).toEqual({
      fromInclusive: null,
      toExclusive: '2022-06-02T00:00:00.000Z'
    });
    expect(getUtcDateRangeBounds(null, null)).toEqual({
      fromInclusive: null,
      toExclusive: null
    });
  });

  it('rejects invalid calendar dates, unsupported input formats, and reversed ranges', () => {
    expect(() => getUtcDateRangeBounds('2022-02-29', null)).toThrow(/calendar date/i);
    expect(() => getUtcDateRangeBounds('2022-13-01', null)).toThrow(/calendar date/i);
    expect(() => getUtcDateRangeBounds('01/02/2022', null)).toThrow(/YYYY-MM-DD/i);
    expect(() => getUtcDateRangeBounds('2023-01-01', '2022-12-31')).toThrow(/start date/i);
  });
});
