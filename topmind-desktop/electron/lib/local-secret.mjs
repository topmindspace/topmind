/**
 * Local AES-256-GCM secret adapter — survives brew/app reinstall when
 * Electron safeStorage ciphertext becomes undecryptable (ad-hoc code
 * signature changes on unsigned macOS builds).
 *
 * Key material lives next to app-settings.json as `.secret-key` (0600).
 * A `.secret-key.bak` copy is kept so accidental truncation / a bad write
 * does not permanently orphan every local-AES blob.
 * safeStorage remains the primary layer; this is the durable fallback.
 *
 * Critical: never silently rotate the key while ciphertext exists —
 * rotating orphans every local blob. Prefer bak, then refuse to invent
 * a new key when `orphanGuard` is set (caller detects existing blobs).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const KEY_FILE = ".secret-key";
const KEY_BAK_FILE = ".secret-key.bak";
const MAGIC = "v1aes:";

function keyPathFor(settingsFilePath) {
  return path.join(path.dirname(path.resolve(settingsFilePath)), KEY_FILE);
}

function keyBakPathFor(settingsFilePath) {
  return path.join(path.dirname(path.resolve(settingsFilePath)), KEY_BAK_FILE);
}

async function readKeyIfValid(filePath) {
  try {
    const raw = await fs.readFile(filePath);
    if (raw.length === 32) return raw;
  } catch {
    /* missing / unreadable */
  }
  return null;
}

async function writeKeyFile(filePath, key) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, key, { mode: 0o600 });
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    /* Windows — no-op */
  }
}

/**
 * Resolve the local AES key material.
 * Order: `.secret-key` → `.secret-key.bak` (restore) → generate + backup.
 *
 * @param {string} settingsFilePath
 * @param {{ orphanGuard?: boolean }} [opts] when true, do not generate a fresh
 *   key if neither file exists — return null so the caller can surface "keys lost"
 *   instead of silently encrypting future writes with a key that cannot open
 *   the previous envelope.
 */
async function resolveKey(settingsFilePath, opts = {}) {
  const kp = keyPathFor(settingsFilePath);
  const bak = keyBakPathFor(settingsFilePath);

  const primary = await readKeyIfValid(kp);
  if (primary) {
    // Keep bak in sync whenever the primary is healthy.
    try {
      const bakKey = await readKeyIfValid(bak);
      if (!bakKey || !bakKey.equals(primary)) await writeKeyFile(bak, primary);
    } catch { /* best-effort */ }
    return primary;
  }

  // Primary missing or wrong length: restore from bak before inventing a key.
  const bakKey = await readKeyIfValid(bak);
  if (bakKey) {
    try {
      await writeKeyFile(kp, bakKey);
    } catch { /* still usable from memory */ }
    return bakKey;
  }

  if (opts.orphanGuard) return null;

  const key = crypto.randomBytes(32);
  await writeKeyFile(kp, key);
  try {
    await writeKeyFile(bak, key);
  } catch { /* best-effort */ }
  return key;
}

/** @returns {{ keyPath: string, bakPath: string, hasKey: boolean }} */
export function localSecretKeyPaths(settingsFilePath) {
  const keyPath = keyPathFor(settingsFilePath);
  const bakPath = keyBakPathFor(settingsFilePath);
  return { keyPath, bakPath, hasKey: false };
}

/**
 * @param {string} settingsFilePath path to app-settings.json
 * @param {{ orphanGuard?: boolean }} [opts]
 */
export async function createLocalSecretAdapter(settingsFilePath, opts = {}) {
  const key = await resolveKey(settingsFilePath, opts).catch(() => null);
  if (!key) {
    return {
      available: false,
      encryptLocal: null,
      decryptLocal: null,
    };
  }
  return {
    available: true,
    keyPath: keyPathFor(settingsFilePath),
    encryptLocal(plain) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return MAGIC + Buffer.concat([iv, tag, enc]).toString("base64");
    },
    decryptLocal(blob) {
      const s = String(blob || "");
      if (!s.startsWith(MAGIC)) throw new Error("not-local-aes");
      const buf = Buffer.from(s.slice(MAGIC.length), "base64");
      if (buf.length < 28) throw new Error("local-aes-short");
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const enc = buf.subarray(28);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
    },
  };
}

export { MAGIC as LOCAL_SECRET_MAGIC, KEY_FILE as LOCAL_SECRET_KEY_FILE };
