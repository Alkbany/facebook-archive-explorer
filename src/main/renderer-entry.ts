export type RendererEntry =
  | { kind: 'file' }
  | { kind: 'development-url'; url: string; origin: string };

/**
 * Resolve the renderer entry point without allowing a packaged application
 * to load environment-configured or remote content with its privileged preload.
 * Unpackaged development builds may use only a loopback HTTP dev server.
 */
export function resolveRendererEntry(
  isPackaged: boolean,
  configuredUrl: string | undefined
): RendererEntry {
  if (isPackaged || typeof configuredUrl !== 'string') return { kind: 'file' };

  const candidate = configuredUrl.trim();
  if (!candidate || candidate.length > 2_048) return { kind: 'file' };

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLocaleLowerCase();
    const loopbackHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1';

    if (
      url.protocol !== 'http:' ||
      !loopbackHost ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return { kind: 'file' };
    }

    return {
      kind: 'development-url',
      url: url.toString(),
      origin: url.origin
    };
  } catch {
    return { kind: 'file' };
  }
}
