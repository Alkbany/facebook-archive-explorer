import { describe, expect, it } from 'vitest';
import { parsePostsExport } from '../src/main/import/parsers/posts-parser';

const card = (body: string, date = 'Raw date') => `
<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
  <div class="_3-96 _2pio _2lek _2lel">تم النشر بواسطة Ahmed في MagicalGhast.</div>
  <div class="_3-96 _2let">
    <div><div class="_2pin"><div>${body}</div></div></div>
  </div>
  <div class="_3-94 _2lem"><a href="https://www.facebook.com/dyi/l/?opaque=1">${date}</a></div>
</div>`;

describe('Facebook posts parser', () => {
  it('extracts author, body, raw date and permalink without rewriting them', () => {
    const result = parsePostsExport(card('منشور تجريبي<br>سطر تاني', '١٥/١٠/٢٠١٨ ٧:٣٦ ص'), 'posts/your_posts.html');
    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      authorRaw: 'تم النشر بواسطة Ahmed في MagicalGhast.',
      bodyRaw: 'منشور تجريبي\nسطر تاني',
      dateRaw: '١٥/١٠/٢٠١٨ ٧:٣٦ ص',
      permalinkRaw: 'https://www.facebook.com/dyi/l/?opaque=1',
      sourceCardIndex: 0
    });
  });

  it('extracts only local archive media references and ignores tracking links', () => {
    const html = `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">Author</div>
      <div class="_3-96 _2let"><div><div class="_2pin">
        <a href="photos_and_videos/your_posts/photo.jpg"><img src="photos_and_videos/your_posts/photo.jpg"></a>
        <a href="https://www.facebook.com/dyi/l/?opaque=1">external link</a>
      </div></div></div>
      <div class="_3-94 _2lem">Raw date</div>
    </div>`;
    const result = parsePostsExport(html, 'posts/your_posts.html');
    expect(result.records[0].media).toHaveLength(1);
    expect(result.records[0].media[0]).toMatchObject({ relativePath: 'photos_and_videos/your_posts/photo.jpg', tagName: 'img' });
  });

  it('reports unknown layouts and rejects files outside posts', () => {
    expect(parsePostsExport('<html/>', 'posts/your_posts.html').issues[0].code).toBe('no_cards_found');
    expect(() => parsePostsExport('<html/>', 'messages/your_messages.html')).toThrow('Unsupported posts source');
  });
});
