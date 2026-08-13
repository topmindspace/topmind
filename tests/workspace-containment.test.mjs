/**
 * Workspace containment — shipped write gate + outside-read helper.
 * Drives evaluateWritePermission / executeWrite / evaluateOutsideRead.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  evaluateWritePermission,
  executeWrite,
  isPathInsideWorkspace,
  evaluateOutsideRead,
} from "../lib/kernel-api.mjs";
import { buildDefaultContract } from "../lib/contract-engine.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-contain-"));

describe("workspace containment", () => {
  /** @type {{ ws: string, contract: object }} */
  let env;

  before(() => {
    const ws = path.join(tmpRoot, "ws");
    fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
    const contract = buildDefaultContract();
    fs.writeFileSync(
      path.join(ws, "topmind.yaml"),
      "contract_version: 4\nworkspace:\n  template: stream\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    env = { ws, contract };
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("denies ../ and sibling-prefix escapes; in-root write succeeds", () => {
    const secret = path.join(tmpRoot, "secret.md");
    fs.writeFileSync(secret, "secret\n", "utf8");
    const siblingPrefix = `${env.ws}-evil`;
    fs.mkdirSync(siblingPrefix, { recursive: true });
    const prefixFile = path.join(siblingPrefix, "leak.md");

    const viaParent = evaluateWritePermission({
      contract: env.contract,
      targetPath: path.join(env.ws, "..", "secret.md"),
      workspaceRoot: env.ws,
      actor: "user",
    });
    assert.equal(viaParent.allowed, false);
    assert.match(viaParent.reason, /outside workspace/i);

    const viaAbs = evaluateWritePermission({
      contract: env.contract,
      targetPath: secret,
      workspaceRoot: env.ws,
      actor: "user",
    });
    assert.equal(viaAbs.allowed, false);

    const viaPrefix = evaluateWritePermission({
      contract: env.contract,
      targetPath: prefixFile,
      workspaceRoot: env.ws,
      actor: "user",
    });
    assert.equal(viaPrefix.allowed, false, "startsWith prefix must not pass");

    assert.equal(isPathInsideWorkspace(env.ws, secret), false);
    assert.equal(isPathInsideWorkspace(env.ws, prefixFile), false);

    const inside = path.join(env.ws, "10-动态", "ok.md");
    const ev = executeWrite({
      targetPath: inside,
      content: "---\ntitle: ok\n---\n\nhello\n",
      workspaceRoot: env.ws,
      contract: env.contract,
      actor: "user",
      confirmed: true,
      skipShadow: true,
    });
    assert.equal(ev.wroteFiles, true);
    assert.ok(fs.existsSync(inside));
    assert.ok(!fs.existsSync(prefixFile), "must not create sibling-prefix file");
    assert.equal(fs.readFileSync(secret, "utf8"), "secret\n");
  });

  it("denies HOME-outside write; no file appears off-root", () => {
    const homeFile = path.join(os.homedir(), `topmind-contain-probe-${Date.now()}.md`);
    try {
      const perm = evaluateWritePermission({
        contract: env.contract,
        targetPath: homeFile,
        workspaceRoot: env.ws,
        actor: "user",
      });
      assert.equal(perm.allowed, false);
      assert.throws(
        () =>
          executeWrite({
            targetPath: homeFile,
            content: "leak\n",
            workspaceRoot: env.ws,
            contract: env.contract,
            actor: "user",
            confirmed: true,
            skipShadow: true,
          }),
        /Write denied|outside/i,
      );
      assert.ok(!fs.existsSync(homeFile), "must not write under $HOME outside workspace");
    } finally {
      fs.rmSync(homeFile, { force: true });
    }
  });

  it("evaluateOutsideRead denies local out-of-root until authorized", () => {
    const outside = path.join(tmpRoot, "notes.md");
    fs.writeFileSync(outside, "x\n", "utf8");
    const denied = evaluateOutsideRead({
      workspaceRoot: env.ws,
      targetPath: outside,
    });
    assert.equal(denied.allowed, false);
    assert.equal(denied.needsConfirm, true);

    const ok = evaluateOutsideRead({
      workspaceRoot: env.ws,
      targetPath: outside,
      authorized: true,
    });
    assert.equal(ok.allowed, true);

    const inside = evaluateOutsideRead({
      workspaceRoot: env.ws,
      targetPath: path.join(env.ws, "10-动态", "ok.md"),
    });
    assert.equal(inside.allowed, true);
    assert.equal(inside.needsConfirm, false);
  });
});
