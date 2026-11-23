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
    expect(getArchiveImportCapability('friends')).toBe('known-html');
    expect(getArchiveImportCapability('messages')).toBe('sampled-html');
    expect(getArchiveImportCapability('photos_and_videos')).toBe('media-index-only');
    expect(getArchiveImportCapability('groups')).toBe('not-implemented');
    expect(getArchiveImportCapability('unknown-section')).toBe('not-implemented');
  });

  it('classifies account security and payment data as sensitive', () => {
    expect(getArchiveSection('security_and_login_information')?.sensitivity).toBe('sensitive');
    expect(getArchiveSection('payment_history')?.sensitivity).toBe('sensitive');
  });
});
