import { describe, expect, it } from 'vitest';
import { facebookDateToUtc, facebookExportUtcOffsetMinutes, facebookLocalizedHtmlDateToUtc } from '../src/shared/time/facebook-date';

describe('facebookDateToUtc', () => {
  it('converts observed Unix-second timestamps to ISO UTC', () => {
    expect(facebookDateToUtc('1540000000')).toBe('2018-10-20T01:46:40.000Z');
  });

  it('converts Unix-millisecond timestamps to ISO UTC', () => {
    expect(facebookDateToUtc('1540000000000')).toBe('2018-10-20T01:46:40.000Z');
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
    expect(facebookDateToUtc('123456789')).toBeNull();
    expect(facebookDateToUtc('9999999999999')).toBeNull();
  });
});

describe('Facebook HTML export timezone metadata', () => {
  it('reads an explicit UTC offset from the export footer', () => {
    expect(facebookExportUtcOffsetMinutes('Created by Synthetic User at 10:00 PM UTC+02')).toBe(120);
    expect(facebookExportUtcOffsetMinutes('Export created at 10:00 UTC-05:30')).toBe(-330);
    expect(facebookExportUtcOffsetMinutes('Created at UTC+0200')).toBe(120);
  });

  it('fails closed when an explicit offset is absent, invalid, or conflicting', () => {
    expect(facebookExportUtcOffsetMinutes('Created by Synthetic User')).toBeNull();
    expect(facebookExportUtcOffsetMinutes('UTC+15')).toBeNull();
    expect(facebookExportUtcOffsetMinutes('UTC+14:01')).toBeNull();
    expect(facebookExportUtcOffsetMinutes('UTC+02 and UTC+03')).toBeNull();
  });

  it('converts the observed Arabic 12-hour date format using the supplied fixed offset', () => {
    expect(facebookLocalizedHtmlDateToUtc('‏٢٥‏/٠٧‏/٢٠١٧ ٨:٣٨ م‏', 120))
      .toBe('2017-07-25T18:38:00.000Z');
    expect(facebookLocalizedHtmlDateToUtc('‏١٥‏/٠٧‏/٢٠١٧ ٢:٢٥ ص‏', 120))
      .toBe('2017-07-15T00:25:00.000Z');
    expect(facebookLocalizedHtmlDateToUtc('١٢/٠٧/٢٠١٧ ١٢:٠٠ ص', 120))
      .toBe('2017-07-11T22:00:00.000Z');
    expect(facebookLocalizedHtmlDateToUtc('١٢/٠٧/٢٠١٧ ١٢:٠٠ م', 120))
      .toBe('2017-07-12T10:00:00.000Z');
  });

  it('does not infer an offset or accept unsupported and invalid localized dates', () => {
    expect(facebookLocalizedHtmlDateToUtc('٢٥/٠٧/٢٠١٧ ٨:٣٨ م', null)).toBeNull();
    expect(facebookLocalizedHtmlDateToUtc('25/07/2017 8:38 PM', 120)).toBeNull();
    expect(facebookLocalizedHtmlDateToUtc('٣٢/٠٧/٢٠١٧ ٨:٣٨ م', 120)).toBeNull();
    expect(facebookLocalizedHtmlDateToUtc('٢٥/٠٧/٢٠١٧ ١٣:٣٨ م', 120)).toBeNull();
    expect(facebookLocalizedHtmlDateToUtc('٢٥/٠٧/٢٠١٧ ٨:٣٨ م', null)).toBeNull();
  });
});
