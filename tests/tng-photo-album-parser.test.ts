import { describe, expect, it } from 'vitest';
import { parseTngPhotoAlbumJson } from '../src/main/import/parsers/tng-photo-album-parser';

describe('TNG photo album JSON parser', () => {
  it('extracts the album metadata, local cover, photo captions and raw timestamps', () => {
    const result = parseTngPhotoAlbumJson(JSON.stringify({
      name: 'Starfleet Academy Days',
      description: 'A synthetic album description.',
      last_modified_timestamp: 12600000000,
      cover_photo: {
        uri: 'your_facebook_activity/posts/media/your_posts/100000000000001.jpg',
        creation_timestamp: 12599999000
      },
      photos: [
        {
          uri: 'your_facebook_activity/posts/media/your_posts/100000000000001.jpg',
          creation_timestamp: 12599999000,
          description: 'The academy courtyard.'
        },
        {
          uri: 'your_facebook_activity/posts/media/your_posts/100000000000002.jpg',
          creation_timestamp: 12599999100,
          description: 'Graduation day.'
        }
      ]
    }), 'your_facebook_activity/posts/album/0.json');

    expect(result).toMatchObject({
      albumTitle: 'Starfleet Academy Days',
      descriptionRaw: 'A synthetic album description.',
      dateRaw: '12600000000',
      coverPath: 'your_facebook_activity/posts/media/your_posts/100000000000001.jpg',
      invalidPhotoPaths: 0,
      photos: [
        {
          sourceIndex: 0,
          imagePath: 'your_facebook_activity/posts/media/your_posts/100000000000001.jpg',
          captionRaw: 'The academy courtyard.',
          dateRaw: '12599999000'
        },
        {
          sourceIndex: 1,
          imagePath: 'your_facebook_activity/posts/media/your_posts/100000000000002.jpg',
          captionRaw: 'Graduation day.',
          dateRaw: '12599999100'
        }
      ]
    });
  });

  it('rejects external and traversal media references without losing the album', () => {
    const result = parseTngPhotoAlbumJson(JSON.stringify({
      name: 'Safe album',
      photos: [
        { uri: 'https://remote.example/photo.jpg' },
        { uri: '../../outside.jpg' },
        { uri: 'your_facebook_activity/posts/media/your_posts/local.jpg', description: 'Local' }
      ],
      cover_photo: { uri: 'https://remote.example/cover.jpg' }
    }), 'your_facebook_activity/posts/album/1.json');

    expect(result).toMatchObject({
      albumTitle: 'Safe album',
      coverPath: null,
      invalidPhotoPaths: 2,
      photos: [{
        imagePath: 'your_facebook_activity/posts/media/your_posts/local.jpg',
        captionRaw: 'Local'
      }]
    });
  });

  it('returns null for an unfamiliar JSON shape and rejects unrelated source paths', () => {
    expect(parseTngPhotoAlbumJson('{"unexpected":true}', 'your_facebook_activity/posts/album/2.json'))
      .toBeNull();
    expect(() => parseTngPhotoAlbumJson('{}', 'your_facebook_activity/posts/posts_on_other_pages_and_profiles.json'))
      .toThrow('Unsupported TNG photo album source path');
  });
});
