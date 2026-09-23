/**
 * Desktop path fence must match Kernel isPathInsideWorkspace:
 * - dangling symlink to outside is denied
 * - live symlink to outside is denied
 * - in-root name `..foo.md` is allowed (not a parent hop)
 * - real parent hop is denied
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const electronLib = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../electron/lib",
);

/** @type {{ assertPathWithin: Function }} */
let pathSafety;
/** @type {string} */
let ws;
/** @type {string} */
let outside;

before(async () => {
  pathSafety = await import(pathToFileURL(path.join(electronLib, "path-safety.mjs")).href);
  ws = mkdtempSync(path.join(tmpdir(), "tm-desktop-fence-"));
  outside = mkdtempSync(path.join(tmpdir(), "tm-desktop-out-"));
  mkdirSync(path.join(ws, "00-Inbox"), { recursive: true });
});

after(() => {
  rmSync(ws, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("denies a dangling symlink whose target is outside the workspace", async () => {
  const link = path.join(ws, "00-Inbox", "dangling-out.md");
  symlinkSync(path.join(outside, "pwn.md"), link);
  await assert.rejects(
    () => pathSafety.assertPathWithin(ws, link, { allowMissing: true }),
    /outside allowed workspace boundary/i,
  );
});

test("allows a dangling symlink whose target is still inside the workspace", async () => {
  const link = path.join(ws, "00-Inbox", "dangling-in.md");
  symlinkSync(path.join(ws, "00-Inbox", "not-yet.md"), link);
  const resolved = await pathSafety.assertPathWithin(ws, link, { allowMissing: true });
  assert.ok(String(resolved).includes("not-yet.md"));
});

test("denies a live symlink to an existing outside file", async () => {
  const real = path.join(outside, "real.md");
  writeFileSync(real, "x");
  const live = path.join(ws, "00-Inbox", "live-out.md");
  symlinkSync(real, live);
  await assert.rejects(
    () => pathSafety.assertPathWithin(ws, live, { allowMissing: true }),
    /outside allowed workspace boundary/i,
  );
});

test("allows an in-root file named ..foo.md (not a parent hop)", async () => {
  const p = path.join(ws, "..foo.md");
  writeFileSync(p, "x");
  await pathSafety.assertPathWithin(ws, p, { allowMissing: true });
});

test("still rejects a real parent path", async () => {
  const p = path.join(ws, "..", "outside.md");
  await assert.rejects(
    () => pathSafety.assertPathWithin(ws, p, { allowMissing: true }),
    /outside allowed workspace boundary/i,
  );
});
