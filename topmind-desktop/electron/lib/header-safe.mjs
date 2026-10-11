/**
 * HTTP header values must be ByteString (Latin-1, code units ≤ 0xFF) **and**
 * must not contain control characters (CR / LF / NUL / …) — undici's
 * `appendHeader` throws `invalidArgument` for those, and `new Throws` for
 * anything above U+00FF.
 *
 * A pasted API key that is actually binary (encrypted blob, image, mojibake)
 * crashes the AI SDK before any network I/O. Sanitize to a legal header value
 * so a bad paste degrades to an auth failure, not a crash — and never let the
 * raw blob reach logs or the terminal.
 */

/**
 * Hard cap for a single header-bound secret (API key / bearer token).
 * Real provider keys are < 2 KB (JWTs are a few hundred bytes). A decrypt
 * that "succeeds" into a huge Latin-1 blob — or a paste of an entire config
 * file — would otherwise ride the Authorization header and trip the CDN/ALB
 * `400 Request Header Or Cookie Too Large` before the provider ever sees it.
 */
export const MAX_SECRET_BYTES = 2048;

/**
 * True when the string can travel in an HTTP header value:
 * Latin-1 only, no control chars (except HT), no DEL, within size cap.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isHeaderSafeSecret(v) {
  if (typeof v !== "string" || !v.trim()) return false;
  if (v.length > MAX_SECRET_BYTES) return false;
  // eslint-disable-next-line no-control-regex
  return !/[^\t\x20-\x7E\xA0-\xFF]/u.test(v);
}

/**
 * Strip anything that cannot travel in an HTTP header value.
 * Keeps printable ASCII + Latin-1 supplement; drops controls, DEL, C1, >U+00FF.
 * Does NOT truncate — length is a separate validity axis (`isHeaderSafeSecret`).
 * @param {unknown} v
 * @returns {string}
 */
export function headerSafe(v) {
  const s = v == null ? "" : String(v);
  if (!s) return "";
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 9 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255)) {
      out += ch;
    }
  }
  return out.trim();
}

/**
 * True when the raw value cannot travel in a header (CJK, emoji, controls,
 * binary, or oversized). Used for user-facing warnings.
 * @param {unknown} v
 * @returns {boolean}
 */
export function keyHadNonLatin1(v) {
  return !isHeaderSafeSecret(v);
}

/**
 * True when the string is present and legal to send as a header value.
 * Distinct from `keyHadNonLatin1` so callers can pick the right warning copy.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isUsableSecret(v) {
  return isHeaderSafeSecret(v);
}

/**
 * Build a Bearer header from a raw token (sanitized). Empty → no header.
 * Bearer tokens are opaque ASCII — also strip embedded whitespace.
 * @param {unknown} rawToken
 * @returns {Record<string, string>}
 */
export function bearerHeader(rawToken) {
  const key = headerSafe(rawToken).replace(/\s+/gu, "");
  if (!key) return {};
  if (key.length > MAX_SECRET_BYTES) return {};
  return { Authorization: `Bearer ${key}` };
}

/**
 * Redact a secret for logs / errors — never echo raw key material.
 * @param {unknown} v
 * @returns {string}
 */
export function redactSecret(v) {
  const s = v == null ? "" : String(v);
  if (!s) return "(empty)";
  return `<redacted len=${s.length}>`;
}
