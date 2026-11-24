const MAX_EXTERNAL_URL_LENGTH = 4_096;

/**
 * Accept only ordinary HTTP(S) links before opening them outside the app.
 * Reject credentials so a saved link cannot silently embed login details.
 */
export function normalizeSafeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_EXTERNAL_URL_LENGTH) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
