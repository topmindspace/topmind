#!/usr/bin/env node
// Pure snapshots let Desktop prompts load without resolving an engine at module initialization.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshots = [
  ["agent-tool-catalog.mjs", "ai-tool-names.mjs"],
  ["agent-policy.mjs", "writeback-mode-copy.mjs"],
  ["agent-goal-protocol.mjs", "agent-goal-protocol.mjs"],
];
const check = process.argv.includes("--check");
for (const [canonicalName, snapshotName] of snapshots) {
  const canonical = fs.readFileSync(path.join(root, "lib", canonicalName), "utf8");
  const target = path.join(root, "topmind-desktop/electron/lib", snapshotName);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== canonical) {
      throw new Error(`Desktop ${snapshotName} drifted; run npm run sync:agent-contract`);
    }
  } else fs.writeFileSync(target, canonical);
}
console.log(`[agent-contract] ${snapshots.length} snapshots ${check ? "verified" : "updated"}`);
