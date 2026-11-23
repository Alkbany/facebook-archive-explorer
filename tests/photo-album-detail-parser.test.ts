import { describe, expect, it } from 'vitest';
import { parsePhotoAlbumDetail } from '../src/main/import/parsers/photo-album-detail-parser';

function photoCard(
  imagePath: string,
  caption: string,
  comments: Array<{ author: string; body: string; date: string }>,
  date: string
): string {
  return `
    <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2let">
        <a href="${imagePath}"><img src="${imagePath}" class="_2yuc _3-96" /></a>
        <div class="_3-95">${caption}</div>
        ${comments.map((comment) => `
          <div class="pas _3-94 uiBoxGray noborder">
            <div><div><span class="_3-8_ _2oao">${comment.author}</span>${comment.body}</div>
            <div class="_67gx">${comment.date}</div></div>
          </div>`).join('')}
      </div>
      <div class="_3-94 _2lem">${date}</div>
    </div>`;
}

describe('Facebook photo album detail parser', () => {
  it('parses photo paths, captions, raw photo dates, and all comment fields', () => {
    const html = `<html><head><base href="../../" /><title>Instagram Photos</title></head><body>
      <div class="_3b0d">Instagram Photos</div>
      ${photoCard(
        'photos_and_videos/InstagramPhotos_token/first.jpg',
        '😍😍',
        [
          { author: 'Saleh Elshrif', body: 'احلا خوات في الكون', date: '‏٠١‏/٠٢‏/٢٠١٨ ١٠:٤٨ م‏' },
          { author: 'Ahmed Alkbany', body: '😍😍', date: '‏٠٢‏/٠٢‏/٢٠١٨ ٣:٤٩ م‏' }
        ],
        '‏٠١‏/٠٢‏/٢٠١٨ ٩:٢٥ م‏'
      )}
      ${photoCard(
        'photos_and_videos/InstagramPhotos_token/second.jpg',
        'Never mind what they say 💔',
        [{ author: 'Ana Tito', body: 'اخوااتي &lt;3 &lt;3', date: '‏١٣‏/٠٢‏/٢٠١٨ ١٢:٠١ م‏' }],
        '‏١٣‏/٠٢‏/٢٠١٨ ١١:٥٥ ص‏'
      )}
    </body></html>`;

    const result = parsePhotoAlbumDetail(html, 'photos_and_videos/album/0.html');

    expect(result.albumTitle).toBe('Instagram Photos');
    expect(result.issues).toEqual([]);
    expect(result.photos).toHaveLength(2);
    expect(result.photos[0]).toMatchObject({
      imagePath: 'photos_and_videos/InstagramPhotos_token/first.jpg',
      originalPath: 'photos_and_videos/InstagramPhotos_token/first.jpg',
      captionRaw: '😍😍',
      dateRaw: '‏٠١‏/٠٢‏/٢٠١٨ ٩:٢٥ م‏',
      comments: [
        { authorRaw: 'Saleh Elshrif', bodyRaw: 'احلا خوات في الكون', dateRaw: '‏٠١‏/٠٢‏/٢٠١٨ ١٠:٤٨ م‏' },
        { authorRaw: 'Ahmed Alkbany', bodyRaw: '😍😍', dateRaw: '‏٠٢‏/٠٢‏/٢٠١٨ ٣:٤٩ م‏' }
      ],
      sourceCardIndex: 0
    });
    expect(result.photos[1].comments[0].bodyRaw).toBe('اخوااتي <3 <3');
  });

  it('rejects traversal and external media links', () => {
    const result = parsePhotoAlbumDetail(
      photoCard('../outside.jpg', 'Caption', [], 'Raw date') +
      photoCard('https://example.com/photo.jpg', 'Caption', [], 'Raw date'),
      'photos_and_videos/album/0.html'
    );
    expect(result.photos).toEqual([]);
    expect(result.issues).toEqual([
      { code: 'photo_image_path_missing', sourceCardIndex: 0 },
      { code: 'photo_image_path_missing', sourceCardIndex: 1 }
    ]);
  });

  it('reports unknown pages and rejects non-album-detail source paths', () => {
    expect(parsePhotoAlbumDetail('<html><body>No photos</body></html>',
      'photos_and_videos/album/0.html').issues).toEqual([
      { code: 'no_photo_cards_found', sourceCardIndex: null }
    ]);
    expect(() => parsePhotoAlbumDetail('<html/>', 'photos_and_videos/your_photos.html'))
      .toThrow('Unsupported Photos & Videos album detail source.');
  });
});
