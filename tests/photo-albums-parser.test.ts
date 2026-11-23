import { describe, expect, it } from 'vitest';
import { parsePhotoAlbumsIndex } from '../src/main/import/parsers/photo-albums-parser';

function albumCard(
  title: string,
  href: string,
  cover: string,
  date = 'Raw album date'
): string {
  return `
    <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">${title}</div>
      <div class="_3-96 _2let">
        <a href="${href}"><img src="${cover}" /></a>
      </div>
      <div class="_3-94 _2lem">${date}</div>
    </div>`;
}

describe('Facebook photo albums index parser', () => {
  it('parses album names, Arabic photo counts, relative paths, and raw dates', () => {
    const html = `<html><head><title>Your Photos</title></head><body>
      ${albumCard('‏‎Instagram Photos‎‏ - ‏٣‏ صور', 'photos_and_videos/album/0.html',
        'photos_and_videos/InstagramPhotos_token/cover.jpg', '١٣/٠٢/٢٠١٨ ١١:٥٥ ص')}
      ${albumCard('‏صور الغلاف‏ - ‏١٣‏ صورة', 'photos_and_videos/album/1.html',
        'photos_and_videos/covers_token/cover.jpg')}
      ${albumCard('‏صور الملف الشخصي‏ - ‏٢٠‏ صورة', 'photos_and_videos/album/2.html',
        'photos_and_videos/profile_token/cover.jpg')}
    </body></html>`;

    const result = parsePhotoAlbumsIndex(html, 'photos_and_videos/your_photos.html');

    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({
      albumTitle: 'Instagram Photos',
      photoCount: 3,
      photoCountRaw: '٣',
      albumPath: 'photos_and_videos/album/0.html',
      coverPath: 'photos_and_videos/InstagramPhotos_token/cover.jpg',
      dateRaw: '١٣/٠٢/٢٠١٨ ١١:٥٥ ص',
      sourceCardIndex: 0
    });
    expect(result.records[1]).toMatchObject({ albumTitle: 'صور الغلاف', photoCount: 13 });
    expect(result.records[2]).toMatchObject({ albumTitle: 'صور الملف الشخصي', photoCount: 20 });
  });

  it('accepts English counts and does not turn unknown count formats into guesses', () => {
    const result = parsePhotoAlbumsIndex(
      albumCard('Camera uploads - 36 photos', 'photos_and_videos/album/4.html',
        'photos_and_videos/mobile/cover.jpg') +
      albumCard('A custom album', 'photos_and_videos/album/5.html',
        'photos_and_videos/custom/cover.jpg'),
      'photos_and_videos/your_photos.html'
    );
    expect(result.records).toMatchObject([
      { albumTitle: 'Camera uploads', photoCount: 36, photoCountRaw: '36' },
      { albumTitle: 'A custom album', photoCount: null, photoCountRaw: null }
    ]);
  });

  it('rejects external and traversal album or cover paths', () => {
    const result = parsePhotoAlbumsIndex(
      albumCard('Unsafe', '../outside.html', 'photos_and_videos/cover.jpg') +
      albumCard('External', 'https://example.com/album', 'https://example.com/cover.jpg'),
      'photos_and_videos/your_photos.html'
    );
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([
      { code: 'album_link_missing', sourceCardIndex: 0 },
      { code: 'album_link_missing', sourceCardIndex: 1 }
    ]);
  });

  it('reports an unrecognized layout and rejects files that are not the section index', () => {
    expect(parsePhotoAlbumsIndex('<html><body>No album cards</body></html>',
      'photos_and_videos/your_photos.html').issues).toEqual([
      { code: 'no_album_cards_found', sourceCardIndex: null }
    ]);
    expect(() => parsePhotoAlbumsIndex('<html/>',
      'photos_and_videos/album/0.html')).toThrow('Unsupported Photos & Videos index source.');
    expect(() => parsePhotoAlbumsIndex('<html/>',
      'messages/your_messages.html')).toThrow('Unsupported Photos & Videos index source.');
  });
});
