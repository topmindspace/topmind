#!/usr/bin/env node
/**
 * Lightweight secret / PII scan for tracked source (no node_modules / dist / release).
 * Fail CI if high-confidence live secrets appear. Placeholders in tests/docs are allowlisted.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  "release",
  "resources",
  ".git",
  ".opencode",
  "coverage",
  ".codegraph",
]);

/** Patterns that almost never belong in git. */
const FORBIDDEN = [
  {
    id: "openai-live-key",
    re: /\bsk-(?:proj-|ant-)?[a-zA-Z0-9]{20,}\b/u,
    allow: [/placeholder/i, /sk-ant-\.\.\./, /sk-test\b/, /sk-ant-\.\.\./],
  },
  {
    id: "github-pat",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/u,
    allow: [],
  },
  {
    id: "aws-access-key",
    re: /\bAKIA[0-9A-Z]{16}\b/u,
    allow: [],
  },
  {
    id: "private-key-block",
    re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/u,
    allow: [],
  },
  {
    id: "xai-live-key",
    re: /\bxai-[A-Za-z0-9_]{20,}\b/u,
    allow: [/placeholder/i, /xai-\.\.\./, /example/i],
  },
  {
    id: "absolute-user-home",
    // accidental local absolute paths in docs/code (not /Users in generic examples)
    re: /\/Users\/[a-zA-Z0-9._-]+\/(?!Library)/u,
    allow: [
      /\/Users\/\{/, // templated
      /\/Users\/you\//,
      /\/Users\/username\//,
      /\/Users\/me\//, // test fixtures only
      /example\.com/,
      /path\/to\//,
    ],
  },
];

const TEXT_EXT = new Set([
  ".md",
  ".mjs",
  ".js",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
  ".yml",
  ".yaml",
  ".html",
  ".css",
  ".txt",
  ".sh",
]);

async function* walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name) || e.name.startsWith(".DS_")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (TEXT_EXT.has(ext) || e.name === "Dockerfile" || e.name === "LICENSE") yield full;
    }
  }
}

function isAllowed(line, allow) {
  return allow.some((re) => re.test(line));
}

async function main() {
  // Prefer git ls-files when available (only tracked)
  let files = [];
  const git = spawnSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  if (git.status === 0 && git.stdout.trim()) {
    files = git.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((rel) => path.join(repoRoot, rel))
      .filter((abs) => {
        const ext = path.extname(abs).toLowerCase();
        return TEXT_EXT.has(ext) || path.basename(abs) === "LICENSE";
      });
  } else {
    for await (const f of walk(repoRoot)) files.push(f);
  }

  const hits = [];
  for (const file of files) {
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue; // binary
    const rel = path.relative(repoRoot, file);
    const lines = text.split(/\n/u);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const rule of FORBIDDEN) {
        if (!rule.re.test(line)) continue;
        if (isAllowed(line, rule.allow) || isAllowed(rel, rule.allow)) continue;
        // Test fixtures using clearly fake prefixes
        if (rel.includes("tests/") && /sk-test|wrk-keep|wrk-xxxxxxxx/u.test(line)) continue;
        if (rel.includes("AiProviderPanel") && /placeholder/i.test(line)) continue;
        hits.push({ file: rel, line: i + 1, id: rule.id, snippet: line.trim().slice(0, 120) });
      }
    }
  }

  if (hits.length) {
    process.stderr.write(`[check-secrets] FAIL ${hits.length} hit(s)\n`);
    for (const h of hits.slice(0, 40)) {
      process.stderr.write(`  ${h.file}:${h.line} [${h.id}] ${h.snippet}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`[check-secrets] ok (${files.length} files scanned)\n`);
}

main().catch((e) => {
  process.stderr.write(`[check-secrets] ${e.stack || e}\n`);
  process.exit(1);
});
