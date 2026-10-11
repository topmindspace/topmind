/**
 * Clip extension buffer (inbox) discovery — source contract.
 * Prefer topmind.yaml → 00-* dirs → default 00-Inbox.
 * No v3 `.topmind-config.json` hot path.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = path.join(root, "browser-extension/lib/workspace-fs.js");

function readSrc() {
  return fs.readFileSync(srcPath, "utf8");
}

/** Extract resolveInboxHandle body between function open and next top-level comment/function. */
function extractResolveInboxHandle(src) {
  const start = src.indexOf("async function resolveInboxHandle");
  assert.ok(start >= 0, "resolveInboxHandle must exist");
  const next = src.indexOf("\nasync function ", start + 10);
  const end = next > start ? next : src.indexOf("\nexport ", start);
  assert.ok(end > start, "could not bound resolveInboxHandle");
  return src.slice(start, end);
}

describe("extension resolveInboxHandle order", () => {
  it("prefers topmind.yaml buffer role then 00-* dirs; no v3 JSON", () => {
    const body = extractResolveInboxHandle(readSrc());
    const yamlIdx = body.indexOf('getFileHandle("topmind.yaml")');
    const legacyIdx = body.indexOf('getFileHandle(".topmind-config.json")');
    const enumIdx = body.indexOf("root.entries()");
    assert.ok(yamlIdx >= 0, "must read topmind.yaml");
    assert.equal(legacyIdx, -1, "must not fall back to .topmind-config.json");
    assert.ok(enumIdx >= 0, "must enumerate 00-* dirs");
    assert.ok(yamlIdx < enumIdx, "yaml before 00-* enumerate");
  });

  it("parses categories.*.role buffer|inbox from yaml text", () => {
    const body = extractResolveInboxHandle(readSrc());
    assert.match(body, /role:\\s\*\(buffer\|inbox\)\\b/);
    assert.match(body, /categories:/);
  });

  it("pushes locale defaults including 00-收件箱 and 00-Inbox last", () => {
    const body = extractResolveInboxHandle(readSrc());
    const pushBlock = body.slice(body.indexOf("candidates.push("));
    assert.match(pushBlock, /00-收件箱/);
    assert.match(pushBlock, /00-Inbox/);
    assert.match(body, /getDirectoryHandle\("00-Inbox",\s*\{\s*create:\s*true\s*\}/);
  });

  it("dedupes candidates before probing handles", () => {
    const body = extractResolveInboxHandle(readSrc());
    assert.match(body, /new Set\(\)/);
    assert.match(body, /seen\.has/);
  });
});
