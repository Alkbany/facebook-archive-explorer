import { describe, expect, it } from 'vitest';
import { parseCommentsExport, parseCommentsJsonExport } from '../src/main/import/parsers/comments-parser';

const card = (activity: string, body: string, date = '١٩/٠٢/٢٠١٩ ٧:٣٩ ص') => `
<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
  <div class="_3-96 _2pio _2lek _2lel">${activity}</div>
  <div class="_3-96 _2let"><div><div class="_2pin">${body}</div></div></div>
  <div class="_3-94 _2lem"><a href="https://www.facebook.com/dyi/l/?opaque=1">${date}</a></div>
</div>`;

describe('Facebook comments activity parser', () => {
  it('keeps reply/comment context, group label, body and raw date separately', () => {
    const html = card(
      'رد ‏‎Ahmed Alkbany‎‏ على ‏تعليق‏ ‏‎Bssam Emad‎‏.',
      '<div><div class="_3-95"><span class="_4mp8">مجموعة: </span>pubg mobile - egypt™</div>مش فونيكس دا نظام<br>ولا ايموليتور</div>'
    );
    const result = parseCommentsExport(html, 'comments/comments.html');
    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      activityRaw: 'رد ‏‎Ahmed Alkbany‎‏ على ‏تعليق‏ ‏‎Bssam Emad‎‏.',
      bodyRaw: 'مش فونيكس دا نظام\nولا ايموليتور',
      groupRaw: 'pubg mobile - egypt™',
      dateRaw: '١٩/٠٢/٢٠١٩ ٧:٣٩ ص',
      permalinkRaw: 'https://www.facebook.com/dyi/l/?opaque=1',
      sourceCardIndex: 0
    });
  });

  it('parses cards without a group and preserves their text', () => {
    const result = parseCommentsExport(card(
      'علق ‏‎Ahmed Alkbany‎‏ على ‏منشور‏ ‏‎Błäčk Cãřđ‎‏.',
      'انا محاكي وموصليش'
    ), 'comments/your_comments.html');
    expect(result.records[0]).toMatchObject({ bodyRaw: 'انا محاكي وموصليش', groupRaw: null });
  });

  it('reports unknown layouts and rejects paths outside Comments', () => {
    expect(parseCommentsExport('<html/>', 'comments/your_comments.html').issues[0].code).toBe('no_cards_found');
    expect(() => parseCommentsExport('<html/>', 'posts/your_posts.html')).toThrow('Unsupported comments source');
  });
});


describe('Facebook comments export timezone metadata', () => {
  it('reads an explicit footer offset and preserves the raw comment date', () => {
    const rawDate = '١٩/٠٢/٢٠١٩ ٧:٣٩ ص';
    const html = `${card('Synthetic user commented on a post.', 'Synthetic comment.', rawDate)}
      <div class="_4t5o">Export created at 10:00 PM UTC+02</div>`;
    const result = parseCommentsExport(html, 'comments/comments.html');

    expect(result.timezoneOffsetMinutes).toBe(120);
    expect(result.records[0].dateRaw).toBe(rawDate);
  });
});

describe('Accounts Center comments_v2 JSON parser', () => {
  it('extracts activity, comment body, group label, and raw timestamp from comments_v2', () => {
    const result = parseCommentsJsonExport(JSON.stringify({
      comments_v2: [
        {
          timestamp: 12597674400,
          title: 'Jean-Luc Picard commented on his own photo.',
          data: [{ comment: { timestamp: 12597674400, comment: 'The bridge at dawn.', author: 'Jean-Luc Picard' } }]
        },
        {
          timestamp: 12597865200,
          title: 'Jean-Luc Picard commented in Starfleet Academy Alumni.',
          data: [{ comment: { timestamp: 12597865200, comment: 'Proud of you.', group: 'Starfleet Academy Alumni' } }]
        }
      ]
    }), 'your_facebook_activity/comments_and_reactions/comments.json');

    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      activityRaw: 'Jean-Luc Picard commented on his own photo.',
      bodyRaw: 'The bridge at dawn.',
      groupRaw: null,
      dateRaw: '12597674400'
    });
    expect(result.records[1]).toMatchObject({
      bodyRaw: 'Proud of you.',
      groupRaw: 'Starfleet Academy Alumni',
      dateRaw: '12597865200'
    });
  });

  it('marks an empty comments_v2 collection as having no cards', () => {
    expect(parseCommentsJsonExport('{"comments_v2":[]}', 'comments.json').issues)
      .toEqual([{ code: 'no_cards_found', sourceCardIndex: null }]);
  });

  it('rejects unknown JSON shapes for the generic fallback', () => {
    expect(parseCommentsJsonExport('[]', 'comments.json').issues)
      .toEqual([{ code: 'no_cards_found', sourceCardIndex: null }]);
  });
});
