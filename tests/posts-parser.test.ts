import { describe, expect, it } from 'vitest';
import { parsePostsExport, parsePostsJsonExport } from '../src/main/import/parsers/posts-parser';

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
      activityRaw: 'تم النشر بواسطة Ahmed في MagicalGhast.',
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


describe('Facebook posts export timezone metadata', () => {
  it('reads an explicit footer offset while preserving the original card date', () => {
    const rawDate = '٢٥/٠٧/٢٠١٧ ٨:٣٨ م';
    const html = `<html><body>${card('A synthetic post.', rawDate)}
      <div class="_4t5o">Export created at 10:00 PM UTC+02</div>
    </body></html>`;
    const result = parsePostsExport(html, 'posts/your_posts.html');

    expect(result.timezoneOffsetMinutes).toBe(120);
    expect(result.records[0].dateRaw).toBe(rawDate);
  });
});

describe('Accounts Center TNG Posts JSON parser', () => {
  it('extracts the Facebook activity heading, post text, raw time and only local media URIs', () => {
    const result = parsePostsJsonExport(JSON.stringify([{
      timestamp: 12597672600,
      attachments: [
        { data: [{ media: {
          uri: 'your_facebook_activity/posts/media/your_posts/200000000000003.png',
          creation_timestamp: 12597672300,
          description: 'The bridge at dawn.',
          media_metadata: { photo_metadata: { exif_data: [{ upload_ip: '10.0.0.1' }] } }
        } }] },
        { data: [{ place: { name: 'Ten Forward', address: 'Deck 10', coordinate: { latitude: 91, longitude: 181 } } }] },
        { data: [{ external_context: { url: 'https://private.example/post' } }] }
      ],
      data: [{ post: 'Two views of the bridge before alpha shift.' }, {}],
      title: 'Jean-Luc Picard added 1 new photo.',
      tags: [{ name: 'Data' }]
    }]), 'your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json');

    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      activityRaw: 'Jean-Luc Picard added 1 new photo.',
      bodyRaw: 'Two views of the bridge before alpha shift.\nThe bridge at dawn.',
      dateRaw: '12597672600',
      media: [{
        relativePath: 'your_facebook_activity/posts/media/your_posts/200000000000003.png',
        tagName: 'img',
        sourceAttribute: 'src',
        displayOrder: 0
      }]
    });
    expect(result.records[0].bodyRaw).not.toContain('Deck 10');
    expect(result.records[0].bodyRaw).not.toContain('private.example');
    expect(result.records[0].bodyRaw).not.toContain('10.0.0.1');
  });

  it('does not accept media references outside the selected archive media folder', () => {
    const result = parsePostsJsonExport(JSON.stringify([{
      timestamp: 12597672600,
      attachments: [{ data: [{ media: { uri: '../../outside.png', description: 'Caption' } }] }],
      title: 'A synthetic post.'
    }]), 'your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json');
    expect(result.records[0]).toMatchObject({ media: [], bodyRaw: 'Caption' });
  });

  it('reports unknown arrays and rejects unrelated JSON files', () => {
    expect(parsePostsJsonExport('[]', 'your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.json').issues)
      .toEqual([{ code: 'no_cards_found', sourceCardIndex: null }]);
    expect(() => parsePostsJsonExport('[]', 'your_facebook_activity/posts/posts_on_other_pages_and_profiles.json'))
      .toThrow('Unsupported TNG posts JSON source');
  });
});
