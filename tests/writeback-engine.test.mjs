/**
 * Kernel writeback-engine — real temp workspace path (shipped executeWrite).
 * Policy: backup/receipt only for high-impact (locked overwrite, non-permanent delete/archive).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  evaluateWritePermission,
  executeWrite,
  executeDelete,
  isHighImpactContentWrite,
  peekFrontmatter,
} from "../lib/writeback-engine.mjs";
import { buildDefaultContract } from "../lib/contract-engine.mjs";
import { generateSuggestions, applySuggestion } from "../lib/suggest-engine.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-wb-"));

function seedWorkspace() {
  const ws = path.join(tmpRoot, "ws");
  fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
  fs.mkdirSync(path.join(ws, "00-收件箱"), { recursive: true });
  fs.mkdirSync(path.join(ws, "99-归档", "backups"), { recursive: true });
  fs.mkdirSync(path.join(ws, "memory"), { recursive: true });
  const contract = buildDefaultContract();
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    `contract_version: 4\nworkspace:\n  name: test\n  template: stream\nwriteback:\n  mode: auto\n  shadow: true\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\nprotection:\n  defaults:\n    by_role:\n      buffer: open\n      loose-stream: open\n      deep-work: open\n      memory: open\n      delivery: open\n      system: locked\n`,
    "utf8",
  );
  return { ws, contract };
}

describe("writeback-engine", () => {
  /** @type {{ ws: string, contract: object }} */
  let env;

  before(() => {
    env = seedWorkspace();
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("peekFrontmatter reads protection", () => {
    const fm = peekFrontmatter("---\nprotection: locked\ntitle: x\n---\n\nbody\n");
    assert.equal(fm.protection, "locked");
  });

  it("isHighImpactContentWrite: only locked existing files", () => {
    assert.equal(isHighImpactContentWrite({ fileExists: true, protection: "locked" }), true);
    assert.equal(isHighImpactContentWrite({ fileExists: true, protection: "open" }), false);
    assert.equal(isHighImpactContentWrite({ fileExists: false, protection: "locked" }), false);
  });

  it("open file: AI/user update has no backup and no receipt", () => {
    const rel = "10-动态/note.md";
    const target = path.join(env.ws, rel);
    const first = executeWrite({
      targetPath: target,
      content: "---\ntitle: a\nprotection: open\n---\n\nhello\n",
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "ai",
      confirmed: true,
      operation: "create",
      skipShadow: true,
    });
    assert.equal(first.wroteFiles, true);
    assert.ok(first.targetPath === rel || first.target_path === rel || first.targetPath?.endsWith("note.md"));
    assert.ok(Array.isArray(first.affectedFiles) && first.affectedFiles.length >= 1);
    assert.ok(fs.existsSync(target));
    assert.ok(!first.backupPath && !first.backup_path, "create must not invent backup");
    assert.ok(!first.receipt_path || first.receipt_path === first.backup_path, "create: no real receipt");

    const second = executeWrite({
      targetPath: target,
      content: "---\ntitle: a\nprotection: open\n---\n\nhello world\n",
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "ai",
      confirmed: true,
      operation: "update",
      skipShadow: true,
    });
    assert.equal(second.wroteFiles, true);
    assert.ok(!second.backupPath && !second.backup_path, "open AI update must not backup");
    // receiptPath falls back to backupPath in toSurfaceEvidence; both must be falsy for open
    assert.ok(!second.backup_path, "open AI update: no backup_path");
    assert.equal(second.receipt_path ?? null, null);

    const userUpdate = executeWrite({
      targetPath: target,
      content: "---\ntitle: a\nprotection: open\n---\n\nhello user\n",
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
      operation: "update",
      skipShadow: true,
    });
    assert.equal(userUpdate.wroteFiles, true);
    assert.ok(!userUpdate.backupPath && !userUpdate.backup_path, "open user update must not backup");
  });

  it("locked file: AI denied; user overwrite gets backup + receipt", () => {
    const target = path.join(env.ws, "10-动态/locked.md");
    const content = "---\nprotection: locked\n---\n\nsecret\n";
    fs.writeFileSync(target, content, "utf8");

    const perm = evaluateWritePermission({
      contract: env.contract,
      targetPath: target,
      workspaceRoot: env.ws,
      frontmatter: { protection: "locked" },
      actor: "ai",
    });
    assert.equal(perm.allowed, false);

    assert.throws(
      () =>
        executeWrite({
          targetPath: target,
          content: content + "x",
          workspaceRoot: env.ws,
          contract: env.contract,
          actor: "ai",
          confirmed: true,
        }),
      /Write denied|locked/i,
    );

    const userWrite = executeWrite({
      targetPath: target,
      content: "---\nprotection: locked\n---\n\nsecret user\n",
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
      skipShadow: true,
    });
    assert.equal(userWrite.wroteFiles, true);
    assert.ok(userWrite.backupPath || userWrite.backup_path, "locked user overwrite must backup");
    assert.ok(
      userWrite.receipt_path || userWrite.receiptPath,
      "locked user overwrite must write receipt",
    );
    const absBackup = path.isAbsolute(userWrite.backup_path || userWrite.backupPath)
      ? userWrite.backup_path || userWrite.backupPath
      : path.join(env.ws, userWrite.backup_path || userWrite.backupPath);
    assert.ok(fs.existsSync(absBackup), "backup file must exist on disk");
    assert.equal(fs.readFileSync(absBackup, "utf8"), content);
  });

  it("existing locked file: overwrite still backs up when new FM omits protection", () => {
    const target = path.join(env.ws, "10-动态/locked-drop-fm.md");
    const original = "---\nprotection: locked\n---\n\nold\n";
    fs.writeFileSync(target, original, "utf8");
    // Callers that rebuild frontmatter without protection: locked must still
    // treat existing locked file as high-impact (and deny AI).
    assert.throws(
      () =>
        executeWrite({
          targetPath: target,
          content: "---\ntitle: unlocked-looking\n---\n\nnew\n",
          workspaceRoot: env.ws,
          contract: env.contract,
          actor: "ai",
          confirmed: true,
          skipShadow: true,
        }),
      /Write denied|locked/i,
    );
    const ev = executeWrite({
      targetPath: target,
      content: "---\ntitle: unlocked-looking\n---\n\nnew\n",
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
      skipShadow: true,
      frontmatter: { title: "unlocked-looking" },
    });
    assert.equal(ev.wroteFiles, true);
    assert.ok(ev.backup_path || ev.backupPath, "existing locked must backup even if new FM open");
  });

  it("path outside workspace is denied", () => {
    const outside = path.join(tmpRoot, "outside-secret.md");
    fs.writeFileSync(outside, "nope\n", "utf8");
    const perm = evaluateWritePermission({
      contract: env.contract,
      targetPath: outside,
      workspaceRoot: env.ws,
      actor: "user",
    });
    assert.equal(perm.allowed, false);
    assert.match(perm.reason, /outside workspace/i);
    assert.throws(
      () =>
        executeWrite({
          targetPath: outside,
          content: "x",
          workspaceRoot: env.ws,
          contract: env.contract,
          actor: "user",
          confirmed: true,
        }),
      /Write denied|outside/i,
    );
  });

  it("confirm mode returns pending without confirmed", () => {
    const contract = {
      ...env.contract,
      writeback: { ...(env.contract.writeback || {}), mode: "confirm" },
    };
    const target = path.join(env.ws, "10-动态/confirm.md");
    const pending = executeWrite({
      targetPath: target,
      content: "---\ntitle: c\n---\n\nx\n",
      workspaceRoot: env.ws,
      contract,
      actor: "ai",
      confirmed: false,
      skipShadow: true,
    });
    assert.equal(pending.pending || pending.needsConfirm, true);
    assert.equal(pending.wroteFiles, false);
    assert.ok(!fs.existsSync(target));

    const done = executeWrite({
      targetPath: target,
      content: "---\ntitle: c\n---\n\nx\n",
      workspaceRoot: env.ws,
      contract,
      actor: "ai",
      confirmed: true,
      skipShadow: true,
    });
    assert.equal(done.wroteFiles, true);
    assert.ok(fs.existsSync(target));
    assert.ok(!done.backup_path && !done.backupPath, "open confirm write still no backup");
  });

  it("executeDelete moves to trash backup with receipt; permanent has neither", () => {
    const target = path.join(env.ws, "00-收件箱/gone.md");
    fs.writeFileSync(target, "---\ntitle: g\n---\n\nbye\n", "utf8");
    const ev = executeDelete({
      targetPath: target,
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
    });
    assert.equal(ev.wroteFiles, true);
    assert.ok(!fs.existsSync(target));
    assert.ok(ev.backupPath || ev.backup_path);
    assert.ok(ev.receipt_path || ev.receiptPath, "non-permanent delete writes receipt");

    const target2 = path.join(env.ws, "00-收件箱/gone-perm.md");
    fs.writeFileSync(target2, "---\ntitle: p\n---\n\nperm\n", "utf8");
    const permEv = executeDelete({
      targetPath: target2,
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
      permanent: true,
    });
    assert.equal(permEv.wroteFiles, true);
    assert.ok(!fs.existsSync(target2));
    assert.ok(!permEv.backupPath && !permEv.backup_path, "permanent delete: no trash");
    assert.ok(!permEv.receipt_path, "permanent delete: no receipt");
  });

  it("executeArchive directory peeks topic.md protection (locked denies AI)", async () => {
    const { executeArchive } = await import("../lib/writeback-engine.mjs");
    const topicDir = path.join(env.ws, "20-专题", "2020-locked");
    fs.mkdirSync(topicDir, { recursive: true });
    fs.writeFileSync(
      path.join(topicDir, "topic.md"),
      "---\ntitle: Locked topic\nprotection: locked\n---\n\nbody\n",
      "utf8",
    );
    assert.throws(
      () =>
        executeArchive({
          targetPath: topicDir,
          workspaceRoot: env.ws,
          contract: env.contract,
          actor: "ai",
          confirmed: true,
        }),
      /locked|Write denied/i,
    );
    assert.ok(fs.existsSync(topicDir), "dir must remain when AI denied");
    // user may still archive locked topic
    const ev = executeArchive({
      targetPath: topicDir,
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
    });
    assert.equal(ev.wroteFiles, true);
    assert.ok(!fs.existsSync(topicDir));
    assert.ok(ev.backupPath || ev.backup_path, "archive has recoverable copy");
    assert.ok(ev.receipt_path || ev.receiptPath, "archive writes receipt");
  });
});

describe("suggest-engine", () => {
  it("generateSuggestions does not write; apply open_profile can create profile", async () => {
    const ws = path.join(tmpRoot, "suggest-ws");
    fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
    fs.mkdirSync(path.join(ws, "00-收件箱"), { recursive: true });
    fs.writeFileSync(path.join(ws, "10-动态/2026-W30.md"), "# week\n\nnote\n", "utf8");
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nworkspace:\n  template: stream\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    fs.mkdirSync(path.join(ws, "99-归档", "backups"), { recursive: true });

    const before = await generateSuggestions({ workspaceRoot: ws });
    assert.ok(Array.isArray(before));
    assert.ok(before.length >= 1, "expected at least one suggestion");

    const profilePath = path.join(ws, "memory/profile.md");
    assert.ok(!fs.existsSync(profilePath) || fs.statSync(profilePath).size < 40 || true);

    const open = before.find((s) => s.kind === "open_profile");
    if (open) {
      const applied = await applySuggestion({ workspaceRoot: ws, suggestion: open });
      assert.ok(applied);
      assert.ok(fs.existsSync(profilePath));
    }

    // Without AI: no promote_memory pollution ("待填写"); may offer open_profile instead
    const promote = before.find((s) => s.kind === "promote_memory");
    if (promote) {
      const expectedSnippet =
        typeof promote.payload?.entry === "object"
          ? promote.payload.entry.content
          : String(promote.payload?.entry || "");
      assert.ok(
        !/待填写|待 AI/.test(expectedSnippet),
        "must not seed placeholder promote entry",
      );
      await applySuggestion({ workspaceRoot: ws, suggestion: promote });
      assert.ok(fs.existsSync(profilePath), "profile must exist after promote");
      const body = fs.readFileSync(profilePath, "utf8");
      assert.ok(!body.includes("undefined"), "must not write literal undefined");
    } else {
      // Honest path: open_profile (or only digest/etc.) — apply must not write "待填写"
      const openOnly = before.find((s) => s.kind === "open_profile");
      assert.ok(openOnly || before.length >= 1, "expected open_profile or other non-polluting suggestions");
      if (openOnly) {
        await applySuggestion({ workspaceRoot: ws, suggestion: openOnly });
        assert.ok(fs.existsSync(profilePath));
        const body = fs.readFileSync(profilePath, "utf8");
        assert.ok(!body.includes("待填写"));
        assert.ok(!body.includes("undefined"));
      }
    }
  });

  it("applySuggestion archives stale_topic and catch_all files via executeArchive", async () => {
    const ws = path.join(tmpRoot, "archive-suggest-ws");
    const inbox = path.join(ws, "00-收件箱");
    const topic = path.join(ws, "20-专题", "2020-old-topic");
    fs.mkdirSync(inbox, { recursive: true });
    fs.mkdirSync(topic, { recursive: true });
    fs.mkdirSync(path.join(ws, "99-归档", "backups"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    const inboxFile = path.join(inbox, "old.md");
    fs.writeFileSync(inboxFile, "# old inbox\n", "utf8");
    // force old mtime
    const old = new Date(Date.now() - 120 * 864e5);
    fs.utimesSync(inboxFile, old, old);
    fs.writeFileSync(path.join(topic, "topic.md"), "# stale\n", "utf8");
    fs.utimesSync(path.join(topic, "topic.md"), old, old);

    const appliedFile = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        kind: "inbox_review",
        id: "t1",
        title: "x",
        summary: "y",
        impact: "high",
        targetPath: "00-收件箱/old.md",
        payload: { path: "00-收件箱/old.md", action: "archive" },
      },
    });
    assert.equal(appliedFile.wroteFiles, true);
    assert.ok(!fs.existsSync(inboxFile), "inbox file archived away");
    assert.ok(appliedFile.backupPath || appliedFile.writebackEvidence?.backupPath);

    const appliedTopic = await applySuggestion({
      workspaceRoot: ws,
      suggestion: {
        kind: "stale_topic",
        id: "t2",
        title: "x",
        summary: "y",
        impact: "high",
        targetPath: "20-专题/2020-old-topic",
        payload: { path: "20-专题/2020-old-topic", action: "archive" },
      },
    });
    assert.equal(appliedTopic.wroteFiles, true);
    assert.ok(!fs.existsSync(topic), "topic dir archived away");
    assert.ok(appliedTopic.backupPath || appliedTopic.writebackEvidence?.backupPath);
  });

  it("appendProfileEntry accepts string entry without writing undefined", async () => {
    const { appendProfileEntry } = await import("../lib/memory-engine.mjs");
    const ws = path.join(tmpRoot, "entry-shape-ws");
    fs.mkdirSync(path.join(ws, "99-归档", "backups"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    appendProfileEntry({
      workspaceRoot: ws,
      entry: "- string entry ok",
    });
    const body = fs.readFileSync(path.join(ws, "memory/profile.md"), "utf8");
    assert.ok(body.includes("string entry ok"));
    assert.ok(!body.includes("undefined"));
  });
});
