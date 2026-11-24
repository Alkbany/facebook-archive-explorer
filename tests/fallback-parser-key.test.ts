import { describe, expect, it } from 'vitest';
import { getFallbackParserKey } from '../src/main/import/pipeline/fallback-parser-key';

describe('fallback parser keys', () => {
  it('records a generic fallback when no reviewed parser ran first', () => {
    expect(getFallbackParserKey(null, 'json_fallback')).toBe('json_fallback');
  });

  it('records the reviewed parser that rejected the file to avoid repeated retries', () => {
    expect(getFallbackParserKey('posts_reviewed', 'json_fallback'))
      .toBe('posts_reviewed_json_fallback');
    expect(getFallbackParserKey('friends_reviewed', 'html_fallback'))
      .toBe('friends_reviewed_html_fallback');
  });

  it('keeps an existing fallback marker stable', () => {
    expect(getFallbackParserKey('posts_reviewed_json_fallback', 'json_fallback'))
      .toBe('posts_reviewed_json_fallback');
    expect(getFallbackParserKey('json_fallback', 'json_fallback')).toBe('json_fallback');
  });

  it('rejects invalid fallback parser identifiers', () => {
    expect(() => getFallbackParserKey(null, 'json fallback')).toThrow('Invalid fallback parser key');
  });
});
