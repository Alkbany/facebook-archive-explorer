import { describe, expect, it } from 'vitest';
import { facebookDateToUtc } from '../src/shared/time/facebook-date';

describe('facebookDateToUtc', () => {
  it('converts observed Unix-second timestamps to ISO UTC', () => {
    expect(facebookDateToUtc('1540000000')).toBe('2018-10-20T00:26:40.000Z');
  });

  it('converts Unix-millisecond timestamps to ISO UTC', () => {
    expect(facebookDateToUtc('1540000000000')).toBe('2018-10-20T00:26:40.000Z');
  });

  it('converts ISO timestamps only when an explicit timezone is present', () => {
    expect(facebookDateToUtc('2020-01-02T03:04:05+02:00')).toBe('2020-01-02T01:04:05.000Z');
    expect(facebookDateToUtc('2020-01-02T03:04:05')).toBeNull();
  });

  it('does not guess the timezone of localized Facebook HTML dates', () => {
    expect(facebookDateToUtc('١٥/١٠/٢٠١٨ ٧:٣٦ ص')).toBeNull();
    expect(facebookDateToUtc('15/10/2018 7:36 AM')).toBeNull();
  });

  it('rejects invalid, out-of-range, and non-date values', () => {
    expect(facebookDateToUtc(null)).toBeNull();
    expect(facebookDateToUtc('')).toBeNull();
    expect(facebookDateToUtc('not a date')).toBeNull();
    expect(facebookDateToUtc('1234567890')).toBeNull();
    expect(facebookDateToUtc('9999999999999')).toBeNull();
  });
});
