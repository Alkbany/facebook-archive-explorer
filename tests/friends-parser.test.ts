import { describe, expect, it } from 'vitest';
import { parseFriendsExport } from '../src/main/import/parsers/friends-parser';

function card(name: string, date: string, contact = ''): string {
  return `
    <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
      <div class="_3-96 _2pio _2lek _2lel">${name}</div>
      <div class="_3-94 _2lem">${date}</div>
      ${contact ? `<div class="_3-96 _2let">${contact}</div>` : ''}
    </div>
  `;
}

describe('parseFriendsExport', () => {
  it.each([
    ['friends.html', 'friend'],
    ['received_friend_requests.html', 'received'],
    ['sent_friend_requests.html', 'sent'],
    ['rejected_friend_requests.html', 'rejected'],
    ['removed_friends.html', 'removed']
  ] as const)('recognizes the %s page type', (fileName, recordType) => {
    const result = parseFriendsExport(
      `<!doctype html><html><body>${card('Synthetic &amp; Person', '12 يناير 2019')}</body></html>`,
      `friends/${fileName}`
    );

    expect(result.issues).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      recordType,
      nameRaw: 'Synthetic & Person',
      dateRaw: '12 يناير 2019',
      sourceFile: `friends/${fileName}`,
      sourceCardIndex: 0
    });
  });

  it('keeps optional contact details only for the current friends page', () => {
    const html = card('Synthetic Friend', '2019', 'synthetic@example.invalid');

    const friends = parseFriendsExport(html, 'friends.html');
    const sentRequests = parseFriendsExport(html, 'sent_friend_requests.html');

    expect(friends.records[0].contactInfoRaw).toBe('synthetic@example.invalid');
    expect(sentRequests.records[0].contactInfoRaw).toBeNull();
  });

  it('preserves duplicate names as separate source records', () => {
    const html = card('Same Name', '2018') + card('Same Name', '2019');
    const result = parseFriendsExport(html, 'friends.html');

    expect(result.records).toHaveLength(2);
    expect(result.records.map((record) => record.sourceCardIndex)).toEqual([0, 1]);
  });

  it('reports cards without names instead of silently creating empty records', () => {
    const html = `
      <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
        <div class="_3-94 _2lem">2018</div>
      </div>
      ${card('Visible Person', '2019')}
    `;
    const result = parseFriendsExport(html, 'friends.html');

    expect(result.records).toHaveLength(1);
    expect(result.records[0].sourceCardIndex).toBe(1);
    expect(result.issues).toEqual([{ code: 'missing_name', sourceCardIndex: 0 }]);
  });

  it('returns an explicit issue when no recognized cards exist', () => {
    const result = parseFriendsExport('<html><body><p>No friends</p></body></html>', 'friends.html');

    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([{ code: 'no_cards_found', sourceCardIndex: null }]);
  });

  it('rejects unrecognized filenames so they are not parsed with the wrong model', () => {
    expect(() => parseFriendsExport('<html></html>', 'another_section.html'))
      .toThrow('Unsupported friends export file');
  });
});
