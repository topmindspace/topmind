/** SHA-256 for browser and Node hosts; never hashes by reading a path. */
export async function sha256Bytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('SHA-256 input must be bytes');
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // Node 18 may run without the global Web Crypto API. Keep browser imports portable.
  if (typeof process !== 'undefined' && process.versions?.node) {
    const nodeCrypto = 'node:crypto';
    const { createHash } = await import(nodeCrypto);
    return createHash('sha256').update(bytes).digest('hex');
  }
  throw new Error('SHA-256 is unavailable');
}

export async function sha256(value) {
  return sha256Bytes(new TextEncoder().encode(value));
}
