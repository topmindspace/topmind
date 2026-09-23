import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CATEGORY_PATTERN as K_PATTERN,
  VALID_ROLES as K_ROLES,
  REQUIRED_ROLES as K_REQUIRED,
  SLOT_ROLE_HEURISTICS as K_HEURISTICS,
  ROLE_DIR_ALIASES as K_ALIASES,
  DELIVERY_SLOT_RE as K_DELIVERY,
} from "../lib/model-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP_MOD = path.join(ROOT, "topmind-desktop", "electron", "lib", "category-pattern.mjs");

test("Desktop category-pattern snapshot matches Kernel model-core (C7)", async () => {
  const d = await import(pathToFileURL(DESKTOP_MOD).href);

  assert.equal(String(d.CATEGORY_PATTERN), String(K_PATTERN));
  assert.deepEqual([...d.VALID_ROLES], [...K_ROLES]);
  assert.deepEqual([...d.REQUIRED_ROLES], [...K_REQUIRED]);
  assert.deepEqual({ ...d.SLOT_ROLE_HEURISTICS }, { ...K_HEURISTICS });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(d.ROLE_DIR_ALIASES).map(([k, v]) => [k, [...v]]),
    ),
    Object.fromEntries(
      Object.entries(K_ALIASES).map(([k, v]) => [k, [...v]]),
    ),
  );
  assert.equal(String(d.DELIVERY_SLOT_RE), String(K_DELIVERY));
});

test("Desktop path-model role roots use ROLE_DIR_ALIASES first entries", async () => {
  const d = await import(pathToFileURL(DESKTOP_MOD).href);
  assert.equal(d.ROLE_DIR_ALIASES.buffer[0], "00-Inbox");
  assert.equal(d.ROLE_DIR_ALIASES.delivery[0], "88-交付");
  assert.equal(d.ROLE_DIR_ALIASES.system[0], "99-归档");
  assert.ok(K_ALIASES.delivery.includes("88-Outputs"));
  assert.ok(K_ALIASES.delivery.includes("88-Delivery"));
});
