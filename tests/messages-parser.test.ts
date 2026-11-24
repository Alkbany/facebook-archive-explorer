import { describe, expect, it } from 'vitest';
import { parseMessageConversation, parseMessageConversationJson } from '../src/main/import/parsers/messages-parser';

const CARD = (body: string, sender = 'Synthetic Sender', timestamp = 'Raw timestamp') => `
  <div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder">
    <div class="_3-96 _2pio _2lek _2lel">${sender}</div>
    <div class="_3-96 _2let">${body}</div>
    <div class="_3-94 _2lem">${timestamp}</div>
  </div>`;

describe('parseMessageConversation', () => {
  it('preserves source order, raw text, sender, and timestamp', () => {
    const html = `<html><body>${CARD('First &amp; original')} ${CARD('Second message', 'Another sender', 'Date two')}</body></html>`;
    const result = parseMessageConversation(html, 'messages/inbox/thread/thread.html');

    expect(result.issues).toEqual([]);
    expect(result.messages.map((message) => message.sourceCardIndex)).toEqual([0, 1]);
    expect(result.messages[0]).toMatchObject({
      senderRaw: 'Synthetic Sender',
      bodyRaw: 'First & original',
      timestampRaw: 'Raw timestamp',
      recordType: 'message'
    });
    expect(result.messages[1].timestampRaw).toBe('Date two');
  });

  it('extracts reactions separately from message text', () => {
    const html = CARD('Message body <ul class="_tqp"><li>Like</li><li>Love</li></ul>');
    const result = parseMessageConversation(html, 'messages/inbox/thread/thread.html');

    expect(result.messages[0].bodyRaw).toContain('Message body');
    expect(result.messages[0].reactionsRaw).toEqual(['Like', 'Love']);
  });

  it('resolves relative media using the document base and rejects external URLs', () => {
    const html = `<html><head><base href="../../../"></head><body>${CARD(`
      <img src="messages/inbox/thread/photos/photo.jpg">
      <audio src="messages/inbox/thread/audio/clip.mp4"></audio>
      <video src="messages/inbox/thread/videos/video.mp4"></video>
      <img src="https://example.invalid/remote.jpg">
      <img src="../../../../outside.jpg">
    `)}</body></html>`;
    const result = parseMessageConversation(html, 'messages/inbox/thread/thread.html');

    expect(result.messages[0].media).toEqual([
      { kind: 'image', relativePath: 'messages/inbox/thread/photos/photo.jpg', element: 'img' },
      { kind: 'audio', relativePath: 'messages/inbox/thread/audio/clip.mp4', element: 'audio' },
      { kind: 'video', relativePath: 'messages/inbox/thread/videos/video.mp4', element: 'video' }
    ]);
  });

  it('deduplicates linked attachments and preserves their actual media element type', () => {
    const imagePath = 'messages/inbox/thread/photos/photo.jpg';
    const audioPath = 'messages/inbox/thread/audio/voice-note.mp4';
    const html = `<html><head><base href="../../../"></head><body>${CARD(`
      <a href="${imagePath}"><img src="${imagePath}"></a>
      <audio src="${audioPath}" controls="1">
        <a href="${audioPath}">Play audio</a>
      </audio>
    `)}</body></html>`;
    const result = parseMessageConversation(html, 'messages/inbox/thread/thread.html');

    expect(result.messages[0].media).toEqual([
      { kind: 'image', relativePath: imagePath, element: 'img' },
      { kind: 'audio', relativePath: audioPath, element: 'audio' }
    ]);
  });

  it('keeps sticker references distinct from ordinary images', () => {
    const html = `<html><head><base href="../../../"></head><body>${CARD('<img src="messages/stickers_used/sticker.png">')}</body></html>`;
    const result = parseMessageConversation(html, 'messages/inbox/thread/thread.html');

    expect(result.messages[0].media[0]).toMatchObject({
      kind: 'sticker',
      relativePath: 'messages/stickers_used/sticker.png'
    });
  });

  it('recognizes call-event text without inventing call metadata', () => {
    const result = parseMessageConversation(CARD('لم يتم الرد على المكالمة'), 'messages/inbox/thread/thread.html');

    expect(result.messages[0].recordType).toBe('call_event');
    expect(result.messages[0].bodyRaw).toBe('لم يتم الرد على المكالمة');
    expect(result.messages[0].timestampRaw).toBe('Raw timestamp');
  });

  it('reports empty or unrecognized message cards', () => {
    const result = parseMessageConversation(
      `<div class="pam _3-95 _2pi0 _2lej uiBoxWhite noborder"><div class="_3-96 _2let"></div></div>`,
      'messages/inbox/thread/thread.html'
    );

    expect(result.messages).toEqual([]);
    expect(result.issues).toEqual([{ code: 'missing_message_content', sourceCardIndex: 0 }]);
  });

  it('reports an explicit issue when no message cards are found', () => {
    expect(parseMessageConversation('<html><body>empty</body></html>', 'messages/inbox/thread/thread.html'))
      .toMatchObject({ messages: [], issues: [{ code: 'no_message_cards_found', sourceCardIndex: null }] });
  });
});


describe('Accounts Center Messenger JSON parser', () => {
  it('parses text, share text, reactions, photos and stickers while rejecting remote media', () => {
    const result = parseMessageConversationJson(JSON.stringify({
      participants: [{ name: 'William Riker' }, { name: 'Jean-Luc Picard' }],
      title: 'William Riker',
      messages: [
        {
          sender_name: 'Jean-Luc Picard',
          timestamp_ms: 12600000180000,
          content: 'Remember this one?',
          share: { link: 'https://memory-alpha.example/private', share_text: 'The Picard Maneuver.' },
          reactions: [{ reaction: '❤️', actor: 'William Riker', timestamp: 12600000181 }]
        },
        {
          sender_name: 'William Riker',
          timestamp_ms: 12600000120000,
          photos: [
            { uri: 'your_facebook_activity/messages/inbox/williamriker_1000000001/photos/photo.jpg' },
            { uri: 'https://remote.example/remote.jpg' },
            { uri: '../../outside.jpg' }
          ]
        },
        {
          sender_name: 'William Riker',
          timestamp_ms: 12600000060000,
          sticker: { uri: 'your_facebook_activity/messages/stickers_used/sticker.png' }
        },
        {
          sender_name: 'Jean-Luc Picard',
          timestamp_ms: 12600000000000,
          call_duration: 125,
          content: 'Video chat ended.'
        },
        {
          sender_name: 'William Riker',
          timestamp_ms: 12599999940000,
          is_unsent: true
        }
      ]
    }), 'your_facebook_activity/messages/inbox/williamriker_1000000001/message_1.json');

    expect(result.issues).toEqual([]);
    expect(result.messages).toHaveLength(5);
    expect(result.messages[0]).toMatchObject({
      senderRaw: 'Jean-Luc Picard',
      bodyRaw: 'Remember this one?\nThe Picard Maneuver.',
      timestampRaw: '12600000180000',
      reactionsRaw: ['❤️'],
      recordType: 'message'
    });
    expect(result.messages[0].bodyRaw).not.toContain('memory-alpha.example');
    expect(result.messages[1].media).toEqual([{
      kind: 'image',
      relativePath: 'your_facebook_activity/messages/inbox/williamriker_1000000001/photos/photo.jpg',
      element: 'img'
    }]);
    expect(result.messages[1].recordType).toBe('attachment');
    expect(result.messages[2].media[0]).toMatchObject({
      kind: 'sticker',
      relativePath: 'your_facebook_activity/messages/stickers_used/sticker.png'
    });
    expect(result.messages[3].recordType).toBe('call_event');
    expect(result.messages[4].bodyRaw).toBe('This message was unsent.');
  });

  it('leaves unknown message JSON structures for the generic fallback', () => {
    expect(parseMessageConversationJson(
      JSON.stringify({ conversation_items: [{ text: 'Unknown format' }] }),
      'your_facebook_activity/messages/inbox/thread/message_1.json'
    )).toMatchObject({
      messages: [],
      issues: [{ code: 'no_message_cards_found', sourceCardIndex: null }]
    });
  });

  it('rejects JSON outside the current Messenger message path and filename', () => {
    expect(() => parseMessageConversationJson('{"messages":[]}', 'your_facebook_activity/messages/inbox/thread/other.json'))
      .toThrow('Unsupported Accounts Center message JSON source');
  });
});
