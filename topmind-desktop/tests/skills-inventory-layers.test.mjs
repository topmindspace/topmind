/**
 * Skills inventory layering lock (intentional progressive disclosure):
 *   Dock (5 primary) ⊂ Chat slash (7) ⊂ SLASH_TO_SKILL (10 incl. connectors).
 * Not a product inconsistency — surfaces expose different depth. This test
 * prevents silent drift between the three catalogs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SLASH_TO_SKILL } from "../electron/lib/skills-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Skills Dock ⊂ Chat slash ⊂ SLASH_TO_SKILL (layered disclosure)", () => {
  const dockSrc = readFileSync(path.join(root, "src/plugins/topmind-workspace/skills.ts"), "utf8");
  const chatSrc = readFileSync(path.join(root, "src/components/ai/ChatInput.tsx"), "utf8");

  // Dock ids (skill.* action slots map to pack skills by product name).
  const dockIds = new Set(
    [...dockSrc.matchAll(/id:\s*"skill\.([a-z]+)"/gu)].map((m) => `topmind-${m[1]}`),
  );
  // Chat slash skillIds.
  const slashIds = new Set(
    [...chatSrc.matchAll(/skillId:\s*"([^"]+)"/gu)].map((m) => m[1]),
  );
  const engineIds = new Set(Object.values(SLASH_TO_SKILL));
  const engineSlashCount = Object.keys(SLASH_TO_SKILL).length;

  assert.ok(dockIds.size >= 5, `dock expected ≥5 skills, got ${dockIds.size}`);
  assert.ok(slashIds.size >= 7, `slash expected ≥7 skills, got ${slashIds.size}`);
  assert.ok(engineSlashCount >= 10, `SLASH_TO_SKILL expected ≥10 keys, got ${engineSlashCount}`);

  for (const id of dockIds) {
    assert.ok(slashIds.has(id) || engineIds.has(id), `dock skill ${id} missing from slash/engine`);
  }
  for (const id of slashIds) {
    assert.ok(engineIds.has(id), `slash skill ${id} missing from SLASH_TO_SKILL`);
  }
  // Connectors live only on the engine slash map (not the default Chat UI).
  assert.ok(engineIds.has("topmind-weread"));
  assert.ok(engineIds.has("topmind-x"));
  // Router is reachable from both surfaces.
  assert.ok(slashIds.has("topmind"));
  assert.ok(engineIds.has("topmind"));
});
