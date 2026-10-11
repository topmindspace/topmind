import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  normalizeManifest,
  listExternalPlugins,
  exampleManifest,
} from "../electron/lib/external-plugins.mjs";

/** Mirror host isExternalEnabledInSettings (pure; avoids importing renderer host). */
function isExternalEnabledInSettings(pluginId, settings) {
  const map = settings?.plugins?.externalEnabled;
  if (!map || typeof map !== "object") return true;
  return map[pluginId] !== false;
}

test("normalizeManifest requires id name version and rejects reserved ids", () => {
  assert.equal(normalizeManifest({}).ok, false);
  const ok = normalizeManifest(exampleManifest());
  assert.equal(ok.ok, true);
  assert.equal(ok.manifest.id, "example-hello");
  assert.equal(ok.manifest.main, "index.mjs");

  const reserved = normalizeManifest({
    id: "topmind-workspace",
    name: "X",
    version: "1.0.0",
  });
  assert.equal(reserved.ok, false);
  assert.match(reserved.error, /reserved/i);
});

test("listExternalPlugins discovers valid plugin folders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mh-plugins-"));
  const dir = path.join(root, "hello");
  await fs.mkdir(dir);
  await fs.writeFile(
    path.join(dir, "topmind-plugin.json"),
    JSON.stringify(exampleManifest(), null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(dir, "index.mjs"), "export default {};\n", "utf8");

  const list = await listExternalPlugins(root);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, "ready");
  assert.equal(list[0].manifest.id, "example-hello");
  assert.ok(list[0].entryUrl?.startsWith("file:"));

  // invalid
  const bad = path.join(root, "bad");
  await fs.mkdir(bad);
  await fs.writeFile(path.join(bad, "topmind-plugin.json"), "{not json", "utf8");
  const list2 = await listExternalPlugins(root);
  assert.equal(list2.length, 2);
  assert.ok(list2.some((p) => p.status === "invalid"));
});

test("external enable map: missing key = on, false = off", () => {
  assert.equal(isExternalEnabledInSettings("a", null), true);
  assert.equal(isExternalEnabledInSettings("a", { plugins: {} }), true);
  assert.equal(isExternalEnabledInSettings("a", { plugins: { externalEnabled: {} } }), true);
  assert.equal(
    isExternalEnabledInSettings("a", { plugins: { externalEnabled: { a: true } } }),
    true,
  );
  assert.equal(
    isExternalEnabledInSettings("a", { plugins: { externalEnabled: { a: false } } }),
    false,
  );
  assert.equal(
    isExternalEnabledInSettings("b", { plugins: { externalEnabled: { a: false } } }),
    true,
  );
});
