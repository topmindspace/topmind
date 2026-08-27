/**
 * File-sink log rotation (electron/lib/writeback.mjs).
 * The packaged support log must stay bounded: size cap + rotating archives.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const electronLib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../electron/lib");
let writeback;
let tmpRoot;

before(async () => {
  writeback = await import(pathToFileURL(path.join(electronLib, "writeback.mjs")).href);
  tmpRoot = mkdtempSync(path.join(tmpdir(), "topmind-logrot-"));
});

after(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

function logPath(name = "main.log") {
  return path.join(tmpRoot, "logs", name);
}

function allLogFiles() {
  const dir = path.dirname(logPath());
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^main\.log(\.\d+)?$/.test(n)).sort();
}

test("file sink rotates at the size cap and bounds archived copies", () => {
  // Tiny cap + keep=2 → main.log + main.log.1 + main.log.2 at most.
  process.env.topmind_LOG_MAX_BYTES = "400";
  process.env.topmind_LOG_KEEP = "2";
  const attached = writeback.attachFileLogger(logPath());
  assert.equal(attached, logPath());

  for (let i = 0; i < 60; i++) {
    writeback.logInfo("test", `line-${i}`, { pad: "x".repeat(20) });
  }

  const files = allLogFiles();
  assert.ok(files.includes("main.log"), "active log exists");
  assert.ok(files.length <= 3, `rotation must bound file count, got ${files.join(", ")}`);
  assert.ok(files.includes("main.log.1"), "at least one archive after crossing the cap");
  for (const name of files) {
    assert.ok(statSync(path.join(path.dirname(logPath()), name)).size <= 400, `${name} within cap`);
  }
  // Rotation must preserve order: newest archive .1, and lines are intact JSONL.
  const first = readFileSync(logPath("main.log.1"), "utf8").trim().split("\n");
  for (const line of first) {
    assert.doesNotThrow(() => JSON.parse(line), "archived lines stay parseable JSONL");
  }
  const active = readFileSync(logPath(), "utf8").trim().split("\n");
  assert.ok(JSON.parse(active[active.length - 1]).msg.startsWith("line-"), "active log keeps recent lines");
});

test("oversized pre-existing log self-heals on next append", () => {
  const dir = path.dirname(logPath());
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Simulate a legacy unbounded log: already far over the cap.
  writeFileSync(logPath(), "x".repeat(2000), "utf8");
  writeback.attachFileLogger(logPath());
  writeback.logWarn("test", "after-upgrade");
  const files = allLogFiles();
  assert.ok(files.includes("main.log.1"), "legacy oversized log rotated away on first append");
  assert.ok(readFileSync(logPath(), "utf8").includes("after-upgrade"), "new line lands in fresh active log");
});

test("stderr-only mode (no attach) never creates files", () => {
  writeback.attachFileLogger(null);
  const before = allLogFiles().length;
  writeback.logError("test", "stderr only");
  assert.equal(allLogFiles().length, before, "no file writes without an attached sink");
});
