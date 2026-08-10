/**
 * RPC bridge validation — strict method shape, plain-object params,
 * prototype-chain lookup blocked (constructor / __proto__).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveRpcTarget } from "../electron/rpc-bridge.mjs";

const services = {
  workspace: {
    savePath(params) {
      return { ok: true, got: params };
    },
  },
};

test("valid method resolves fn and defaults params", () => {
  const { fn, params } = resolveRpcTarget(services, "workspace.savePath", undefined);
  assert.deepEqual(params, {});
  assert.equal(typeof fn, "function");
  assert.deepEqual(fn({ a: 1 }), { ok: true, got: { a: 1 } });
});

test("rejects malformed method shapes", () => {
  for (const m of ["", "nodot", "a.b.c", ".b", "a.", "a..b", "a.b-c", "a.b c", 42, null]) {
    assert.throws(() => resolveRpcTarget(services, m, {}), /Invalid RPC method/, String(m));
  }
});

test("rejects non-object params", () => {
  for (const p of ["x", [1, 2], 5, true]) {
    assert.throws(() => resolveRpcTarget(services, "workspace.savePath", p), /Invalid RPC params/);
  }
  // null / undefined are tolerated (defaulted to {})
  assert.doesNotThrow(() => resolveRpcTarget(services, "workspace.savePath", null));
});

test("unknown service / fn rejected", () => {
  assert.throws(() => resolveRpcTarget(services, "nope.savePath", {}), /Unknown RPC method/);
  assert.throws(() => resolveRpcTarget(services, "workspace.nope", {}), /Unknown RPC method/);
});

test("prototype chain lookups are blocked", () => {
  for (const m of ["workspace.constructor", "workspace.hasOwnProperty", "workspace.toString"]) {
    assert.throws(() => resolveRpcTarget(services, m, {}), /Unknown RPC method/, m);
  }
});
