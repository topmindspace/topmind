/**
 * Cross-platform helpers — path POSIX-ization, arch/sandbox/gpu policy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  toPosixPath,
  splitRelativeSegments,
  resolveUnderRoot,
  isArmArch,
  isLinux,
  shouldDisableSandbox,
  shouldDisableGpu,
  electronLaunchArgs,
  platformTag,
  applyChromiumCompatibilityFlags,
} from "../electron/lib/platform.mjs";
import { toWorkspaceRelativePath } from "../electron/lib/path-model.mjs";
import { sp } from "../electron/lib/workspace-helpers.mjs";
import { promises as fs } from "node:fs";
import os from "node:os";

test("toPosixPath normalizes backslashes", () => {
  assert.equal(toPosixPath("a\\b\\c.md"), "a/b/c.md");
  assert.equal(toPosixPath("a/b/c.md"), "a/b/c.md");
  assert.equal(toPosixPath(""), "");
});

test("splitRelativeSegments rejects traversal and absolute paths", () => {
  assert.deepEqual(splitRelativeSegments("20-研究/note.md"), ["20-研究", "note.md"]);
  assert.deepEqual(splitRelativeSegments("a\\b\\c"), ["a", "b", "c"]);
  assert.throws(() => splitRelativeSegments("../escape"), /traversal/i);
  assert.throws(() => splitRelativeSegments("foo/../bar"), /traversal/i);
  assert.throws(() => splitRelativeSegments("C:\\\\Windows"), /Absolute/i);
});

test("resolveUnderRoot joins under base with mixed separators", () => {
  const base = path.join(os.tmpdir(), "topmind-base");
  const resolved = resolveUnderRoot(base, "10-日常\\note.md");
  assert.equal(resolved, path.resolve(base, "10-日常", "note.md"));
});

test("isArmArch covers arm64 and arm", () => {
  assert.equal(isArmArch("arm64"), true);
  assert.equal(isArmArch("arm"), true);
  assert.equal(isArmArch("x64"), false);
});

test("shouldDisableSandbox respects env and platform", () => {
  assert.equal(shouldDisableSandbox({ ELECTRON_NO_SANDBOX: "1" }, "linux"), true);
  assert.equal(shouldDisableSandbox({ ELECTRON_NO_SANDBOX: "true" }, "darwin"), true);
  assert.equal(shouldDisableSandbox({}, "darwin"), false);
  // Without userns probe files, plain linux user → false unless env
  assert.equal(shouldDisableSandbox({ ELECTRON_NO_SANDBOX: "0" }, "linux"), false);
});

test("shouldDisableGpu defaults on for arm, respects force flags", () => {
  assert.equal(shouldDisableGpu({}, "arm64", "linux"), true);
  assert.equal(shouldDisableGpu({}, "arm64", "darwin"), true);
  assert.equal(shouldDisableGpu({ ELECTRON_DISABLE_GPU: "0" }, "arm64", "linux"), false);
  assert.equal(shouldDisableGpu({ ELECTRON_DISABLE_GPU: "1" }, "x64", "linux"), true);
  assert.equal(shouldDisableGpu({}, "x64", "linux"), false);
});

test("electronLaunchArgs emits matching chromium flags", () => {
  const armLinux = electronLaunchArgs(
    { ELECTRON_NO_SANDBOX: "1" },
    "arm64",
    "linux",
  );
  assert.ok(armLinux.includes("--no-sandbox"));
  assert.ok(armLinux.includes("--disable-gpu"));
  assert.ok(armLinux.some((a) => a.startsWith("--ozone-platform-hint=")));

  const macX64 = electronLaunchArgs({}, "x64", "darwin");
  assert.equal(macX64.includes("--no-sandbox"), false);
  assert.equal(macX64.includes("--disable-gpu"), false);
});

test("applyChromiumCompatibilityFlags is no-op without app.commandLine", () => {
  const report = applyChromiumCompatibilityFlags(null);
  assert.equal(report.sandbox, true);
  assert.equal(report.gpu, true);
});

test("applyChromiumCompatibilityFlags appends switches", () => {
  const switches = [];
  const fakeApp = {
    commandLine: {
      appendSwitch(name, value) {
        switches.push(value === undefined ? name : `${name}=${value}`);
      },
    },
  };
  const report = applyChromiumCompatibilityFlags(fakeApp, {
    env: { ELECTRON_NO_SANDBOX: "1", ELECTRON_DISABLE_GPU: "1" },
    platform: "linux",
    arch: "arm64",
  });
  assert.equal(report.sandbox, false);
  assert.equal(report.gpu, false);
  assert.ok(switches.includes("no-sandbox"));
  assert.ok(switches.includes("disable-gpu"));
  assert.ok(switches.some((s) => s.startsWith("ozone-platform-hint=")));
});

test("platformTag formats os-arch", () => {
  assert.equal(platformTag("linux", "arm64"), "linux-arm64");
  assert.equal(platformTag("darwin", "x64"), "darwin-x64");
});

test("toWorkspaceRelativePath always uses forward slashes", () => {
  const root = path.join(os.tmpdir(), "ws-rel-posix");
  const abs = path.join(root, "20-研究", "sub", "note.md");
  const rel = toWorkspaceRelativePath(
    { engineRoot: root, userWorkspaceRoot: root },
    abs,
  );
  assert.equal(rel, "20-研究/sub/note.md");
  assert.equal(rel.includes("\\"), false);
});

test("sp accepts backslash relative paths and stays inside root", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-sp-"));
  try {
    const ws = { engineRoot: tmp, userWorkspaceRoot: tmp };
    await fs.mkdir(path.join(tmp, "10-日常"), { recursive: true });
    const abs = await sp(ws, "10-日常\\hello.md");
    assert.equal(abs, path.resolve(tmp, "10-日常", "hello.md"));
    await assert.rejects(() => sp(ws, "../outside.md"), /traversal|outside/i);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("isLinux mirrors process.platform when not overridden", () => {
  assert.equal(isLinux("linux"), true);
  assert.equal(isLinux("darwin"), false);
  assert.equal(isLinux("win32"), false);
});
