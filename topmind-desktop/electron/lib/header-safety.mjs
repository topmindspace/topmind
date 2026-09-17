/**
 * HTTP header values must be ByteString (Latin-1, code units ≤ 0xFF).
 * A corrupted API key containing U+FFFD or CJK throws
 * "Cannot convert argument to a ByteString..." before the request is sent.
 * Treat such secrets as missing so model-catalog refresh does not error-loop.
 */

/**
 * @param {unknown} key
 * @returns {boolean} true when the key is non-empty and Latin-1-safe for headers
 */
export function isHeaderSafeSecret(key) {
  if (typeof key !== "string" || !key.trim()) return false;
  return !/[^\u0000-\u00FF]/u.test(key);
}
