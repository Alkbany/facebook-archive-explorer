import { describe, expect, it } from 'vitest';
import { normalizeSafeExternalUrl } from '../src/shared/text/safe-external-url';

describe('normalizeSafeExternalUrl', () => {
  it('accepts and normalizes HTTPS and HTTP URLs', () => {
    expect(normalizeSafeExternalUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(normalizeSafeExternalUrl(' http://example.com/path ')).toBe('http://example.com/path');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///C:/Windows/win.ini',
    'archive-media://asset/1',
    'not a URL',
    'https://user:password@example.com/',
    '',
    '   '
  ])('rejects unsafe or malformed URL: %s', (value) => {
    expect(normalizeSafeExternalUrl(value)).toBeNull();
  });

  it('rejects non-string values and oversized input', () => {
    expect(normalizeSafeExternalUrl(null)).toBeNull();
    expect(normalizeSafeExternalUrl({ url: 'https://example.com' })).toBeNull();
    expect(normalizeSafeExternalUrl('https://example.com/' + 'a'.repeat(4_100))).toBeNull();
  });
});
