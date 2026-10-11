/**
 * anydoc sidecar resolve / install args — I/O injected at the edge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ANYDOC_NPM_SPEC,
  ANYDOC_SOURCE_RANK,
  buildNpmInstallArgs,
  installAnydocSidecar,
  listAnydocSidecarPaths,
  pickAnydocCandidate,
  preferredAnydocInstallCommand,
  resolveAnydocInvocation,
  runAnydocToMarkdown,
  sidecarLayout,
} from "../electron/lib/ingest/anydoc-sidecar.mjs";
import { isOutsideAsar } from "../electron/lib/ingest/runtime-paths.mjs";

test("source rank is user-data then PATH then bundled", () => {
  assert.deepEqual([...ANYDOC_SOURCE_RANK], ["user-data", "path", "bundled"]);
});

test("pickAnydocCandidate prefers user-data sidecar over bundled", () => {
  const picked = pickAnydocCandidate([
    { source: "bundled", exists: true, cmd: "/app/resources/anydoc/cli.js", argsPrefix: [] },
    { source: "user-data", exists: true, cmd: "node", argsPrefix: ["/data/converters/anydoc/cli.js"] },
    { source: "path", exists: true, cmd: "/usr/local/bin/anydoc", argsPrefix: [] },
  ]);
  assert.equal(picked.source, "user-data");
  assert.ok(picked.argsPrefix.some((a) => String(a).includes("converters")));
});

test("pickAnydocCandidate skips missing user-data and uses PATH", () => {
  const picked = pickAnydocCandidate([
    { source: "user-data", exists: false, cmd: "node" },
    { source: "path", exists: true, cmd: "/opt/homebrew/bin/anydoc", argsPrefix: [] },
    { source: "bundled", exists: true, cmd: "/app/anydoc", argsPrefix: [] },
  ]);
  assert.equal(picked.source, "path");
});

test("sidecar layout and npm install args write under userData prefix (not asar)", () => {
  const layout = sidecarLayout("/Users/me/Library/Application Support/topmind-desktop");
  assert.match(layout.root, /converters[/\\]anydoc$/);
  assert.match(layout.cliJs, /@firecrawl[/\\]anydoc[/\\]cli\.js$/);
  assert.ok(isOutsideAsar(layout.root));
  assert.ok(!isOutsideAsar("/App/Contents/Resources/app.asar/lib/x.mjs"));
  const args = buildNpmInstallArgs({ prefix: layout.root, spec: `${ANYDOC_NPM_SPEC}@latest` });
  assert.equal(args[0], "install");
  assert.ok(args.includes("--prefix"));
  assert.ok(args.includes(layout.root));
  assert.ok(args.some((a) => String(a).includes("@firecrawl/anydoc")));
});

test("preferred install command is npm global (no Python)", () => {
  const cmd = preferredAnydocInstallCommand();
  assert.match(cmd, /npm install -g @firecrawl\/anydoc/);
  assert.doesNotMatch(cmd, /pip|python|brew install anydoc/i);
});

test("resolveAnydocInvocation prefers a real user-data cli.js over a fake bundled copy", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tm-anydoc-res-"));
  try {
    const layout = sidecarLayout(tmp);
    await fs.mkdir(path.dirname(layout.cliJs), { recursive: true });
    await fs.writeFile(layout.cliJs, "#!/usr/bin/env node\nconsole.log('0.1.8');\n", "utf8");
    await fs.writeFile(layout.pkgJson, JSON.stringify({ name: "@firecrawl/anydoc", version: "0.1.8" }), "utf8");
    const bundled = path.join(tmp, "bundled");
    await fs.mkdir(bundled, { recursive: true });
    await fs.writeFile(path.join(bundled, "cli.js"), "bundled", "utf8");

    const inv = await resolveAnydocInvocation({
      userDataDir: tmp,
      bundledDir: bundled,
      existsSync,
      resolvePathBinary: async () => ({ cmd: "/usr/bin/anydoc", argsPrefix: [], display: "/usr/bin/anydoc" }),
      resolveNode: async () => ({ cmd: process.execPath, argsPrefix: [] }),
    });
    assert.ok(inv);
    assert.equal(inv.source, "user-data");
    assert.ok(inv.argsPrefix.includes(layout.cliJs));
    assert.equal(inv.version, "0.1.8");
    assert.ok(isOutsideAsar(inv.display));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("runAnydocToMarkdown does not pass --format docx for RTF kind on a .docx path", async () => {
  const captured = [];
  const r = await runAnydocToMarkdown("/tmp/misnamed.docx", {
    kind: "rtf",
    invocation: { cmd: "anydoc", argsPrefix: [], display: "anydoc", source: "path" },
    exec: async (cmd, args) => {
      captured.push({ cmd, args });
      return { ok: true, stdout: "# Hello RTF\n", stderr: "" };
    },
  });
  assert.equal(captured.length, 1);
  const args = captured[0].args;
  const fmtIdx = args.indexOf("--format");
  assert.ok(fmtIdx >= 0, "kind rtf should name rtf, not omit into ext-guess");
  assert.equal(args[fmtIdx + 1], "rtf");
  assert.ok(!args.includes("docx"));
  assert.match(r.markdown, /Hello RTF/);
});

test("runAnydocToMarkdown omits --format when only a .docx path is known (let anydoc sniff)", async () => {
  const captured = [];
  await runAnydocToMarkdown("/tmp/misnamed.docx", {
    invocation: { cmd: "anydoc", argsPrefix: [], display: "anydoc", source: "path" },
    exec: async (cmd, args) => {
      captured.push(args);
      return { ok: true, stdout: "sniffed\n", stderr: "" };
    },
  });
  assert.equal(captured.length, 1);
  assert.ok(!captured[0].includes("--format"), "wrong .docx ext must not force --format docx");
});

test("listAnydocSidecarPaths does not point at app.asar", () => {
  const paths = listAnydocSidecarPaths("/var/user-data", "/app/resources/anydoc");
  for (const item of paths) {
    assert.ok(isOutsideAsar(item.path) || item.source === "bundled");
    assert.ok(!String(item.path).includes(`${path.sep}app.asar${path.sep}`));
  }
});

test("installAnydocSidecar writes CLI under userData prefix and refuses asar", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tm-anydoc-install-"));
  try {
    const captured = [];
    const result = await installAnydocSidecar({
      userDataDir: tmp,
      spec: `${ANYDOC_NPM_SPEC}@0.0.0-test`,
      resolveNpm: async () => ({ cmd: "npm", argsPrefix: [] }),
      exec: async (cmd, args) => {
        captured.push({ cmd, args });
        const prefix = args[args.indexOf("--prefix") + 1];
        const layout = sidecarLayout(tmp);
        assert.equal(prefix, layout.root);
        await fs.mkdir(path.dirname(layout.cliJs), { recursive: true });
        await fs.writeFile(layout.cliJs, "#!/usr/bin/env node\n", "utf8");
        await fs.writeFile(layout.pkgJson, JSON.stringify({ name: ANYDOC_NPM_SPEC, version: "9.9.9" }), "utf8");
        return { ok: true, stdout: "ok", stderr: "" };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.version, "9.9.9");
    assert.equal(result.source, "user-data");
    assert.equal(result.outsideAsar, true);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].cmd, "npm");
    assert.ok(captured[0].args.includes("--prefix"));
    assert.ok(captured[0].args.some((a) => String(a).includes(ANYDOC_NPM_SPEC)));
    assert.ok(isOutsideAsar(result.path));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }

  await assert.rejects(
    () => installAnydocSidecar({ userDataDir: `/App/Contents/Resources/app.asar${path.sep}data` }),
    /asar/i,
  );
});
