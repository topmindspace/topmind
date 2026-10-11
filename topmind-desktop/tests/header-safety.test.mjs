import { test } from "node:test";
import assert from "node:assert/strict";
import { isHeaderSafeSecret, MAX_SECRET_BYTES, headerSafe, bearerHeader } from "../electron/lib/header-safety.mjs";

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

test("isHeaderSafeSecret rejects oversized keys (Request Header Or Cookie Too Large)", () => {
  const huge = "eyJ" + "a".repeat(MAX_SECRET_BYTES + 1);
  assert.equal(isHeaderSafeSecret(huge), false);
  assert.equal(isHeaderSafeSecret("k".repeat(MAX_SECRET_BYTES)), true);
  // headerSafe must NOT silently truncate — length is a validity axis
  assert.equal(headerSafe(huge).length, huge.length);
  // bearerHeader refuses to emit an oversized Authorization header
  assert.deepEqual(bearerHeader(huge), {});
});

test("summarizeError never echoes request/response bodies", async () => {
  const { summarizeError } = await import("../electron/lib/writeback.mjs");
  const err = Object.assign(new Error("Bad Request"), {
    name: "APICallError",
    statusCode: 400,
    requestBodyValues: { messages: [{ role: "user", content: "secret prompt" }] },
    responseBody: "<html>huge</html>",
    stack: "APICallError: Bad Request\n    at postToApi (file:///x/index.js:1:1)",
  });
  const s = summarizeError(err);
  assert.match(s, /APICallError/u);
  assert.match(s, /Bad Request/u);
  assert.ok(!s.includes("secret prompt"), "must not leak request body");
  assert.ok(!s.includes("huge</html>"), "must not leak response body");
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
