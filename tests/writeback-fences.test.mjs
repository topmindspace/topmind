/**
 * Adversarial writeback fences (2026-09-17 review):
 * - archive plane destinations cannot escape the workspace
 * - contract / system plane / memory plane roots are not archiveable
 * - permanent directory archive refuses locked/core descendants
 * - AI cannot executeWrite the contract file
 * - isPathInsideWorkspace allows in-root names starting with ".."
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  isPathInsideWorkspace,
  resolveArchivePlaneRel,
  isProtectedContractFileName,
  normalizeProtectionLevel,
} from "../lib/model-core.mjs";
import {
  ensureContract,
  loadContract,
  writeContract,
  resolveProtection,
} from "../lib/contract-engine.mjs";
import {
  executeWrite,
  executeArchive,
  evaluateLifecycleTarget,
} from "../lib/writeback-engine.mjs";

/** @type {string} */
let ws;

before(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "tm-fence-"));
  ensureContract(ws);
  fs.mkdirSync(path.join(ws, "00-Inbox"), { recursive: true });
  fs.mkdirSync(path.join(ws, "99-归档"), { recursive: true });
  fs.mkdirSync(path.join(ws, "memory"), { recursive: true });
});

after(() => {
  try {
    fs.rmSync(ws, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("isPathInsideWorkspace edge names", () => {
  it("allows an in-root file named ..foo (not a parent hop)", () => {
    const p = path.join(ws, "..foo.md");
    assert.equal(isPathInsideWorkspace(ws, p), true);
  });

  it("still rejects a real parent path", () => {
    const p = path.join(ws, "..", "outside.md");
    assert.equal(isPathInsideWorkspace(ws, p), false);
  });

  it("denies a dangling symlink whose target is outside the workspace", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-sym-out-"));
    try {
      const link = path.join(ws, "00-Inbox", "dangling-out.md");
      fs.rmSync(link, { force: true });
      fs.symlinkSync(path.join(outsideDir, "pwn.md"), link);
      assert.equal(isPathInsideWorkspace(ws, link), false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("allows a dangling symlink whose target is still inside the workspace", () => {
    const link = path.join(ws, "00-Inbox", "dangling-in.md");
    fs.rmSync(link, { force: true });
    fs.symlinkSync(path.join(ws, "00-Inbox", "not-yet.md"), link);
    assert.equal(isPathInsideWorkspace(ws, link), true);
  });

  it("still denies a live symlink to an existing outside file", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-sym-live-"));
    try {
      const real = path.join(outsideDir, "real.md");
      fs.writeFileSync(real, "x");
      const link = path.join(ws, "00-Inbox", "live-out.md");
      fs.rmSync(link, { force: true });
      fs.symlinkSync(real, link);
      assert.equal(isPathInsideWorkspace(ws, link), false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("resolveArchivePlaneRel containment", () => {
  it("rejects configured backup_to with .. segments", () => {
    const contract = loadContract(ws);
    contract.writeback = { ...(contract.writeback || {}), backup_to: "../outside/backups" };
    const rel = resolveArchivePlaneRel(ws, contract, "backups");
    assert.ok(!String(rel).startsWith(".."), `expected no escape, got ${rel}`);
    assert.ok(isPathInsideWorkspace(ws, path.join(ws, rel)));
  });

  it("rejects absolute-style / 99-归档/../.. configs", () => {
    const contract = loadContract(ws);
    contract.writeback = { ...(contract.writeback || {}), backup_to: "99-归档/../../tmp/backups" };
    const rel = resolveArchivePlaneRel(ws, contract, "backups");
    assert.ok(!String(rel).includes(".."), `expected no .. in ${rel}`);
  });

  it("keeps a safe configured path under the workspace", () => {
    const contract = loadContract(ws);
    contract.writeback = { ...(contract.writeback || {}), backup_to: "99-归档/backups" };
    const rel = resolveArchivePlaneRel(ws, contract, "backups");
    assert.equal(rel, "99-归档/backups");
  });
});

describe("evaluateLifecycleTarget fences", () => {
  it("denies archiving the system plane root", () => {
    const r = evaluateLifecycleTarget({
      workspaceRoot: ws,
      targetPath: path.join(ws, "99-归档"),
    });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /system archive plane/i);
  });

  it("denies archiving system safety leaves (backups/trash/stream-archive)", () => {
    for (const leaf of ["backups", "trash", "receipts", "stream-archive"]) {
      const p = path.join(ws, "99-归档", leaf);
      fs.mkdirSync(p, { recursive: true });
      const r = evaluateLifecycleTarget({ workspaceRoot: ws, targetPath: p });
      assert.equal(r.allowed, false, `expected deny for ${leaf}`);
      assert.match(r.reason, /safety path/i);
    }
  });

  it("denies archiving the contract file", () => {
    const r = evaluateLifecycleTarget({
      workspaceRoot: ws,
      targetPath: path.join(ws, "topmind.yaml"),
    });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /writeContract/i);
  });

  it("denies archiving the memory plane root", () => {
    const r = evaluateLifecycleTarget({
      workspaceRoot: ws,
      targetPath: path.join(ws, "memory"),
    });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /memory plane/i);
  });

  it("allows ordinary content under a category", () => {
    fs.writeFileSync(path.join(ws, "00-Inbox", "ok.md"), "hello\n");
    const r = evaluateLifecycleTarget({
      workspaceRoot: ws,
      targetPath: path.join(ws, "00-Inbox", "ok.md"),
    });
    assert.equal(r.allowed, true);
  });
});

describe("executeArchive hard fences", () => {
  it("throws instead of removing topmind.yaml", () => {
    assert.throws(
      () =>
        executeArchive({
          targetPath: path.join(ws, "topmind.yaml"),
          workspaceRoot: ws,
          actor: "user",
          confirmed: true,
        }),
      /Archive denied/i,
    );
    assert.ok(fs.existsSync(path.join(ws, "topmind.yaml")));
  });

  it("throws instead of removing the memory plane root", () => {
    assert.throws(
      () =>
        executeArchive({
          targetPath: path.join(ws, "memory"),
          workspaceRoot: ws,
          actor: "user",
          confirmed: true,
        }),
      /Archive denied/i,
    );
    assert.ok(fs.existsSync(path.join(ws, "memory")));
  });

  it("permanent directory archive refuses when a locked descendant exists", () => {
    const topic = path.join(ws, "20-专题", "2026-adv");
    fs.mkdirSync(topic, { recursive: true });
    fs.writeFileSync(path.join(topic, "topic.md"), "# open guard\n");
    fs.writeFileSync(
      path.join(topic, "locked-note.md"),
      "---\nprotection: locked\n---\nsecret\n",
    );
    assert.throws(
      () =>
        executeArchive({
          targetPath: topic,
          workspaceRoot: ws,
          actor: "user",
          confirmed: true,
          permanent: true,
        }),
      /Permanent archive denied/i,
    );
    assert.ok(fs.existsSync(path.join(topic, "locked-note.md")));
  });
});

describe("contract file protection", () => {
  it("resolveProtection treats topmind.yaml as locked", () => {
    assert.equal(resolveProtection(loadContract(ws), "topmind.yaml"), "locked");
  });

  it("neither AI nor user can overwrite topmind.yaml via executeWrite", () => {
    assert.throws(
      () =>
        executeWrite({
          targetPath: path.join(ws, "topmind.yaml"),
          content: "---\ncontract_version: 4\n---\n",
          workspaceRoot: ws,
          actor: "ai",
        }),
      /writeContract/i,
    );
    assert.throws(
      () =>
        executeWrite({
          targetPath: path.join(ws, "topmind.yaml"),
          content: "---\ncontract_version: 4\n---\n",
          workspaceRoot: ws,
          actor: "user",
          confirmed: true,
        }),
      /writeContract/i,
    );
  });

  it("writeContract still serializes the contract (single writer)", () => {
    const p = writeContract(ws, {
      ...loadContract(ws),
      workspace: { ...(loadContract(ws).workspace || {}), name: "fence-test" },
    });
    assert.ok(fs.existsSync(p));
    assert.equal(loadContract(ws)?.workspace?.name, "fence-test");
  });
});

describe("case-insensitive policy names", () => {
  it("isProtectedContractFileName matches any casing", () => {
    assert.equal(isProtectedContractFileName("topmind.yaml"), true);
    assert.equal(isProtectedContractFileName("Topmind.yaml"), true);
    assert.equal(isProtectedContractFileName("TOPMIND.YAML"), true);
    assert.equal(isProtectedContractFileName(".topmind-config.json"), true);
    assert.equal(isProtectedContractFileName(".TopMind-Config.JSON"), true);
    assert.equal(isProtectedContractFileName("note.md"), false);
  });

  it("executeWrite denies case-variant contract basename", () => {
    // On case-sensitive Linux this may create a new file — the fence must still deny.
    assert.throws(
      () =>
        executeWrite({
          targetPath: path.join(ws, "Topmind.yaml"),
          content: "---\ncontract_version: 4\n---\n",
          workspaceRoot: ws,
          actor: "ai",
        }),
      /writeContract/i,
    );
  });

  it("evaluateLifecycleTarget denies case-variant memory plane root", () => {
    const r = evaluateLifecycleTarget({
      workspaceRoot: ws,
      targetPath: path.join(ws, "Memory"),
    });
    assert.equal(r.allowed, false);
    assert.match(r.reason, /memory plane/i);
  });

  it("normalizeProtectionLevel treats Locked as locked", () => {
    assert.equal(normalizeProtectionLevel("Locked"), "locked");
    assert.equal(normalizeProtectionLevel("LOCKED"), "locked");
    assert.equal(normalizeProtectionLevel("open"), "open");
    assert.equal(normalizeProtectionLevel(undefined), null);
  });
});

describe("backup_to under a content category", () => {
  it("does not freeze ordinary inbox lifecycle when backup_to is under Inbox", () => {
    const contract = loadContract(ws);
    contract.writeback = {
      ...(contract.writeback || {}),
      backup_to: "00-Inbox/backups",
    };
    // Content file under Inbox must remain archiveable
    fs.mkdirSync(path.join(ws, "00-Inbox"), { recursive: true });
    fs.writeFileSync(path.join(ws, "00-Inbox", "inbox-note.md"), "# hi\n");
    const r = evaluateLifecycleTarget({
      workspaceRoot: ws,
      targetPath: path.join(ws, "00-Inbox", "inbox-note.md"),
      contract,
    });
    assert.equal(r.allowed, true, r.reason);
    // The backup tree itself stays fenced
    const b = evaluateLifecycleTarget({
      workspaceRoot: ws,
      targetPath: path.join(ws, "00-Inbox", "backups"),
      contract,
    });
    assert.equal(b.allowed, false);
  });
});

describe("executeArchive writebackModeOverride", () => {
  it("pending under confirm override even when contract is auto", () => {
    const note = path.join(ws, "00-Inbox", "confirm-archive.md");
    fs.writeFileSync(note, "# open\n");
    const ev = executeArchive({
      targetPath: note,
      workspaceRoot: ws,
      actor: "ai",
      confirmed: false,
      writebackModeOverride: "confirm",
    });
    assert.equal(ev.pending, true);
    assert.ok(fs.existsSync(note), "note must remain when pending");
  });
});
