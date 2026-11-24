import { describe, expect, it } from 'vitest';
import { getGroupActivityMetadata } from '../src/shared/archive/groups';

describe('getGroupActivityMetadata', () => {
  it('labels the reviewed group post export without inventing a group name', () => {
    const result = getGroupActivityMetadata(
      'your_facebook_activity/groups/group_posts_and_comments.json',
      JSON.stringify({ title: 'I posted in Starfleet Academy Alumni.', data: [{ post: 'Class reunion.' }] })
    );
    expect(result).toEqual({ kind: 'post', label: 'Group post', groupName: null, authorName: null });
  });

  it('extracts group and author from the reviewed comment object', () => {
    const result = getGroupActivityMetadata(
      'your_facebook_activity/groups/your_comments_in_groups.json',
      JSON.stringify({ data: [{ comment: { comment: 'Proud of you.', group: 'Starfleet Academy Alumni', author: 'Jean-Luc Picard' } }] })
    );
    expect(result).toEqual({
      kind: 'comment',
      label: 'Group comment',
      groupName: 'Starfleet Academy Alumni',
      authorName: 'Jean-Luc Picard'
    });
  });

  it('extracts the group name from the reviewed membership object', () => {
    const result = getGroupActivityMetadata(
      'your_facebook_activity/groups/your_group_membership_activity.json',
      JSON.stringify({ data: [{ name: 'Starfleet Academy Alumni' }] })
    );
    expect(result).toEqual({ kind: 'membership', label: 'Group membership', groupName: 'Starfleet Academy Alumni', authorName: null });
  });

  it('does not infer metadata from unknown filenames or malformed previews', () => {
    expect(getGroupActivityMetadata('groups/other.json', '{broken')).toEqual({
      kind: 'unknown', label: 'Group record', groupName: null, authorName: null
    });
    expect(getGroupActivityMetadata('groups/your_comments_in_groups.json', '{broken')).toEqual({
      kind: 'comment', label: 'Group comment', groupName: null, authorName: null
    });
  });
});
