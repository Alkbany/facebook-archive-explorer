import { describe, expect, it } from 'vitest';
import { readMp4DurationMs } from '../src/main/database/video-duration';

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
