/**
 * Shared short content hash (sha1 hex truncated).
 * Single algorithm for todo / suggest / ai-operation / ledger fingerprints.
 */
import { createHash } from "node:crypto";

/** @param {string} content @param {number} [len=16] */
export function contentHash(content, len = 16) {
  return createHash("sha1").update(String(content || "")).digest("hex").slice(0, len);
}

/** Case-insensitive text fingerprint for near-identical todo/suggest lines. */
export function textFingerprint(text, len = 12) {
  return createHash("sha1").update(String(text || "").trim().toLowerCase()).digest("hex").slice(0, len);
}
