import { describe, expect, it } from 'vitest';
import { readMp4DurationMs, readMp4DurationMsFromTail } from '../src/main/database/video-duration';

function atom(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + header.length, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function movieHeaderV0(timescale: number, duration: number): Buffer {
  const payload = Buffer.alloc(20);
  payload[0] = 0;
  payload.writeUInt32BE(timescale, 12);
  payload.writeUInt32BE(duration, 16);
  return atom('mvhd', payload);
}

function movieHeaderV1(timescale: number, duration: bigint): Buffer {
  const payload = Buffer.alloc(32);
  payload[0] = 1;
  payload.writeUInt32BE(timescale, 20);
  payload.writeBigUInt64BE(duration, 24);
  return atom('mvhd', payload);
}

describe('bounded MP4/MOV duration reader', () => {
  it('reads version 0 movie header duration', () => {
    const buffer = Buffer.concat([atom('ftyp', Buffer.from('isom0000')), atom('moov', movieHeaderV0(1000, 90500))]);
    expect(readMp4DurationMs(buffer)).toBe(90500);
  });

  it('reads version 1 64-bit movie header duration', () => {
    const buffer = atom('moov', movieHeaderV1(90000, 90000n * 123n));
    expect(readMp4DurationMs(buffer)).toBe(123000);
  });

  it('finds moov after media data and accepts extended-size atoms', () => {
    const large = Buffer.alloc(20);
    large.writeUInt32BE(1, 0);
    large.write('mdat', 4, 4, 'ascii');
    large.writeBigUInt64BE(BigInt(large.length), 8);
    large.write('data', 16, 4, 'ascii');
    const buffer = Buffer.concat([large, atom('moov', movieHeaderV0(25, 250))]);
    expect(readMp4DurationMs(buffer)).toBe(10000);
  });

  it('finds a complete moov atom in a bounded suffix after a large media payload', () => {
    const suffix = Buffer.concat([
      Buffer.alloc(64, 0x7f),
      atom('moov', movieHeaderV0(1000, 180250))
    ]);
    expect(readMp4DurationMsFromTail(suffix)).toBe(180250);
  });

  it('accepts an extended-size moov atom in the suffix', () => {
    const child = movieHeaderV1(90000, 90000n * 321n);
    const header = Buffer.alloc(16);
    header.writeUInt32BE(1, 0);
    header.write('moov', 4, 4, 'ascii');
    header.writeBigUInt64BE(BigInt(header.length + child.length), 8);
    expect(readMp4DurationMsFromTail(Buffer.concat([Buffer.alloc(10, 0x5a), header, child]))).toBe(321000);
  });

  it('rejects incomplete or false moov signatures in the suffix', () => {
    const truncated = Buffer.alloc(20);
    truncated.writeUInt32BE(4096, 0);
    truncated.write('moov', 4, 4, 'ascii');
    expect(readMp4DurationMsFromTail(truncated)).toBeNull();
    expect(readMp4DurationMsFromTail(Buffer.from('random bytes with a moov signature but no valid atom'))).toBeNull();
  });

  it('returns null for malformed, incomplete, unsupported, or unknown duration headers', () => {
    expect(readMp4DurationMs(Buffer.from('not an mp4'))).toBeNull();
    expect(readMp4DurationMs(atom('moov', Buffer.from('short')))).toBeNull();
    expect(readMp4DurationMs(atom('moov', movieHeaderV0(0, 100)))).toBeNull();
    expect(readMp4DurationMs(atom('moov', movieHeaderV0(1000, 0)))).toBeNull();
    expect(readMp4DurationMs(atom('ftyp', Buffer.from('isom0000')))).toBeNull();
  });

  it('does not search beyond a truncated top-level box', () => {
    const mdat = Buffer.alloc(12);
    mdat.writeUInt32BE(1024, 0);
    mdat.write('mdat', 4, 4, 'ascii');
    const buffer = Buffer.concat([mdat, atom('moov', movieHeaderV0(1000, 5000))]);
    expect(readMp4DurationMs(buffer)).toBeNull();
  });
});
