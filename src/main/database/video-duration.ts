interface AtomBox {
  type: string;
  payloadStart: number;
  end: number;
}

function readAtom(buffer: Buffer, offset: number, limit: number): AtomBox | null {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 8 > limit) return null;
  const size32 = buffer.readUInt32BE(offset);
  const type = buffer.toString('ascii', offset + 4, offset + 8);
  let headerSize = 8;
  let declaredSize: number;

  if (size32 === 1) {
    if (offset + 16 > limit) return null;
    const largeSize = buffer.readBigUInt64BE(offset + 8);
    if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    declaredSize = Number(largeSize);
    headerSize = 16;
  } else if (size32 === 0) {
    declaredSize = limit - offset;
  } else {
    declaredSize = size32;
  }

  if (declaredSize < headerSize) return null;
  const declaredEnd = offset + declaredSize;
  if (!Number.isSafeInteger(declaredEnd) || declaredEnd <= offset) return null;

  return { type, payloadStart: offset + headerSize, end: Math.min(declaredEnd, limit) };
}

function parseMovieHeaderDuration(buffer: Buffer, box: AtomBox): number | null {
  const payload = box.payloadStart;
  if (payload + 4 > box.end) return null;
  const version = buffer[payload];

  let timescale: number;
  let duration: bigint;
  if (version === 0) {
    if (payload + 20 > box.end) return null;
    timescale = buffer.readUInt32BE(payload + 12);
    duration = BigInt(buffer.readUInt32BE(payload + 16));
  } else if (version === 1) {
    if (payload + 32 > box.end) return null;
    timescale = buffer.readUInt32BE(payload + 20);
    duration = buffer.readBigUInt64BE(payload + 24);
  } else {
    return null;
  }

  if (timescale < 1 || duration < 1n || duration === 0xffffffffffffffffn) return null;
  const milliseconds = Number(duration) * 1000 / timescale;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > Number.MAX_SAFE_INTEGER) return null;
  return Math.round(milliseconds);
}

function parseMovieBoxDuration(buffer: Buffer, atom: AtomBox): number | null {
  let childOffset = atom.payloadStart;
  while (childOffset + 8 <= atom.end) {
    const child = readAtom(buffer, childOffset, atom.end);
    if (!child) return null;
    if (child.type === 'mvhd') return parseMovieHeaderDuration(buffer, child);
    if (child.end <= childOffset) return null;
    childOffset = child.end;
  }
  return null;
}

/**
 * Reads MP4/MOV/M4V duration from an ISO-BMFF movie header in a bounded prefix.
 * Fast-start files commonly place moov near the start of the file.
 */
export function readMp4DurationMs(buffer: Buffer): number | null {
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const atom = readAtom(buffer, offset, buffer.length);
    if (!atom) return null;

    if (atom.type === 'moov') return parseMovieBoxDuration(buffer, atom);

    // A top-level atom extending beyond the supplied prefix means later bytes
    // are not at a known atom boundary, so do not scan arbitrary payload data.
    if (atom.end <= offset || atom.end >= buffer.length) return null;
    offset = atom.end;
  }
  return null;
}

/**
 * Finds and validates a complete moov atom inside a bounded suffix. This
 * supports ordinary non-fast-start MP4/MOV/M4V files without reading the full
 * video into memory. Candidate signatures are accepted only when the atom's
 * declared size fits completely inside the supplied suffix.
 */
export function readMp4DurationMsFromTail(buffer: Buffer): number | null {
  let typeOffset = buffer.indexOf('moov', 4, 'ascii');
  while (typeOffset >= 4) {
    const atomOffset = typeOffset - 4;
    const atom = readAtom(buffer, atomOffset, buffer.length);
    if (atom?.type === 'moov') {
      const size32 = buffer.readUInt32BE(atomOffset);
      const declaredSize = size32 === 0
        ? buffer.length - atomOffset
        : size32 === 1 && atomOffset + 16 <= buffer.length
          ? Number(buffer.readBigUInt64BE(atomOffset + 8))
          : size32;
      const complete = Number.isSafeInteger(declaredSize) &&
        declaredSize >= atom.payloadStart - atomOffset &&
        atomOffset + declaredSize <= buffer.length;
      if (complete) {
        const duration = parseMovieBoxDuration(buffer, atom);
        if (duration !== null) return duration;
      }
    }
    typeOffset = buffer.indexOf('moov', typeOffset + 4, 'ascii');
  }
  return null;
}
