import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickLaunchWorkspaceCandidate,
  listLaunchCandidates,
  sameWorkspacePath,
  probeWorkspacePath,
  removeRecentWorkspace,
  touchRecentWorkspace,
  normalizeStoredWorkspaceHistory,
  isForbiddenWorkspaceRoot,
  classifyWorkspaceRoot,
} from "../electron/workspace-history.mjs";

// Synthetic fixtures (not real home paths) — avoid secrets-scan absolute-user-home
const DEF = "/tmp/mh-fixture/topmind-workspace";
const OTHER = "/tmp/mh-fixture/work-notes";

test("sameWorkspacePath normalizes equality", () => {
  assert.equal(sameWorkspacePath(DEF, DEF), true);
  assert.equal(sameWorkspacePath(DEF, OTHER), false);
  assert.equal(sameWorkspacePath(null, DEF), false);
});

test("pickLaunch: no recents and bare default → null (landing)", () => {
  const candidate = pickLaunchWorkspaceCandidate({
    settings: {
      workspaceRoot: DEF,
      workspaces: { recent: [] },
    },
    defaultUserWorkspaceRoot: DEF,
  });
  assert.equal(candidate, null);
});

test("listLaunchCandidates dedupes and orders", () => {
  const list = listLaunchCandidates({
    launchWorkspaceRoot: OTHER,
    settings: {
      workspaceRoot: DEF,
      workspaces: {
        recent: [
          { rootPath: DEF, lastOpenedAt: "2026-07-14T00:00:00.000Z" },
          { rootPath: OTHER, lastOpenedAt: "2026-07-15T00:00:00.000Z" },
        ],
      },
    },
    defaultUserWorkspaceRoot: DEF,
  });
  assert.equal(list[0], path.resolve(OTHER));
  assert.ok(list.every((p, i) => list.indexOf(p) === i));
});

test("pickLaunch: empty settings → null (landing)", () => {
  assert.equal(
    pickLaunchWorkspaceCandidate({
      settings: null,
      defaultUserWorkspaceRoot: DEF,
    }),
    null,
  );
});

test("pickLaunch: non-default persisted root without recents still opens", () => {
  const candidate = pickLaunchWorkspaceCandidate({
    settings: {
      workspaceRoot: OTHER,
      workspaces: { recent: [] },
    },
    defaultUserWorkspaceRoot: DEF,
  });
  assert.equal(candidate, path.resolve(OTHER));
});

test("pickLaunch: bare default only if also in recents", () => {
  const withRecent = pickLaunchWorkspaceCandidate({
    settings: {
      workspaceRoot: DEF,
      workspaces: {
        recent: [{ rootPath: DEF, lastOpenedAt: "2026-07-15T00:00:00.000Z" }],
      },
    },
    defaultUserWorkspaceRoot: DEF,
  });
  assert.equal(withRecent, path.resolve(DEF));

  const without = pickLaunchWorkspaceCandidate({
    settings: {
      workspaceRoot: DEF,
      workspaces: { recent: [] },
    },
    defaultUserWorkspaceRoot: DEF,
  });
  assert.equal(without, null);
});

test("pickLaunch: CLI path wins over recents", () => {
  const candidate = pickLaunchWorkspaceCandidate({
    launchWorkspaceRoot: OTHER,
    settings: {
      workspaceRoot: DEF,
      workspaces: {
        recent: [{ rootPath: DEF, lastOpenedAt: "2026-07-15T00:00:00.000Z" }],
      },
    },
    defaultUserWorkspaceRoot: DEF,
  });
  assert.equal(candidate, path.resolve(OTHER));
});

test("touchRecentWorkspace prepends and caps", () => {
  let s = { workspaceRoot: "", workspaces: { recent: [] } };
  s = touchRecentWorkspace(s, OTHER, "2026-07-15T12:00:00.000Z");
  s = touchRecentWorkspace(s, DEF, "2026-07-15T13:00:00.000Z");
  assert.equal(s.workspaceRoot, path.resolve(DEF));
  assert.equal(s.workspaces.recent[0].rootPath, path.resolve(DEF));
  assert.equal(s.workspaces.recent[1].rootPath, path.resolve(OTHER));
});

test("removeRecentWorkspace clears active when matched", () => {
  const s = {
    workspaceRoot: OTHER,
    workspaces: {
      recent: [
        { rootPath: OTHER, lastOpenedAt: "a" },
        { rootPath: DEF, lastOpenedAt: "b" },
      ],
    },
  };
  const next = removeRecentWorkspace(s, OTHER);
  assert.equal(next.workspaceRoot, "");
  assert.equal(next.workspaces.recent.length, 1);
  assert.equal(next.workspaces.recent[0].rootPath, path.resolve(DEF));
});

test("probeWorkspacePath detects missing vs directory", async () => {
  const missing = await probeWorkspacePath(path.join(os.tmpdir(), `mh-nope-${Date.now()}`));
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "missing");

  const dir = await mkdtemp(path.join(os.tmpdir(), "mh-ws-"));
  try {
    const ok = await probeWorkspacePath(dir);
    assert.equal(ok.ok, true);
    assert.equal(ok.hasCategoryShape, false);
    await mkdir(path.join(dir, "00-收件箱"));
    const shaped = await probeWorkspacePath(dir);
    assert.equal(shaped.hasCategoryShape, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizeStoredWorkspaceHistory prunes missing recents", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mh-alive-"));
  const ghost = path.join(os.tmpdir(), `mh-ghost-${Date.now()}`);
  try {
    await mkdir(path.join(dir, "00-收件箱"));
    const settings = {
      workspaceRoot: ghost,
      workspaces: {
        recent: [
          { rootPath: ghost, lastOpenedAt: "2026-07-15T00:00:00.000Z" },
          { rootPath: dir, lastOpenedAt: "2026-07-14T00:00:00.000Z" },
        ],
      },
    };
    const { settings: next, removed, changed } = await normalizeStoredWorkspaceHistory(settings, null, {
      pruneMissing: true,
    });
    assert.equal(changed, true);
    assert.ok(removed.some((r) => r.rootPath === path.resolve(ghost)));
    assert.equal(next.workspaces.recent.length, 1);
    // realpath may differ from resolve on macOS (/var → /private/var)
    assert.equal(next.workspaces.recent[0].rootPath, await realpath(dir));
    assert.equal(next.workspaceRoot, ""); // active was ghost
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalize keeps explicit user path (no detectUserWorkspaceRoot hijack)", async () => {
  // Empty dir without NN- categories must stay as the user's choice — never
  // rewrite onto a sibling default workspace via engine discovery.
  const dir = await mkdtemp(path.join(os.tmpdir(), "mh-user-ws-"));
  try {
    const settings = {
      workspaceRoot: dir,
      workspaces: {
        recent: [{ rootPath: dir, lastOpenedAt: "2026-07-20T00:00:00.000Z" }],
      },
    };
    const { settings: next } = await normalizeStoredWorkspaceHistory(settings, "/tmp/fake-engine", {
      pruneMissing: true,
    });
    const real = await realpath(dir);
    assert.equal(next.workspaceRoot, real);
    assert.equal(next.workspaces.recent[0].rootPath, real);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("touchRecentWorkspace dedupes slash variants", () => {
  let s = { workspaceRoot: "", workspaces: { recent: [] } };
  s = touchRecentWorkspace(s, `${OTHER}/`, "2026-07-15T12:00:00.000Z");
  s = touchRecentWorkspace(s, OTHER, "2026-07-15T13:00:00.000Z");
  assert.equal(s.workspaces.recent.length, 1);
  assert.equal(path.resolve(s.workspaces.recent[0].rootPath), path.resolve(OTHER));
});

test("listLaunchCandidates prefers newest active over older default recent", () => {
  const list = listLaunchCandidates({
    settings: {
      workspaceRoot: OTHER,
      workspaces: {
        recent: [
          { rootPath: OTHER, lastOpenedAt: "2026-07-20T12:00:00.000Z" },
          { rootPath: DEF, lastOpenedAt: "2026-07-19T12:00:00.000Z" },
        ],
      },
    },
    defaultUserWorkspaceRoot: DEF,
  });
  assert.equal(list[0], path.resolve(OTHER));
  assert.ok(list.includes(path.resolve(DEF)));
});

test("main initApp does not force-open default workspace", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const main = readFileSync(path.join(root, "electron/main.mjs"), "utf8");
  assert.doesNotMatch(main, /pickLaunchWorkspaceCandidate\([^)]*\)\s*\|\|\s*defRoot/);
  assert.match(main, /listLaunchCandidates/);
  assert.match(main, /pruneMissing/);
  assert.match(main, /createIfMissing:\s*false/);
  assert.match(main, /no-workspace/);
});


test("isForbiddenWorkspaceRoot rejects topmind-desktop package dir", async () => {
  const desktopPkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // This test file lives under topmind-desktop/tests → parent is package root
  assert.equal(await isForbiddenWorkspaceRoot(desktopPkg), true);
});

test("classifyWorkspaceRoot marks empty temp dir as empty+suitable", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mh-empty-ws-"));
  try {
    const c = await classifyWorkspaceRoot(dir);
    assert.equal(c.ok, true);
    assert.equal(c.kind, "empty");
    assert.equal(c.suitable, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
