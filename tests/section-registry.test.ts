import { describe, expect, it } from 'vitest';
import { ARCHIVE_SECTIONS, getArchiveImportCapability, getArchiveSection } from '../src/shared/archive/section-registry';

describe('archive section catalogue', () => {
  it('contains unique section keys', () => {
    const keys = ARCHIVE_SECTIONS.map((section) => section.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('marks the two observed empty sections explicitly', () => {
    expect(getArchiveSection('location')?.evidence).toBe('no-data');
    expect(getArchiveSection('your_places')?.evidence).toBe('no-data');
  });

  it('does not claim filename-only sections have been sampled', () => {
    expect(getArchiveSection('following_and_followers')?.evidence).toBe('filename-only');
  });

  it('describes parser availability separately from sampled section evidence', () => {
    expect(getArchiveImportCapability('friends')).toBe('known-html-json');
    expect(getArchiveImportCapability('messages')).toBe('sampled-html-json');
    expect(getArchiveImportCapability('posts')).toBe('sampled-html-json');
    expect(getArchiveImportCapability('photos_and_videos')).toBe('sampled-html-json');
    expect(getArchiveImportCapability('groups')).toBe('sampled-json');
    expect(getArchiveSection('groups')?.evidence).toBe('sampled');
    expect(getArchiveImportCapability('events')).toBe('generic-fallback');
    expect(getArchiveImportCapability('unknown-section')).toBe('generic-fallback');
  });

  it('classifies account security and payment data as sensitive', () => {
    expect(getArchiveSection('security_and_login_information')?.sensitivity).toBe('sensitive');
    expect(getArchiveSection('payment_history')?.sensitivity).toBe('sensitive');
  });
});
