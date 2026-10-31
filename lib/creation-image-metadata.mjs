/** Bounded container inspection for local cover images; this does not decode pixels. */
export const MAX_CREATION_COVER_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 100_000_000;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes, start, end) {
  let value = 0xffffffff;
  for (let i = start; i < end; i += 1) value = CRC_TABLE[(value ^ bytes[i]) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function dimensions(format, width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
    width * height <= MAX_PIXELS ? { format, width, height } : null;
}

function inspectPng(bytes) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  let offset = 8;
  let size = null;
  let hasImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (crc32(bytes, offset + 4, offset + 8 + length) !== bytes.readUInt32BE(offset + 8 + length)) return null;
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13 || bytes[offset + 18] !== 0 ||
          bytes[offset + 19] !== 0 || ![0, 1].includes(bytes[offset + 20])) return null;
      size = dimensions("png", bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12));
      if (!size) return null;
    } else if (type === "IHDR") return null;
    if (type === "IDAT") hasImageData ||= length > 0;
    if (type === "IEND") return length === 0 && hasImageData && end === bytes.length ? size : null;
    offset = end;
  }
  return null;
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function inspectJpeg(bytes) {
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let size = null;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0x00) return null;
    if (marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (JPEG_SOF.has(marker)) {
      if (length < 8 || bytes[offset + 2] !== 8) return null;
      size = dimensions("jpeg", bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      if (!size) return null;
    }
    if (marker === 0xda) {
      return size && offset + length < bytes.length - 2 &&
        bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9 ? size : null;
    }
    offset += length;
  }
  return null;
}

function inspectWebp(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  let offset = 12;
  let size = null;
  let hasImageData = false;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    const next = end + (length % 2);
    if (next > bytes.length) return null;
    let found = null;
    if (type === "VP8 ") {
      if (length < 10 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) return null;
      found = dimensions("webp", bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
      hasImageData = true;
    } else if (type === "VP8L") {
      if (length < 5 || bytes[start] !== 0x2f) return null;
      found = dimensions("webp", 1 + bytes[start + 1] + ((bytes[start + 2] & 0x3f) << 8),
        1 + (bytes[start + 2] >>> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 0x0f) << 10));
      hasImageData = true;
    } else if (type === "VP8X") {
      if (length < 10) return null;
      found = dimensions("webp", 1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3));
    } else if (type === "ANIM" || type === "ANMF") return null;
    if ((type === "VP8 " || type === "VP8L" || type === "VP8X") && !found) return null;
    if (found && size && (found.width !== size.width || found.height !== size.height)) return null;
    if (found) size = found;
    offset = next;
  }
  return offset === bytes.length && hasImageData ? size : null;
}

/** Signature hint only; use inspectCreationCoverImageBytes for validation. */
export function sniffCreationCoverFormat(input) {
  if (!(input instanceof Uint8Array) || input.byteLength < 3) return null;
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/** Return encoded dimensions after bounded container checks, or null. */
export function inspectCreationCoverImageBytes(input) {
  if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > MAX_CREATION_COVER_BYTES) return null;
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const format = sniffCreationCoverFormat(bytes);
  if (format === "png") return inspectPng(bytes);
  if (format === "jpeg") return inspectJpeg(bytes);
  if (format === "webp") return inspectWebp(bytes);
  return null;
}
