const PARSER_KEY_PATTERN = /^[a-z0-9_]{1,80}$/u;

/**
 * Records which reviewed parser was attempted before a generic fallback had
 * to preserve the file. The composite key prevents that same parser from
 * re-running on every ordinary Import All pass. A later parser upgrade can
 * explicitly reset the fallback key through a database migration.
 */
export function getFallbackParserKey(previousParserKey: string | null | undefined, fallbackKey: string): string {
  if (!PARSER_KEY_PATTERN.test(fallbackKey)) {
    throw new Error('Invalid fallback parser key.');
  }
  if (!previousParserKey) return fallbackKey;
  if (!PARSER_KEY_PATTERN.test(previousParserKey)) return fallbackKey;
  if (previousParserKey === fallbackKey || previousParserKey.endsWith('_' + fallbackKey)) {
    return previousParserKey;
  }
  return (previousParserKey + '_' + fallbackKey).slice(0, 120);
}
