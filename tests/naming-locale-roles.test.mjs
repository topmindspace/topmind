/**
 * Live contract role names — English / renamed dirs, not Chinese literals.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  resolveArchivePlaneRel,
  resolveActivitySkipRootNames,
  resolveActivityWindow,
  executeArchive,
  findCategoryByRole,
  resolveWorkspaceModel,
  resolveSystemRoot,
} from "../lib/kernel-api.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "topmind-en-roles-"));

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function seedEnglishWorkspace() {
  const ws = path.join(tmpRoot, `ws-${Date.now()}`);
  fs.mkdirSync(path.join(ws, "00-Inbox"), { recursive: true });
  fs.mkdirSync(path.join(ws, "10-Stream"), { recursive: true });
  fs.mkdirSync(path.join(ws, "20-Topics"), { recursive: true });
  fs.mkdirSync(path.join(ws, "88-Outputs"), { recursive: true });
  fs.mkdirSync(path.join(ws, "99-Archive"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "topmind.yaml"),
    [
      "contract_version: 4",
      "workspace:",
      "  template: stream",
      "  locale: en-US",
      "  category_separator: \"-\"",
      "writeback:",
      "  mode: auto",
      "  backup_to: 99-归档/backups",
      "  receipts: 99-归档/receipts",
      "protection:",
      "  defaults:",
      "    by_role:",
      "      buffer: open",
      "      loose-stream: open",
      "      deep-work: open",
      "      delivery: open",
      "      system: locked",
      "",
    ].join("\n"),
    "utf8",
  );
  return ws;
}

describe("role-based naming (English dirs)", () => {
  it("resolveArchivePlaneRel uses 99-Archive not Chinese 99-归档", () => {
    const ws = seedEnglishWorkspace();
    const rel = resolveArchivePlaneRel(ws, {
      writeback: { backup_to: "99-归档/backups", receipts: "99-归档/receipts" },
    }, "backups");
    assert.match(rel, /^99-Archive\//);
    assert.doesNotMatch(rel, /99-归档/);
  });

  it("activity skip + window ignore English delivery/archive by role", () => {
    const ws = seedEnglishWorkspace();
    const now = Date.now();
    fs.writeFileSync(path.join(ws, "10-Stream", "2026-W01.md"), "# week\n\nnote\n", "utf8");
    fs.utimesSync(path.join(ws, "10-Stream", "2026-W01.md"), new Date(now), new Date(now));
    fs.writeFileSync(path.join(ws, "88-Outputs", "ship.md"), "# ship\n", "utf8");
    fs.utimesSync(path.join(ws, "88-Outputs", "ship.md"), new Date(now), new Date(now));
    fs.writeFileSync(path.join(ws, "99-Archive", "old.md"), "# old\n", "utf8");
    fs.utimesSync(path.join(ws, "99-Archive", "old.md"), new Date(now), new Date(now));

    const skip = resolveActivitySkipRootNames(ws, engineRoot);
    assert.ok(skip.has("88-Outputs") || skip.has("99-Archive") || /^(88|99)/.test("88-Outputs"));
    assert.ok(skip.has("88-Outputs"), `skip should include 88-Outputs, got ${[...skip].join(",")}`);
    assert.ok(skip.has("99-Archive"), `skip should include 99-Archive, got ${[...skip].join(",")}`);

    const win = resolveActivityWindow({
      workspaceRoot: ws,
      engineRoot,
      options: { windowDays: 2, maxFiles: 20, loadContent: false },
    });
    const rels = win.items.map((i) => i.relPath);
    assert.ok(rels.some((r) => r.includes("2026-W01")), `expected stream note, got ${rels.join(",")}`);
    assert.ok(!rels.some((r) => r.startsWith("88-Outputs/")), "delivery skipped by role");
    assert.ok(!rels.some((r) => r.startsWith("99-Archive/")), "archive skipped by role");
    assert.ok(!rels.some((r) => r.startsWith("99-归档/")));
    assert.ok(!rels.some((r) => r.startsWith("88-输出/")));
  });

  it("executeArchive of English inbox lands under 99-Archive not 99-归档", () => {
    const ws = seedEnglishWorkspace();
    const src = path.join(ws, "00-Inbox", "clip.md");
    fs.writeFileSync(src, "# clip\n", "utf8");
    const ev = executeArchive({
      targetPath: src,
      workspaceRoot: ws,
      actor: "user",
      confirmed: true,
    });
    assert.equal(ev.wroteFiles, true);
    assert.ok(!fs.existsSync(src));
    const dest = ev.backupPath || ev.backup_path;
    assert.ok(dest);
    const destAbs = path.isAbsolute(dest) ? dest : path.join(ws, dest);
    assert.ok(fs.existsSync(destAbs), "archived file exists");
    assert.match(destAbs.replace(/\\/g, "/"), /99-Archive/);
    assert.doesNotMatch(destAbs.replace(/\\/g, "/"), /99-归档/);
    assert.ok(!fs.existsSync(path.join(ws, "99-归档")), "must not invent Chinese archive dir");
  });

  it("resolveSystemRoot finds English and renamed slot dirs without inventing Chinese", () => {
    const ws = seedEnglishWorkspace();
    assert.equal(path.basename(resolveSystemRoot(ws, "buffer", { engineRoot })), "00-Inbox");
    assert.equal(path.basename(resolveSystemRoot(ws, "delivery", { engineRoot })), "88-Outputs");
    assert.equal(path.basename(resolveSystemRoot(ws, "system", { engineRoot })), "99-Archive");
    assert.ok(!fs.existsSync(path.join(ws, "00-收件箱")));
  });

  it("resolveWorkspaceModel assigns roles from English dir names", () => {
    const ws = seedEnglishWorkspace();
    const model = resolveWorkspaceModel({ workspaceRoot: ws, engineRoot });
    const sys = findCategoryByRole(model, "system");
    const delivery = findCategoryByRole(model, "delivery");
    const buffer = findCategoryByRole(model, "buffer");
    assert.equal(sys?.directory, "99-Archive");
    assert.equal(delivery?.directory, "88-Outputs");
    assert.equal(buffer?.directory, "00-Inbox");
  });
});
