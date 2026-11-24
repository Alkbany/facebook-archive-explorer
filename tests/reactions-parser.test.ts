import { describe, expect, it } from 'vitest';
import { parseReactionsExport, parseReactionsJsonExport } from '../src/main/import/parsers/reactions-parser';

const card = (description: string, image: string, date: string) => `
<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
  <div class="_3-96 _2pio _2lek _2lel">${description}</div>
  <div class="_3-96 _2let"><div class="_2pin"><img src="reaction/${image}"></div></div>
  <div class="_3-94 _2lem">${date}</div>
</div>`;

describe('Likes & Reactions parser', () => {
  it('extracts the observed card description, reaction image, and raw date', () => {
    const html = card('You reacted to a synthetic post', 'love.png', 'Raw exported date')
      + card('You liked another synthetic item', 'like.png', 'Another raw date');
    const result = parseReactionsExport(html, 'likes_and_reactions/sample.html');
    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      descriptionRaw: 'You reacted to a synthetic post',
      reactionType: 'love',
      reactionImageRaw: 'reaction/love.png',
      dateRaw: 'Raw exported date',
      sourceCardIndex: 0
    });
    expect(result.records[1].reactionType).toBe('like');
    expect(result.records[1].sourceCardIndex).toBe(1);
  });

  it('preserves a card description when the reaction image is unknown', () => {
    const result = parseReactionsExport(card('Raw description', 'new-reaction.png', 'Raw date'), 'likes_and_reactions/sample.html');
    expect(result.records[0]).toMatchObject({ descriptionRaw: 'Raw description', reactionType: null, dateRaw: 'Raw date' });
  });

  it('reports an unrecognized page instead of silently importing zero records', () => {
    expect(parseReactionsExport('<html><body>unknown</body></html>', 'likes_and_reactions/sample.html').issues)
      .toEqual([{ code: 'no_cards_found', sourceCardIndex: null }]);
  });

  it('rejects files outside the reactions section', () => {
    expect(() => parseReactionsExport('<p/>', 'posts/your_posts.html')).toThrow('Unsupported reactions source');
  });
});


describe('Facebook reactions export timezone metadata', () => {
  it('reads an explicit footer offset while preserving the raw reaction date', () => {
    const rawDate = '٢٥/٠٧/٢٠١٧ ٨:٣٨ م';
    const html = `${card('Synthetic user liked a post', 'like.png', rawDate)}
      <div class="_4t5o">Export created at 10:00 PM UTC+02</div>`;
    const result = parseReactionsExport(html, 'likes_and_reactions/sample.html');

    expect(result.timezoneOffsetMinutes).toBe(120);
    expect(result.records[0].dateRaw).toBe(rawDate);
  });
});

describe('Accounts Center Likes & Reactions JSON parser', () => {
  it('parses the data[].reaction representation', () => {
    const result = parseReactionsJsonExport(JSON.stringify([{
      timestamp: 12597863400,
      data: [{ reaction: { reaction: 'LIKE', actor: 'Jean-Luc Picard' } }],
      title: "Jean-Luc Picard liked William Riker's post."
    }]), 'likes_and_reactions_1.json');
    expect(result.issues).toEqual([]);
    expect(result.records[0]).toMatchObject({
      reactionType: 'like',
      descriptionRaw: "Jean-Luc Picard liked William Riker's post.",
      dateRaw: '12597863400'
    });
  });

  it('parses the label_values representation without indexing target URLs', () => {
    const result = parseReactionsJsonExport(JSON.stringify([{
      timestamp: 12597863400,
      label_values: [
        { label: 'Reaction', value: 'Like' },
        { label: 'URL', value: 'https://www.facebook.com/private-post' },
        { label: 'Name', value: 'William Riker' }
      ]
    }]), 'likes_and_reactions.json');
    expect(result.records[0]).toMatchObject({
      reactionType: 'like',
      descriptionRaw: 'Reaction involving William Riker',
      dateRaw: '12597863400'
    });
    expect(result.records[0].descriptionRaw).not.toContain('facebook.com');
  });

  it('reports unfamiliar reaction JSON as unsupported rather than inventing records', () => {
    expect(parseReactionsJsonExport('[]', 'likes_and_reactions.json').issues)
      .toEqual([{ code: 'no_cards_found', sourceCardIndex: null }]);
  });
});
