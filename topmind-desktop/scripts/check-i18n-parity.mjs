#!/usr/bin/env node
/**
 * Check i18n key parity between zh-CN and en-US locale files.
 * Reports missing keys in either direction.
 */
import { readFileSync } from "fs";
import { join } from "path";

const localesDir = join(import.meta.dirname, "..", "src", "locales");
const namespaces = ["shell", "editor", "overlays", "ai", "settings", "workspace", "common", "ingest"];

function flatten(obj, prefix = "") {
  const keys = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      for (const sub of flatten(v, full)) keys.add(sub);
    } else {
      keys.add(full);
    }
  }
  return keys;
}

let hasMismatch = false;

for (const ns of namespaces) {
  try {
    const zh = JSON.parse(readFileSync(join(localesDir, "zh-CN", `${ns}.json`), "utf-8"));
    const en = JSON.parse(readFileSync(join(localesDir, "en-US", `${ns}.json`), "utf-8"));
    const zhKeys = flatten(zh);
    const enKeys = flatten(en);
    const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k)).sort();
    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k)).sort();
    if (missingInEn.length > 0 || missingInZh.length > 0) {
      hasMismatch = true;
      console.error(`\n=== ${ns} ===`);
      if (missingInEn.length > 0) {
        console.error(`  Missing in en-US (${missingInEn.length}):`);
        for (const k of missingInEn) console.error(`    - ${k}`);
      }
      if (missingInZh.length > 0) {
        console.error(`  Missing in zh-CN (${missingInZh.length}):`);
        for (const k of missingInZh) console.error(`    - ${k}`);
      }
    }
  } catch {
    // File not found, skip
  }
}

if (!hasMismatch) {
  console.log("✅ All i18n locale files have matching keys.");
} else {
  process.exit(1);
}
