import { describe, expect, it } from 'vitest';
import { normalizeSearchText } from '../src/shared/text/normalize';

describe('normalizeSearchText', () => {
  it('normalizes Arabic alef variants', () => {
    expect(normalizeSearchText('أحمد إكرامي آمال')).toBe('احمد اكرامي امال');
  });

  it('removes Arabic diacritics and tatweel', () => {
    expect(normalizeSearchText('مُحَمَّد ـ علي')).toBe('محمد علي');
  });

  it('removes bidirectional formatting controls from search text', () => {
    expect(normalizeSearchText('رسالة\u200f جديدة')).toBe('رسالة جديدة');
  });

  it('collapses whitespace and lowercases Latin text', () => {
    expect(normalizeSearchText('  Hello   FACEBOOK  ')).toBe('hello facebook');
  });

  it('does not mutate the original input string', () => {
    const original = 'إختبار';
    normalizeSearchText(original);
    expect(original).toBe('إختبار');
  });
});
