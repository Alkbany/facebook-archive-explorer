import yauzl, { type Entry, type ZipFile } from 'yauzl';
import type { Readable } from 'node:stream';

export type ZipArchiveErrorCode =
  | 'INVALID_RELATIVE_PATH'
  | 'FILE_NOT_FOUND'
  | 'SYMLINK_NOT_ALLOWED'
  | 'NOT_A_FILE'
  | 'FILE_TOO_LARGE';

export class ZipArchiveError extends Error {
  constructor(public readonly code: ZipArchiveErrorCode) {
    super(code);
    this.name = 'ZipArchiveError';
  }
}

export interface ZipEntryIterationSummary {
  entriesRead: number;
  truncated: boolean;
}

async function openZipArchive(zipPath: string): Promise<ZipFile> {
  try {
    return await yauzl.openPromise(zipPath, {
      autoClose: false,
      lazyEntries: true,
      validateEntrySizes: true,
      decodeStrings: true,
      strictFileNames: false
    });
  } catch (error) {
    if (error instanceof Error && /invalid relative path/iu.test(error.message)) {
      throw new ZipArchiveError('INVALID_RELATIVE_PATH');
    }
    throw error;
  }
}

function normalizeZipEntryName(fileName: string): string {
  const portable = fileName.replace(/\\/gu, '/');
  if (
    !portable ||
    portable.includes('\0') ||
    portable.startsWith('/') ||
    /^[a-zA-Z]:/u.test(portable) ||
    portable.split('/').includes('..')
  ) {
    throw new ZipArchiveError('INVALID_RELATIVE_PATH');
  }

  const normalized = portable.split('/').filter((segment) => segment && segment !== '.').join('/');
  if (!normalized) throw new ZipArchiveError('INVALID_RELATIVE_PATH');
  return normalized;
}

export function isZipDirectoryEntry(entry: Entry): boolean {
  const unixHost = (entry.versionMadeBy >>> 8) === 3;
  const unixMode = unixHost ? (entry.externalFileAttributes >>> 16) & 0xffff : 0;
  return entry.fileName.endsWith('/') || (unixMode & 0o170000) === 0o040000;
}

export function isZipSymbolicLinkEntry(entry: Entry): boolean {
  const unixHost = (entry.versionMadeBy >>> 8) === 3;
  if (!unixHost) return false;
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

export function getSafeZipEntryPath(entry: Entry): string {
  return normalizeZipEntryName(entry.fileName);
}

/**
 * Iterates the ZIP central directory one entry at a time. The archive is not
 * extracted and file contents are not decompressed during inventory.
 */
export async function forEachZipEntry(
  zipPath: string,
  onEntry: (entry: Entry) => void | Promise<void>,
  maxEntries = 100_000
): Promise<ZipEntryIterationSummary> {
  const zip = await openZipArchive(zipPath);

  let entriesRead = 0;
  let truncated = false;
  try {
    for await (const entry of zip.eachEntry()) {
      entriesRead += 1;
      if (entriesRead > maxEntries) {
        truncated = true;
        break;
      }
      await onEntry(entry);
    }
    return { entriesRead: Math.min(entriesRead, maxEntries), truncated };
  } catch (error) {
    if (error instanceof Error && /invalid relative path/iu.test(error.message)) {
      throw new ZipArchiveError('INVALID_RELATIVE_PATH');
    }
    throw error;
  } finally {
    zip.close();
  }
}

async function findZipEntry(
  zip: ZipFile,
  relativePath: string
): Promise<Entry> {
  const requested = normalizeZipEntryName(relativePath);
  try {
    for await (const entry of zip.eachEntry()) {
      if (isZipDirectoryEntry(entry)) continue;
      const safePath = getSafeZipEntryPath(entry);
      if (safePath === requested) {
        if (isZipSymbolicLinkEntry(entry)) throw new ZipArchiveError('SYMLINK_NOT_ALLOWED');
        return entry;
      }
    }
  } catch (error) {
    if (error instanceof Error && /invalid relative path/iu.test(error.message)) {
      throw new ZipArchiveError('INVALID_RELATIVE_PATH');
    }
    throw error;
  }
  throw new ZipArchiveError('FILE_NOT_FOUND');
}

/** Reads one bounded ZIP entry into memory. Intended for small HTML/JSON and bounded media previews only. */
export async function readZipEntryBuffer(
  zipPath: string,
  relativePath: string,
  maxBytes: number
): Promise<Buffer> {
  const zip = await openZipArchive(zipPath);

  try {
    const entry = await findZipEntry(zip, relativePath);
    if (entry.uncompressedSize > maxBytes) throw new ZipArchiveError('FILE_TOO_LARGE');
    if (!entry.canDecodeFileData() || entry.isEncrypted()) throw new ZipArchiveError('NOT_A_FILE');

    const stream = await zip.openReadStreamPromise(entry);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        stream.destroy();
        throw new ZipArchiveError('FILE_TOO_LARGE');
      }
      chunks.push(buffer);
    }
    if (totalBytes !== entry.uncompressedSize) throw new ZipArchiveError('NOT_A_FILE');
    return Buffer.concat(chunks, totalBytes);
  } finally {
    zip.close();
  }
}

/** Returns an entry's uncompressed size without opening its data stream. */
export async function getZipEntrySize(zipPath: string, relativePath: string): Promise<number> {
  const zip = await openZipArchive(zipPath);
  try {
    const entry = await findZipEntry(zip, relativePath);
    if (!entry.canDecodeFileData() || entry.isEncrypted()) throw new ZipArchiveError('NOT_A_FILE');
    return entry.uncompressedSize;
  } finally {
    zip.close();
  }
}

/** Opens a bounded stream for a single entry. The caller must invoke close() after consuming or destroying the stream. */
export async function openZipEntryReadStream(
  zipPath: string,
  relativePath: string,
  start?: number,
  end?: number
): Promise<{ stream: Readable; size: number; close: () => void }> {
  const zip = await openZipArchive(zipPath);
  try {
    const entry = await findZipEntry(zip, relativePath);
    if (!entry.canDecodeFileData() || entry.isEncrypted()) throw new ZipArchiveError('NOT_A_FILE');
    if (start !== undefined || end !== undefined) {
      const rangeStart = start ?? 0;
      const rangeEnd = end ?? entry.uncompressedSize - 1;
      if (
        !Number.isSafeInteger(rangeStart) ||
        !Number.isSafeInteger(rangeEnd) ||
        rangeStart < 0 ||
        rangeEnd < rangeStart ||
        rangeStart >= entry.uncompressedSize
      ) {
        throw new ZipArchiveError('INVALID_RELATIVE_PATH');
      }
    }
    const stream = await zip.openReadStreamPromise(entry, start === undefined && end === undefined
      ? undefined
      : { start: start ?? 0, end: (end ?? entry.uncompressedSize - 1) + 1 });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      zip.close();
    };
    stream.once('close', close);
    stream.once('end', close);
    stream.once('error', close);
    return { stream, size: entry.uncompressedSize, close };
  } catch (error) {
    zip.close();
    throw error;
  }
}
