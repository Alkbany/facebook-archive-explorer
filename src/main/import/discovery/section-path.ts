import { getArchiveSection } from '../../../shared/archive/section-registry';

export function getSectionKeyForArchivePath(relativePath: string): string {
  const segments = relativePath.split(/[\\/]/u).filter(Boolean);
  if (segments.length === 0) return 'root';
  if (segments.length === 1) return 'root';

  const normalized = segments.map((segment) => segment.toLocaleLowerCase());
  const [root, category, subcategory] = normalized;
  const fileName = normalized[normalized.length - 1];

  const commentsOrReactions = (): string => {
    if (fileName.startsWith('likes_and_reactions')) return 'likes_and_reactions';
    if (fileName.startsWith('comments') || fileName.startsWith('your_comment_edits')) return 'comments';
    return 'other_activity';
  };

  if (root === 'your_facebook_activity') {
    switch (category) {
      case 'posts':
        if (
          subcategory === 'album' ||
          subcategory === 'media' ||
          fileName.startsWith('your_videos') ||
          fileName.startsWith('your_uncategorized_photos')
        ) return 'photos_and_videos';
        return 'posts';
      case 'comments_and_reactions':
        return commentsOrReactions();
      case 'messages':
        return 'messages';
      case 'groups':
        return 'groups';
      case 'events':
        return 'events';
      case 'marketplace':
        return 'marketplace';
      case 'saved_items':
      case 'saved_items_and_collections':
        return 'saved_items_and_collections';
      default:
        return 'your_facebook_activity';
    }
  }

  if (root === 'comments_and_reactions') return commentsOrReactions();

  if (root === 'connections') {
    if (category === 'friends') return 'friends';
    if (category === 'following_and_followers' || category === 'followers' || category === 'following') {
      return 'following_and_followers';
    }
    return 'connections';
  }

  if (root === 'logged_information') {
    if (category === 'search') return 'search_history';
    if (category === 'location' || category === 'locations') return 'location';
    return 'logged_information';
  }

  if (root === 'personal_information') {
    if (category === 'profile_information') return 'profile_information';
    if (category === 'about_you') return 'about_you';
    return 'personal_information';
  }

  if (root === 'ads_information') return 'ads';
  if (root === 'apps_and_websites_off_of_facebook') return 'apps_and_websites';

  return getArchiveSection(root)?.key ?? root;
}

