/**
 * Local AES-256-GCM secret adapter — survives brew/app reinstall when
 * Electron safeStorage ciphertext becomes undecryptable (ad-hoc code
 * signature changes on unsigned macOS builds).
 *
 * Key material lives next to app-settings.json as `.secret-key` (0600).
 * safeStorage remains the primary layer; this is the durable fallback.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const KEY_FILE = ".secret-key";
const MAGIC = "v1aes:";

function keyPathFor(settingsFilePath) {
  return path.join(path.dirname(path.resolve(settingsFilePath)), KEY_FILE);
}

async function ensureKey(settingsFilePath) {
  const kp = keyPathFor(settingsFilePath);
  try {
    const raw = await fs.readFile(kp);
    if (raw.length === 32) return raw;
  } catch {
    /* generate below */
  }
  const key = crypto.randomBytes(32);
  await fs.mkdir(path.dirname(kp), { recursive: true });
  await fs.writeFile(kp, key, { mode: 0o600 });
  try {
    await fs.chmod(kp, 0o600);
  } catch {
    /* Windows — no-op */
  }
  return key;
}

/**
 * @param {string} settingsFilePath path to app-settings.json
 */
export async function createLocalSecretAdapter(settingsFilePath) {
  const key = await ensureKey(settingsFilePath).catch(() => null);
  if (!key) {
    return {
      available: false,
      encryptLocal: null,
      decryptLocal: null,
    };
  }
  return {
    available: true,
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
