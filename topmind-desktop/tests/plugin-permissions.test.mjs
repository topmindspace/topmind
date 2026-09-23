/**
 * Permission helpers — pure unit tests (mirror src/plugins/permissions.ts logic
 * is exercised via TypeScript build; this duplicates critical pure rules for node:test).
 *
 * We import the TS module via dynamic path is hard in node:test without tsx path alias.
 * Re-implement the contract checks here against the documented API by reading the file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load compiled? Prefer running through tsx which can import .ts
// file:// URL required — raw Windows absolute paths fail the ESM loader
const modUrl = pathToFileURL(
  path.join(__dirname, "../src/plugins/permissions.ts"),
).href;

test("permissions module exports and enforces RPC/slot rules", async () => {
  // tsx --test can import TypeScript
  const perm = await import(modUrl);
  assert.equal(perm.rpcPermissionForMethod("workspace.savePath"), "rpc:workspace");
  assert.equal(perm.rpcPermissionForMethod("system.listExternalPlugins"), "rpc:system");

  const minimal = perm.normalizePermissions([]);
  assert.deepEqual(minimal, ["slot:action"]);

  assert.equal(perm.hasPermission(null, "rpc:workspace"), true);
  assert.equal(perm.hasPermission(minimal, "rpc:workspace"), false);
  assert.equal(perm.hasPermission(["rpc:workspace"], "rpc:workspace"), true);
  assert.equal(perm.hasPermission(["rpc:*"], "rpc:ai"), true);
  assert.equal(perm.hasPermission(["slot:*"], "slot:view"), true);

  assert.throws(() => perm.assertRpcAllowed(minimal, "workspace.savePath"), /permission denied/i);
  assert.doesNotThrow(() => perm.assertRpcAllowed(["rpc:workspace"], "workspace.savePath"));
  assert.doesNotThrow(() => perm.assertRpcAllowed(null, "workspace.savePath"));

  const ok = perm.canRegisterSlotKind("action", minimal, ["action"]);
  assert.equal(ok.ok, true);
  const blocked = perm.canRegisterSlotKind("view", minimal, null);
  assert.equal(blocked.ok, false);
  const undeclared = perm.canRegisterSlotKind("action", ["slot:action"], ["sidebar"]);
  assert.equal(undeclared.ok, false);

  // Wildcard + declared slots matrix
  assert.equal(perm.canRegisterSlotKind("settings", ["slot:*"], null).ok, true);
  assert.equal(perm.canRegisterSlotKind("settings", ["slot:*"], ["view"]).ok, false);
  assert.equal(perm.canRegisterSlotKind("view", ["slot:view"], ["view", "action"]).ok, true);

  // Unknown permission tokens are retained (forward-compat) but do not grant access
  const weird = perm.normalizePermissions(["rpc:workspace", "custom:future"]);
  assert.ok(weird.includes("custom:future"));
  assert.doesNotThrow(() => perm.assertRpcAllowed(weird, "workspace.readPath"));
  assert.throws(() => perm.assertRpcAllowed(weird, "ai.invoke"), /permission denied/i);

  // Trust model: permissions are soft gates on ctx.rpc only — documented, not sandbox
  assert.ok(Array.isArray(perm.DEFAULT_EXTERNAL_PERMISSIONS));
  assert.ok(perm.KNOWN_PERMISSIONS.has("rpc:tool"));
  assert.ok(perm.KNOWN_PERMISSIONS.has("fs:read-workspace"));
});
