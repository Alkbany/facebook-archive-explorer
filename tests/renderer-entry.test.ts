import { describe, expect, it } from 'vitest';
import { resolveRendererEntry } from '../src/main/renderer-entry';

describe('resolveRendererEntry', () => {
  it('always uses the bundled local renderer in a packaged application', () => {
    expect(resolveRendererEntry(true, 'https://attacker.example/renderer')).toEqual({ kind: 'file' });
    expect(resolveRendererEntry(true, 'http://localhost:5173/')).toEqual({ kind: 'file' });
  });

  it('accepts local loopback HTTP URLs only for unpackaged development', () => {
    expect(resolveRendererEntry(false, 'http://localhost:5173/')).toEqual({
      kind: 'development-url',
      url: 'http://localhost:5173/',
      origin: 'http://localhost:5173'
    });
    expect(resolveRendererEntry(false, 'http://127.0.0.1:5173/')).toMatchObject({
      kind: 'development-url',
      origin: 'http://127.0.0.1:5173'
    });
    expect(resolveRendererEntry(false, 'http://[::1]:5173/')).toMatchObject({
      kind: 'development-url',
      origin: 'http://[::1]:5173'
    });
  });

  it('rejects remote, non-HTTP, malformed, and credential-bearing development URLs', () => {
    for (const value of [
      'https://attacker.example/renderer',
      'http://192.168.1.20:5173/',
      'file:///tmp/renderer.html',
      'data:text/html,hello',
      'http://user:password@localhost:5173/',
      'not a URL'
    ]) {
      expect(resolveRendererEntry(false, value)).toEqual({ kind: 'file' });
    }
    expect(resolveRendererEntry(false, undefined)).toEqual({ kind: 'file' });
  });
});
