#!/usr/bin/env node
// ── Pack topmind Obsidian Plugin → release zip ────────────────────────────
//
// Creates a distributable zip: main.js + manifest.json + styles.css + templates/
//
// Cross-platform: uses Node.js built-in zlib + manual ZIP format (no external
// `zip` command needed). Works on macOS, Linux, and Windows.
//
// Usage: npm run pack

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..");
const distDir = path.join(root, "dist");
const releaseDir = path.join(root, "release");
const monorepoDist = path.join(repoRoot, "dist");

// ── Minimal ZIP writer (cross-platform, no native deps) ───────────────────
// ZIP format spec: https://pkware.cachefly.net/webdoc/casestudy/casestudy.html
// We use STORE (no compression) for small files and DEFLATE for larger ones.

const STORED = 0;
const DEFLATED = 8;

function crc32(data) {
  // Use Node's zlib CRC via createHash — but we need the raw CRC32.
  // Implementation: use a lookup table.
  const table = crc32.table ??= (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[i] = c;
    }
    return t;
  })();

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Create a ZIP archive buffer from a list of files.
 * @param {{ name: string, data: Buffer }[]} files
 * @returns {Buffer}
 */
function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf-8");
    const data = file.data;
    const crc = crc32(data);

    // Choose compression: use DEFLATE for files > 1KB, STORE for smaller
    const useDeflate = data.length > 1024;
    const method = useDeflate ? DEFLATED : STORED;
    const compressed = useDeflate ? deflateRawSync(data) : data;
    const compressedSize = compressed.length;
    const uncompressedSize = data.length;

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);      // signature
    localHeader.writeUInt16LE(20, 4);                // version needed
    localHeader.writeUInt16LE(0, 6);                 // flags
    localHeader.writeUInt16LE(method, 8);            // compression method
    localHeader.writeUInt16LE(0, 10);                // mod time
    localHeader.writeUInt16LE(0, 12);                // mod date
    localHeader.writeUInt32LE(crc, 14);              // CRC-32
    localHeader.writeUInt32LE(compressedSize, 18);   // compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);   // name length
    localHeader.writeUInt16LE(0, 28);                // extra length
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, compressed);

    // Central directory file header (46 bytes + name)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);       // signature
    centralHeader.writeUInt16LE(20, 4);               // version made by
    centralHeader.writeUInt16LE(20, 6);               // version needed
    centralHeader.writeUInt16LE(0, 8);                // flags
    centralHeader.writeUInt16LE(method, 10);           // compression method
    centralHeader.writeUInt16LE(0, 12);                // mod time
    centralHeader.writeUInt16LE(0, 14);                // mod date
    centralHeader.writeUInt32LE(crc, 16);              // CRC-32
    centralHeader.writeUInt32LE(compressedSize, 20);  // compressed size
    centralHeader.writeUInt32LE(uncompressedSize, 24);// uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28); // name length
    centralHeader.writeUInt16LE(0, 30);               // extra length
    centralHeader.writeUInt16LE(0, 32);               // comment length
    centralHeader.writeUInt16LE(0, 34);               // disk number start
    centralHeader.writeUInt16LE(0, 36);               // internal attrs
    centralHeader.writeUInt32LE(0, 38);               // external attrs
    centralHeader.writeUInt32LE(offset, 42);          // local header offset
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);

    offset += localHeader.length + compressed.length;
  }

  const centralSize = centralParts.reduce((sum, buf) => sum + buf.length, 0);
  const centralOffset = offset;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // signature
  eocd.writeUInt16LE(0, 4);               // disk number
  eocd.writeUInt16LE(0, 6);               // disk with central dir
  eocd.writeUInt16LE(files.length, 8);    // entries on this disk
  eocd.writeUInt16LE(files.length, 10);   // total entries
  eocd.writeUInt32LE(centralSize, 12);    // central dir size
  eocd.writeUInt32LE(centralOffset, 16);  // central dir offset
  eocd.writeUInt16LE(0, 20);              // comment length

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

// ── Main pack function ───────────────────────────────────────────────────

async function main() {
  // Read version from manifest
  const manifestPath = path.join(distDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error("manifest.json not found in dist/. Run npm run build first.");
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const version = manifest.version;

  console.log(`[pack] topmind-obsidian v${version}`);

  // Ensure release directory
  if (!existsSync(releaseDir)) {
    await mkdir(releaseDir, { recursive: true });
  }

  // Collect files to zip
  const files = [];
  const addFile = (relPath) => {
    const abs = path.join(distDir, relPath);
    if (existsSync(abs)) {
      files.push({ relPath, abs, stat: statSync(abs) });
    }
  };

  addFile("main.js");
  addFile("manifest.json");
  addFile("styles.css");

  // Add templates directory
  const templatesDir = path.join(distDir, "templates");
  if (existsSync(templatesDir)) {
    for (const file of readdirSync(templatesDir)) {
      if (file.endsWith(".json")) {
        addFile(path.join("templates", file));
      }
    }
  }

  const zipName = `topmind-obsidian-${version}.zip`;
  const outputPath = path.join(releaseDir, zipName);

  console.log(`[pack] Files to include:`);
  for (const f of files) {
    console.log(`  ${f.relPath} (${Math.ceil(f.stat.size / 1024)}KB)`);
  }

  // Create zip using cross-platform Node.js implementation
  const zipFiles = files.map((f) => ({
    name: f.relPath.replace(/\\/g, "/"),
    data: readFileSync(f.abs),
  }));

  const zipBuffer = createZip(zipFiles);
  await writeFile(outputPath, zipBuffer);

  // Mirror to monorepo dist/ (same as skills/extension) + SHA256SUMS for release upload
  if (!existsSync(monorepoDist)) {
    await mkdir(monorepoDist, { recursive: true });
  }
  const monorepoZip = path.join(monorepoDist, zipName);
  await copyFile(outputPath, monorepoZip);
  const sha = createHash("sha256").update(zipBuffer).digest("hex");
  const sumsBody = `${sha}  ${zipName}\n`;
  await writeFile(path.join(releaseDir, `topmind-obsidian-${version}.SHA256SUMS`), sumsBody);
  await writeFile(path.join(monorepoDist, `topmind-obsidian-${version}.SHA256SUMS`), sumsBody);

  console.log(`[pack] ✓ Created ${outputPath}`);
  console.log(`[pack] ✓ Mirrored ${monorepoZip}`);
  console.log(`[pack] Size: ${Math.ceil(zipBuffer.length / 1024)}KB`);
  console.log(`[pack] Install: unzip into <vault>/.obsidian/plugins/topmind-stream/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
