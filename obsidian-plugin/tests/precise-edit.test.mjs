/**
 * Obsidian Kernel-backed read + unique-span edit (shipped kernel-workspace-ops).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const pluginSrc = path.join(__dirname, "..", "src");

async function importShipped(rel) {
  return import(pathToFileURL(path.join(pluginSrc, rel)).href);
}

function largeBody() {
  const lines = [];
  for (let i = 1; i <= 800; i++) {
    if (i === 450) {
      lines.push("UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.");
    } else {
      lines.push(
        `Padding line ${i} with enough characters so the default 400-line window plus a 14k summary cannot see the middle of this note.`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

describe("Obsidian chat locale + tool guide", () => {
  test("resolveChatPromptLocale matches Desktop en* → en else zh", async () => {
    const ops = await importShipped("services/kernel-workspace-ops.ts");
    assert.equal(ops.resolveChatPromptLocale("en-US"), "en");
    assert.equal(ops.resolveChatPromptLocale("en"), "en");
    assert.equal(ops.resolveChatPromptLocale("zh-CN"), "zh");
    assert.equal(ops.resolveChatPromptLocale("fr-FR"), "zh");
    assert.equal(ops.resolveChatPromptLocale(""), "zh");
    assert.equal(ops.resolveChatPromptLocale(null), "zh");
  });

  test("buildObsidianChatToolGuide has unique-span + writeback + protection; no Model A", async () => {
    const ops = await importShipped("services/kernel-workspace-ops.ts");
    for (const loc of ["zh-CN", "en-US"]) {
      for (const mode of ["auto", "confirm"]) {
        const guide = ops.buildObsidianChatToolGuide(loc, mode);
        assert.match(guide, /read_file/);
        assert.match(guide, /edit_file/);
        assert.match(guide, /unique-span|唯一片段|先精确再容忍/i);
        assert.doesNotMatch(guide, /must match file content exactly|必须精确匹配文件内容/);
        assert.doesNotMatch(guide, /no write tools|不注册写工具|只读草稿/);
        assert.match(guide, /protection outranks|保护级别优先/);
        if (mode === "confirm") {
          assert.match(guide, /ask before save|保存前问我|pending|待确认/);
        } else {
          assert.match(guide, /auto-save|自动保存/);
        }
      }
    }
  });
});

describe("Obsidian precise edit / read window", () => {
  let tmp;
  let kernel;
  let readWorkspaceWindow;
  let preciseEditWorkspace;
  let runWorkspaceChatTurn;

  before(async () => {
    kernel = await import(pathToFileURL(path.join(repoRoot, "lib", "kernel-api.mjs")).href);
    const ops = await importShipped("services/kernel-workspace-ops.ts");
    readWorkspaceWindow = ops.readWorkspaceWindow;
    preciseEditWorkspace = ops.preciseEditWorkspace;
    runWorkspaceChatTurn = ops.runWorkspaceChatTurn;
  });

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tm-obs-edit-"));
    fs.writeFileSync(
      path.join(tmp, "topmind.yaml"),
      "contract_version: 4\nwriteback:\n  mode: auto\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
      "utf8",
    );
    fs.mkdirSync(path.join(tmp, "20-专题", "2026-中段"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "99-归档", "backups"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "20-专题", "2026-中段", "long.md"),
      largeBody(),
      "utf8",
    );
  });

  after(() => {
    if (tmp && fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("readWorkspaceWindow around= shows numbered mid-file span", () => {
    const r = readWorkspaceWindow(kernel, tmp, {
      relativePath: "20-专题/2026-中段/long.md",
      around: "UNIQUE_MIDDLE_PARAGRAPH_TARGET",
      contextLines: 3,
    });
    assert.equal(r.ok, true, r.error);
    assert.match(r.window.numbered, /450\|UNIQUE_MIDDLE_PARAGRAPH_TARGET/);
    assert.ok(r.window.startLine > 400);
  });

  test("preciseEditWorkspace exact unique middle + writeback", () => {
    const rel = "20-专题/2026-中段/long.md";
    const ev = preciseEditWorkspace(kernel, tmp, {
      relativePath: rel,
      oldText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.",
      newText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the revised middle thought.",
      actor: "ai",
      confirmed: true,
      writebackMode: "auto",
    });
    assert.equal(ev.ok, true, ev.diagnostic || ev.error);
    assert.equal(ev.replacements, 1);
    const next = fs.readFileSync(path.join(tmp, rel), "utf8");
    assert.match(next, /revised middle thought/);
    assert.doesNotMatch(next, /original middle thought/);
    assert.match(next, /Padding line 800 /);
  });

  test("whitespace drift still applies; ambiguous refuses; miss has nearby/context", () => {
    const rel = "20-专题/2026-中段/long.md";
    // restore a unique target with trailing spaces + CRLF
    const cur = fs.readFileSync(path.join(tmp, rel), "utf8");
    fs.writeFileSync(
      path.join(tmp, rel),
      cur.replace(
        "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the revised middle thought.",
        "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the revised middle thought.  \r\n",
      ),
      "utf8",
    );
    const drift = preciseEditWorkspace(kernel, tmp, {
      relativePath: rel,
      oldText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the revised middle thought.\n",
      newText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: drift-ok.\n",
      actor: "ai",
      confirmed: true,
    });
    assert.equal(drift.ok, true, drift.diagnostic || drift.error);
    assert.equal(drift.matchMode, "normalized");

    const ambig = preciseEditWorkspace(kernel, tmp, {
      relativePath: rel,
      oldText: "Padding line",
      newText: "X",
      actor: "ai",
      confirmed: true,
    });
    assert.equal(ambig.ok, false);
    assert.equal(ambig.reason, "ambiguous");
    assert.match(fs.readFileSync(path.join(tmp, rel), "utf8"), /Padding line 1 /);

    const miss = preciseEditWorkspace(kernel, tmp, {
      relativePath: rel,
      oldText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: does not exist",
      newText: "nope",
      actor: "ai",
      confirmed: true,
    });
    assert.equal(miss.ok, false);
    assert.match(String(miss.diagnostic), /nearby\/context/u);
  });

  test("runWorkspaceChatTurn drives shipped read + edit via generate protocol", async () => {
    const rel = "20-专题/2026-中段/long.md";
    fs.writeFileSync(path.join(tmp, rel), largeBody(), "utf8");
    let calls = 0;
    const generate = async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: "read_file",
          relativePath: rel,
          around: "UNIQUE_MIDDLE_PARAGRAPH_TARGET",
          limit: 10,
        });
      }
      if (calls === 2) {
        return JSON.stringify({
          tool: "edit_file",
          relativePath: rel,
          oldText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.",
          newText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: agent-loop edit.",
        });
      }
      return "## Done\nEdited the middle paragraph.";
    };
    const turn = await runWorkspaceChatTurn(kernel, tmp, {
      userMessage: "Replace the unique middle paragraph.",
      generate,
      locale: "en",
      writebackMode: "auto",
    });
    assert.ok(calls >= 3, `steps ${calls}`);
    assert.match(turn.body, /Edited the middle|Done/);
    assert.doesNotMatch(turn.body, /<think>|Let me think/i);
    assert.ok(turn.edits.some((e) => e.ok));
    assert.match(fs.readFileSync(path.join(tmp, rel), "utf8"), /agent-loop edit/);
  });

  test("runWorkspaceChatTurn confirm-pending is not reported as a failed edit", async () => {
    const confirmWs = fs.mkdtempSync(path.join(os.tmpdir(), "tm-obs-pending-"));
    try {
      fs.writeFileSync(
        path.join(confirmWs, "topmind.yaml"),
        "contract_version: 4\nwriteback:\n  mode: confirm\n  backup_to: 99-归档/backups\n  receipts: 99-归档/receipts\n",
        "utf8",
      );
      fs.mkdirSync(path.join(confirmWs, "20-专题", "2026-中段"), { recursive: true });
      const rel = "20-专题/2026-中段/note.md";
      fs.writeFileSync(path.join(confirmWs, rel), "---\ntitle: n\n---\n\nold span here\n", "utf8");
      const generate = async () =>
        JSON.stringify({
          tool: "edit_file",
          relativePath: rel,
          oldText: "old span here",
          newText: "new span here",
        });
      const turn = await runWorkspaceChatTurn(kernel, confirmWs, {
        userMessage: "Edit the span.",
        generate,
        locale: "en",
        writebackMode: "confirm",
        maxSteps: 1,
      });
      assert.equal(turn.edits.length, 1);
      assert.equal(turn.edits[0].pending || turn.edits[0].needsConfirm, true, JSON.stringify(turn.edits[0]));
      assert.match(turn.body, /pending/i);
      assert.doesNotMatch(turn.body, /did not apply|未能完成/i);
      assert.match(fs.readFileSync(path.join(confirmWs, rel), "utf8"), /old span here/);
      assert.doesNotMatch(fs.readFileSync(path.join(confirmWs, rel), "utf8"), /new span here/);
    } finally {
      fs.rmSync(confirmWs, { recursive: true, force: true });
    }
  });
});
