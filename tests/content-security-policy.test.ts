import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('renderer Content Security Policy', () => {
  const html = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u)?.[1] ?? '';

  it('keeps script execution and active content restricted to the local application', () => {
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).not.toMatch(/(?:^|[;\\s])\\*(?:[;\\s]|$)/u);
    expect(policy).not.toContain('https:');
  });

  it('allows the custom local archive protocol only for media playback', () => {
    expect(policy).toContain("media-src 'self' archive-media: data: blob:");
    expect(policy).not.toMatch(/(?:img-src|script-src|connect-src)[^;]*archive-media:/u);
  });
});
