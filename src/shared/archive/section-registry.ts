export type SectionEvidence = 'sampled' | 'filename-only' | 'no-data';
export type SectionSensitivity = 'standard' | 'personal' | 'sensitive';

export interface ArchiveSectionDefinition {
  key: string;
  title: string;
  evidence: SectionEvidence;
  sensitivity: SectionSensitivity;
}

/**
 * Planning catalogue only. "sampled" means a representative structure was
 * reviewed; it does not mean a production parser exists. Runtime discovery
 * must always verify the actual export contents.
 */
export const ARCHIVE_SECTIONS: readonly ArchiveSectionDefinition[] = [
  { key: 'about_you', title: 'About you', evidence: 'filename-only', sensitivity: 'sensitive' },
  { key: 'ads', title: 'Ads', evidence: 'filename-only', sensitivity: 'personal' },
  { key: 'apps_and_websites', title: 'Apps and websites', evidence: 'filename-only', sensitivity: 'personal' },
  { key: 'calls_and_messages', title: 'Calls and messages', evidence: 'sampled', sensitivity: 'sensitive' },
  { key: 'comments', title: 'Comments', evidence: 'sampled', sensitivity: 'personal' },
  { key: 'events', title: 'Events', evidence: 'filename-only', sensitivity: 'personal' },
  { key: 'following_and_followers', title: 'Following and followers', evidence: 'filename-only', sensitivity: 'personal' },
  { key: 'friends', title: 'Friends', evidence: 'sampled', sensitivity: 'sensitive' },
  { key: 'groups', title: 'Groups', evidence: 'filename-only', sensitivity: 'personal' },
  { key: 'likes_and_reactions', title: 'Likes and reactions', evidence: 'sampled', sensitivity: 'personal' },
  { key: 'location', title: 'Location', evidence: 'no-data', sensitivity: 'sensitive' },
  { key: 'marketplace', title: 'Marketplace', evidence: 'filename-only', sensitivity: 'personal' },
  { key: 'messages', title: 'Messages', evidence: 'sampled', sensitivity: 'sensitive' },
  { key: 'other_activity', title: 'Other activity', evidence: 'filename-only', sensitivity: 'personal' },
  { key: 'pages', title: 'Pages', evidence: 'sampled', sensitivity: 'personal' },
  { key: 'payment_history', title: 'Payment history', evidence: 'filename-only', sensitivity: 'sensitive' },
  { key: 'photos_and_videos', title: 'Photos and videos', evidence: 'sampled', sensitivity: 'sensitive' },
  { key: 'posts', title: 'Posts', evidence: 'sampled', sensitivity: 'personal' },
  { key: 'profile_information', title: 'Profile information', evidence: 'filename-only', sensitivity: 'sensitive' },
  { key: 'saved_items_and_collections', title: 'Saved items and collections', evidence: 'filename-only', sensitivity: 'personal' },
  { key: 'search_history', title: 'Search history', evidence: 'filename-only', sensitivity: 'sensitive' },
  { key: 'security_and_login_information', title: 'Security and login information', evidence: 'filename-only', sensitivity: 'sensitive' },
  { key: 'your_places', title: 'Your places', evidence: 'no-data', sensitivity: 'sensitive' }
];

export function getArchiveSection(key: string): ArchiveSectionDefinition | undefined {
  return ARCHIVE_SECTIONS.find((section) => section.key === key);
}
