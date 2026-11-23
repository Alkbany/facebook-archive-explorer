import { describe, expect, it } from 'vitest';
import { parseSingleByteRange } from '../src/main/database/media-range';

describe('media byte ranges', () => {
  it('returns null when the client requests the complete file', () => {
    expect(parseSingleByteRange(null, 100)).toBeNull();
  });
  it('parses explicit and open-ended ranges', () => {
    expect(parseSingleByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseSingleByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
  });
  it('supports suffix ranges and clamps the end to the file size', () => {
    expect(parseSingleByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseSingleByteRange('bytes=95-120', 100)).toEqual({ start: 95, end: 99 });
  });
  it('rejects malformed, multiple, and unsatisfiable ranges', () => {
    expect(parseSingleByteRange('bytes=1-2,4-5', 100)).toBe('invalid');
    expect(parseSingleByteRange('bytes=100-', 100)).toBe('invalid');
    expect(parseSingleByteRange('bytes=-0', 100)).toBe('invalid');
    expect(parseSingleByteRange('items=1-2', 100)).toBe('invalid');
  });
});
