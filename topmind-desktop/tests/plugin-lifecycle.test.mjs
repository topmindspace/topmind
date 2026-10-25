import test from "node:test";
import assert from "node:assert/strict";

const backend = new Map();
globalThis.window = {
  topmind: {
    subscribe(event, fn) {
      const listeners = backend.get(event) || new Set();
      backend.set(event, listeners);
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async invoke() { return {}; },
  },
};
const host = await import("../src/plugins/host.ts");
const { useRegistry } = await import("../src/plugins/registry.ts");
const { usePluginStore } = await import("../src/stores/plugin-store.ts");

function plugin(id, activate, deactivate) {
  return { manifest: { id, name: id, version: "1.0.0" }, activate, deactivate };
}
const action = (id) => ({ id, kind: "action", label: id, run() {} });

test("disable releases slots, local events and RPC subscriptions exactly once", async () => {
  let ctx;
  let calls = 0;
  const p = plugin("test-lifecycle", (context) => {
    ctx = context;
    context.register(action("test-lifecycle.action"));
    context.events.on("test:local", () => calls++);
    const release = context.rpc.subscribe("test:rpc", () => calls++);
    release();
    release();
    context.rpc.subscribe("test:rpc", () => calls++);
  });
  await host.activatePlugin(p, "/test/workspace", "external");
  ctx.events.emit("test:local");
  for (const fn of backend.get("test:rpc")) fn();
  assert.equal(calls, 2);
  await host.deactivatePlugin(p.manifest.id);
  ctx.events.emit("test:local");
  for (const fn of backend.get("test:rpc")) fn();
  assert.equal(calls, 2, "disabled plugins must receive no more callbacks");
  assert.equal(backend.get("test:rpc").size, 0);
  assert.ok(!useRegistry.getState().actions.some((a) => a.id === "test-lifecycle.action"));
  // Even work retaining a stale context cannot leak registrations after disable.
  ctx.events.on("test:local", () => calls++);
  ctx.register(action("test-lifecycle.late"));
  ctx.events.emit("test:local");
  assert.equal(calls, 2);
  assert.ok(!useRegistry.getState().actions.some((a) => a.id === "test-lifecycle.late"));
});

test("failed activation rolls back partial resources and remains retryable", async (t) => {
  t.mock.method(console, "error", () => {});
  let ctx;
  let callbacks = 0;
  let cleanupCalls = 0;
  const p = plugin("test-failed", (context) => {
    ctx = context;
    context.register(action("test-failed.action"));
    context.events.on("test:failure", () => callbacks++);
    context.rpc.subscribe("test:failure", () => callbacks++);
    throw new Error("activation failed");
  }, () => { cleanupCalls++; });
  await host.activatePlugin(p, "/test/workspace", "external");
  ctx.events.emit("test:failure");
  assert.equal(callbacks, 0);
  assert.equal(cleanupCalls, 1);
  assert.equal(backend.get("test:failure").size, 0);
  assert.equal(host.isPluginActive(p.manifest.id), false);
  assert.equal(usePluginStore.getState().getPlugin(p.manifest.id).status, "error");
  assert.ok(!useRegistry.getState().actions.some((a) => a.id === "test-failed.action"));
  await host.activatePlugin(plugin(p.manifest.id, () => {}), "/test/workspace", "external");
  assert.equal(host.isPluginActive(p.manifest.id), true);
  await host.deactivatePlugin(p.manifest.id);
});

test("concurrent activation runs once and disable waits for it to settle", async () => {
  let release;
  let count = 0;
  const wait = new Promise((resolve) => { release = resolve; });
  const p = plugin("test-pending", async (ctx) => {
    count++;
    await wait;
    ctx.register(action("test-pending.action"));
  });
  const first = host.activatePlugin(p, "/test/workspace", "external");
  const second = host.activatePlugin(p, "/test/workspace", "external");
  const disable = host.deactivatePlugin(p.manifest.id);
  release();
  await Promise.all([first, second, disable]);
  assert.equal(count, 1);
  assert.equal(host.isPluginActive(p.manifest.id), false);
  assert.ok(!useRegistry.getState().actions.some((a) => a.id === "test-pending.action"));
});
