/**
 * Host bin + external tool probe/install hints (no real pandoc/markitdown required).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";

import {
  buildAugmentedPath,
  extraBinDirs,
  pythonRunners,
  candidatePaths,
  quoteWinCmdArg,
  pickExecErrorDetail,
} from "../electron/lib/host-bin.mjs";
import {
  preferredInstallCommand,
  clearExternalToolsCache,
  probeExternalTools,
} from "../electron/lib/ingest/external-tools.mjs";

test("extraBinDirs returns existing-or-empty array for current platform", () => {
  const dirs = extraBinDirs();
  assert.ok(Array.isArray(dirs));
  for (const d of dirs) {
    assert.equal(typeof d, "string");
    assert.ok(d.length > 0);
  }
});

test("buildAugmentedPath includes process PATH segments", () => {
  const env = { ...process.env, PATH: `/tmp/fake-bin${path.delimiter}${process.env.PATH || ""}` };
  const p = buildAugmentedPath(env);
  assert.ok(p.includes("fake-bin") || p.includes(path.delimiter));
  assert.ok(typeof p === "string" && p.length > 0);
});

test("pythonRunners order is Windows-aware", () => {
  const win = pythonRunners("win32");
  assert.equal(win[0].cmd, "py");
  assert.deepEqual(win[0].prefix, ["-3"]);
  const nix = pythonRunners("linux");
  assert.equal(nix[0].cmd, "python3");
});

test("candidatePaths for pandoc on win32 includes Program Files style", () => {
  const paths = candidatePaths("pandoc", "win32");
  assert.ok(paths.some((p) => /pandoc/i.test(p)));
});

test("preferredInstallCommand: markitdown always uses [all] extras", async () => {
  clearExternalToolsCache();
  const md = preferredInstallCommand("markitdown");
  const pd = preferredInstallCommand("pandoc");
  assert.ok(md.length > 0);
  assert.ok(pd.length > 0);
  assert.match(md, /markitdown\[all\]/i, "must recommend [all] for PPTX/Office extras");
  if (process.platform === "win32") {
    assert.match(md, /pip/i);
    assert.ok(!md.startsWith("pipx"), "Windows preferred should be pip family");
    assert.match(md, /py -3 -m pip|python -m pip|pip install/i);
  } else {
    // macOS/Linux: pipx or pip, but always [all]
    assert.match(md, /pipx install|pip install|pip3 install|python3 -m pip/i);
  }
});

test("probeExternalTools returns install hints when tools missing", async () => {
  clearExternalToolsCache();
  const tools = await probeExternalTools({ force: true });
  assert.ok(tools.pandoc);
  assert.ok(tools.markitdown);
  assert.ok(Array.isArray(tools.pandoc.install?.commands));
  assert.ok(tools.pandoc.install.commands.length >= 1);
  assert.ok(Array.isArray(tools.markitdown.install?.commands));
  assert.ok(tools.markitdown.install.commands.length >= 1);
  assert.ok(typeof tools.checkedAt === "string");
  // available is boolean either way
  assert.equal(typeof tools.pandoc.available, "boolean");
  assert.equal(typeof tools.markitdown.available, "boolean");
});

test("probeExternalTools cache returns same checkedAt within TTL", async () => {
  clearExternalToolsCache();
  const a = await probeExternalTools({ force: true });
  const b = await probeExternalTools({ force: false });
  assert.equal(a.checkedAt, b.checkedAt);
});

test("home path used in extra dirs does not throw", () => {
  assert.ok(os.homedir());
  const dirs = extraBinDirs(process.platform, process.env);
  assert.ok(Array.isArray(dirs));
});

test("quoteWinCmdArg quotes spaces and escapes inner quotes", () => {
  assert.equal(quoteWinCmdArg("C:\\tools\\bin"), "C:\\tools\\bin");
  assert.equal(quoteWinCmdArg("C:\\Program Files\\a.cmd"), '"C:\\Program Files\\a.cmd"');
  assert.equal(quoteWinCmdArg('say "hi"'), '"say ""hi"""');
});

test("pickExecErrorDetail prefers exception lines over Command failed wrapper", () => {
  const detail = pickExecErrorDetail(
    "Command failed: markitdown x.pptx",
    "Traceback (most recent call last):\n  File foo\nFileConversionException: PptxConverter threw KeyError with message: \"missing\"\n",
    "",
  );
  assert.match(detail, /PptxConverter|FileConversionException|KeyError|missing/i);
  assert.ok(detail.length < 300);
});
