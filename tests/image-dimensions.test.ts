import { describe, expect, it } from 'vitest';
import { readImageDimensions } from '../src/main/database/image-dimensions';

describe('image dimension header reader', () => {
  it('reads PNG dimensions', () => {
    const data = Buffer.alloc(24);
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(data);
    data.writeUInt32BE(1920, 16);
    data.writeUInt32BE(1080, 20);
    expect(readImageDimensions(data)).toEqual({ width: 1920, height: 1080 });
  });

  it('reads GIF dimensions', () => {
    const data = Buffer.from('GIF89a', 'ascii');
    const header = Buffer.alloc(4);
    header.writeUInt16LE(640, 0);
    header.writeUInt16LE(480, 2);
    expect(readImageDimensions(Buffer.concat([data, header]))).toEqual({ width: 640, height: 480 });
  });

  it('reads JPEG dimensions from a SOF marker', () => {
    const data = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x07,0x08,0x02,0x1c,0x03,0x20]);
    expect(readImageDimensions(data)).toEqual({ width: 800, height: 540 });
  });

  it('returns null for unsupported or incomplete data', () => {
    expect(readImageDimensions(Buffer.from('not an image'))).toBeNull();
    expect(readImageDimensions(Buffer.from([0xff,0xd8,0xff]))).toBeNull();
  });
});
