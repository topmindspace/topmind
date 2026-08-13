/**
 * Ingest settings + tools-cache module surface.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

test("tools-cache module exports read/write/clear (no electron required)", async () => {
  const mod = await import("../electron/lib/ingest/tools-cache.mjs");
  assert.equal(typeof mod.readToolsDiskCache, "function");
  assert.equal(typeof mod.writeToolsDiskCache, "function");
  assert.equal(typeof mod.clearToolsDiskCache, "function");
  // Outside Electron: cache path is null → read returns null, write is no-op
  assert.equal(await mod.readToolsDiskCache(), null);
  await mod.writeToolsDiskCache({
    checkedAt: new Date().toISOString(),
    anydoc: { available: false },
    pandoc: { available: false },
    markitdown: { available: false },
  });
  assert.equal(await mod.readToolsDiskCache(), null);
});

test("resolveIngestSettings includes confirmBeforeConvert defaults", async () => {
  const { resolveIngestSettings, defaultIngestSettings } = await import(
    "../electron/lib/ingest/process-job.mjs"
  );
  const d = defaultIngestSettings();
  assert.equal(d.confirmBeforeConvert, false);
  assert.equal(d.skipConfirmForSingleMd, true);
  assert.equal(d.preferredConverter, "auto");
  const r = resolveIngestSettings({
    ingest: { confirmBeforeConvert: true, openQueueOnEnqueue: true },
  });
  assert.equal(r.confirmBeforeConvert, true);
  assert.equal(r.openQueueOnEnqueue, true);
});

test("clipBridge defaults downloadImages true; can disable", async () => {
  const { __settingsTest } = await import("../electron/settings.mjs");
  const d = __settingsTest.defaultClipBridgeSettings();
  assert.equal(d.downloadImages, true);
  const off = __settingsTest.normalizeClipBridgeSettings(
    { enabled: true, port: 19827, token: "x", downloadImages: false },
    d,
  );
  assert.equal(off.downloadImages, false);
  const on = __settingsTest.normalizeClipBridgeSettings(
    { enabled: true, port: 19827, token: "x" },
    d,
  );
  assert.equal(on.downloadImages, true);
});

test("ingest settings normalize confirmBeforeConvert", async () => {
  const { __settingsTest } = await import("../electron/settings.mjs");
  const n = __settingsTest.normalizeIngestSettings({
    confirmBeforeConvert: true,
    openQueueOnEnqueue: true,
  });
  assert.equal(n.confirmBeforeConvert, true);
  assert.equal(n.openQueueOnEnqueue, true);
  const d = __settingsTest.normalizeIngestSettings({});
  assert.equal(d.confirmBeforeConvert, false);
  assert.equal(d.preferredConverter, "auto");
  const named = __settingsTest.normalizeIngestSettings({ preferredConverter: "anydoc" });
  assert.equal(named.preferredConverter, "anydoc");
  const legacy = __settingsTest.normalizeIngestSettings({ preferExternalConverters: false });
  assert.equal(legacy.preferredConverter, "builtin");
});
