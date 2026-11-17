import assert from "node:assert/strict";
import test from "node:test";
import { applyThemeSeed, DEFAULT_THEME_SEED } from "../src/lib/theme";

test("unset appearance uses olive and explicit legacy seeds still apply", (t) => {
  const attributes = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {
        setAttribute: (key: string, value: string) => attributes.set(key, value),
        removeAttribute: (key: string) => attributes.delete(key),
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  });

  assert.equal(DEFAULT_THEME_SEED, "olive");
  for (const seed of ["sky", "teal", "graphite"] as const) {
    applyThemeSeed(seed);
    assert.equal(attributes.get("data-theme-seed"), seed);
  }
  applyThemeSeed();
  assert.equal(attributes.has("data-theme-seed"), false);
  applyThemeSeed("sky");
  applyThemeSeed("olive");
  assert.equal(attributes.has("data-theme-seed"), false);
});
