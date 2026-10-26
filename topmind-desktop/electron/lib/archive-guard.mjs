/** Inspect names and links before invoking a native extractor. Never execute archive contents. */
import { promises as fs } from "node:fs";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
const LIMIT = 128 * 1024 * 1024;
function member(name) {
  const value = name.replace(/\\/gu, "/");
  if (!value || value.startsWith("/") || /^[A-Za-z]:/u.test(value) || value.split("/").includes("..") || /[\u0000-\u001f]/u.test(value)) throw new Error("unsafe archive member");
}
function extras(bytes) {
  for (let at = 0; at + 4 <= bytes.length;) {
    const id = bytes.readUInt16LE(at), size = bytes.readUInt16LE(at + 2);
    if (at + 4 + size > bytes.length) throw new Error("invalid zip extra data");
    if (id === 0x7075 && size > 5) member(bytes.subarray(at + 9, at + 4 + size).toString("utf8"));
    at += size + 4;
  }
}
export async function validateArchive(file) {
  try {
    if ((await fs.stat(file)).size > LIMIT) throw new Error("archive too large");
    const bytes = await fs.readFile(file);
    if (/\.(tar\.gz|tgz)$/iu.test(file)) {
      gunzipSync(bytes, { maxOutputLength: LIMIT });
      const names = spawnSync("tar", ["-tf", file], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      const types = spawnSync("tar", ["-tvf", file], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      if (names.status !== 0 || types.status !== 0) throw new Error("cannot inspect tar archive");
      const entries = names.stdout.trim().split("\n");
      if (entries.length > 10000) throw new Error("too many archive entries");
      for (const entry of entries) member(entry);
      if (types.stdout.trim().split("\n").some(line => !/^[d-]/u.test(line))) throw new Error("archive links and special files are not allowed");
      return { ok: true };
    }
    let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
      if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
    }
    if (end < 0) throw new Error("invalid zip directory");
    const count = bytes.readUInt16LE(end + 10);
    if (!count || count > 10000 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error("unsupported zip directory");
    let at = bytes.readUInt32LE(end + 16), total = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw new Error("invalid zip entry");
      const size = bytes.readUInt32LE(at + 24), n = bytes.readUInt16LE(at + 28), x = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32);
      total += size; if (total > LIMIT || at + 46 + n + x + comment > end) throw new Error("zip expansion limit exceeded");
      const name = bytes.subarray(at + 46, at + 46 + n); member(name.toString("utf8"));
      const mode = (bytes.readUInt32LE(at + 38) >>> 16) & 0xf000;
      if (mode && mode !== 0x8000 && mode !== 0x4000) throw new Error("archive links and special files are not allowed");
      extras(bytes.subarray(at + 46 + n, at + 46 + n + x));
      const local = bytes.readUInt32LE(at + 42);
      if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error("invalid local zip entry");
      const ln = bytes.readUInt16LE(local + 26), lx = bytes.readUInt16LE(local + 28);
      if (!name.equals(bytes.subarray(local + 30, local + 30 + ln))) throw new Error("inconsistent zip member names");
      extras(bytes.subarray(local + 30 + ln, local + 30 + ln + lx));
      at += 46 + n + x + comment;
    }
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
