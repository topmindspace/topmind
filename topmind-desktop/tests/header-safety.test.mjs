import { test } from "node:test";
import assert from "node:assert/strict";
import { isHeaderSafeSecret } from "../electron/lib/header-safety.mjs";

test("isHeaderSafeSecret rejects empty and non-Latin1 keys", () => {
  assert.equal(isHeaderSafeSecret("sk-ok-123"), true);
  assert.equal(isHeaderSafeSecret("café"), true);
  assert.equal(isHeaderSafeSecret(""), false);
  assert.equal(isHeaderSafeSecret("   "), false);
  assert.equal(isHeaderSafeSecret(undefined), false);
  // U+FFFD replacement char — the ByteString crash seen with corrupted minimaxKey
  assert.equal(isHeaderSafeSecret("eyJ�xx"), false);
  assert.equal(isHeaderSafeSecret("密钥abc"), false);
});

test("system-service fetchLiveModels guards header-unsafe keys and quiets ollama ECONNREFUSED", async () => {
  const { readFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const src = readFileSync(path.join(root, "electron/system-service.mjs"), "utf8");
  assert.match(src, /isHeaderSafeSecret/u);
  assert.match(src, /skipped invalid key/u);
  assert.match(src, /ECONNREFUSED/u);
  assert.match(src, /fetchLiveModels ollama skipped/u);
});
