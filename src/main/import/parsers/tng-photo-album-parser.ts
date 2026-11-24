const MAX_TNG_ALBUM_PHOTOS = 5000;
const MAX_TEXT_LENGTH = 20000;

export interface TngPhotoAlbumPhoto {
  sourceIndex: number;
  imagePath: string;
  captionRaw: string | null;
  dateRaw: string | null;
}

export interface TngPhotoAlbumJson {
  albumTitle: string;
  descriptionRaw: string | null;
  dateRaw: string | null;
  coverPath: string | null;
  photos: TngPhotoAlbumPhoto[];
  invalidPhotoPaths: number;
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, MAX_TEXT_LENGTH)
    : null;
}

function safeLocalPhotoPath(value: unknown): string | null {
  const path = cleanString(value);
  if (!path || path.length > 2000 ||
      !path.startsWith('your_facebook_activity/posts/media/') ||
      path.startsWith('/') ||
      /^[a-z][a-z0-9+.-]*:/iu.test(path) ||
      path.split('/').some((part) => !part || part === '.' || part === '..')) {
    return null;
  }
  return path;
}

function rawTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return cleanString(value);
}

/** Parses a self-contained TNG posts/album/{id}.json album detail file. */
export function parseTngPhotoAlbumJson(jsonText: string, sourceFile: string): TngPhotoAlbumJson | null {
  const normalizedPath = sourceFile.toLocaleLowerCase().replace(/\\/gu, '/');
  if (!/^your_facebook_activity\/posts\/album\/[^/]+\.json$/u.test(normalizedPath)) {
    throw new Error('Unsupported TNG photo album source path.');
  }

  const parsed: unknown = JSON.parse(jsonText);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const album = parsed as Record<string, unknown>;
  const albumTitle = cleanString(album.name);
  if (!albumTitle || !Array.isArray(album.photos)) return null;

  const photos: TngPhotoAlbumPhoto[] = [];
  let invalidPhotoPaths = 0;
  album.photos.slice(0, MAX_TNG_ALBUM_PHOTOS).forEach((value, sourceIndex) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      invalidPhotoPaths += 1;
      return;
    }
    const photo = value as Record<string, unknown>;
    const imagePath = safeLocalPhotoPath(photo.uri);
    if (!imagePath) {
      invalidPhotoPaths += 1;
      return;
    }
    photos.push({
      sourceIndex,
      imagePath,
      captionRaw: cleanString(photo.description),
      dateRaw: rawTimestamp(photo.creation_timestamp)
    });
  });

  const cover = typeof album.cover_photo === 'object' && album.cover_photo !== null && !Array.isArray(album.cover_photo)
    ? album.cover_photo as Record<string, unknown>
    : null;

  return {
    albumTitle,
    descriptionRaw: cleanString(album.description),
    dateRaw: rawTimestamp(album.last_modified_timestamp),
    coverPath: cover ? safeLocalPhotoPath(cover.uri) : null,
    photos,
    invalidPhotoPaths
  };
}
