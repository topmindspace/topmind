/**
 * Desktop workspace contract path — real shipped functions.
 * Proves:
 *  1) updateWorkspaceConfig writes clean valid v4 via Kernel (no flat locale / camelCase drift)
 *  2) ensureWorkspaceStructure surfaces unrepairable when topmind.yaml is corrupt
 *  3) desktopWritebackMode does not prefer app-settings over topmind.yaml
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const engineRoot = path.resolve(desktopRoot, "..");

// Point Desktop engine root at monorepo so Kernel load works in tests
const { setEngineRoot, ensureWorkspaceStructure } = await import(
  "../electron/lib/workspace-home.mjs"
);
setEngineRoot(engineRoot);

const {
  loadKernelApi,
  resetKernelApiCache,
  kernelLoadContract,
  resolveWorkspaceWritebackMode,
  kernelDurableWrite,
} = await import("../electron/lib/kernel-api.mjs");
resetKernelApiCache();

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeCtx(ws) {
  return {
    workspaceRoot: {
      userWorkspaceRoot: ws,
      engineRoot,
    },
    engineRoot,
    appSettings: { writebackMode: "confirm" }, // intentional: must NOT override Kernel
    workspaceStatePaths: {
      settingsFilePath: path.join(ws, ".desktop-test-settings.json"),
    },
  };
}

describe("updateWorkspaceConfig writes valid Kernel v4 on disk", () => {
  let ws;
  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it("persists writeback + stream without flat aliases or camelCase appendHeading", async () => {
    ws = mkTmp("tm-desk-upd-");
    for (const d of ["00-收件箱", "10-动态", "88-输出", "99-归档"]) {
      fs.mkdirSync(path.join(ws, d), { recursive: true });
    }
    // Seed valid contract via Kernel
    const kernel = await loadKernelApi();
    kernel.writeContract(ws, kernel.buildDefaultContract());

    const { SystemService } = await import("../electron/system-service.mjs");
    const ctx = makeCtx(ws);
    const result = await SystemService.updateWorkspaceConfig(
      {
        writebackMode: "confirm",
        stream: { packing: "monthly", appendHeading: "day" },
        categorySeparator: "-",
        template: "research",
      },
      ctx,
    );
    assert.equal(result.ok, true);
    assert.equal(result.onDiskValid, true);

    // On-disk file must pass Kernel inspect + validate
    const inspection = kernel.inspectContract(ws);
    assert.equal(inspection.state, "ok", inspection.errors?.join("; "));
    assert.equal(inspection.onDiskValid, true);

    const raw = fs.readFileSync(path.join(ws, "topmind.yaml"), "utf8");
    // No flat alias pollution
    assert.doesNotMatch(raw, /^locale:/m);
    assert.doesNotMatch(raw, /^template:/m);
    assert.doesNotMatch(raw, /^categorySeparator:/m);
    assert.doesNotMatch(raw, /appendHeading:/);
    // Nested v4 keys present
    assert.match(raw, /contract_version:\s*4/);
    assert.match(raw, /writeback:[\s\S]*mode:\s*confirm/);
    assert.match(raw, /append_heading:\s*day/);
    assert.match(raw, /packing:\s*monthly/);
    assert.match(raw, /template:\s*research/);

    const loaded = kernel.loadContract(ws);
    const v = kernel.validateContract(loaded);
    assert.equal(v.valid, true, v.errors.join("; "));
    assert.equal(loaded.writeback.mode, "confirm");
    assert.equal(loaded.stream.packing, "monthly");
    assert.equal(loaded.stream.append_heading, "day");
    assert.equal(loaded.workspace.template, "research");
  });
});

describe("ensureWorkspaceStructure surfaces unrepairable contract", () => {
  let ws;
  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it("returns contractOnDiskValid=false for garbage YAML without rewriting it", async () => {
    ws = mkTmp("tm-desk-corrupt-");
    fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
    fs.writeFileSync(path.join(ws, "10-动态", "keep.md"), "# keep\n", "utf8");
    const garbage = "{{{{not yaml at all :::\n";
    fs.writeFileSync(path.join(ws, "topmind.yaml"), garbage, "utf8");

    const result = await ensureWorkspaceStructure(ws);
    assert.equal(typeof result, "object");
    assert.equal(result.contractOnDiskValid, false);
    assert.equal(result.contractStatus, "unrepairable");
    assert.ok(result.recovery, "must offer recovery action");
    // Disk still corrupt — no silent rewrite on ensure without reseed
    assert.equal(fs.readFileSync(path.join(ws, "topmind.yaml"), "utf8"), garbage);
    // Content preserved
    assert.ok(fs.existsSync(path.join(ws, "10-动态", "keep.md")));
  });

  it("reseedWorkspaceContract recovers valid v4 and keeps content", async () => {
    const { SystemService } = await import("../electron/system-service.mjs");
    const ctx = makeCtx(ws);
    const res = await SystemService.reseedWorkspaceContract({}, ctx);
    assert.equal(res.ok, true);
    assert.equal(res.onDiskValid, true);
    assert.ok(res.backupPath, "must backup bad file");

    const kernel = await loadKernelApi();
    const inspection = kernel.inspectContract(ws);
    assert.equal(inspection.onDiskValid, true);
    assert.equal(inspection.state, "ok");
    assert.ok(fs.existsSync(path.join(ws, "10-动态", "keep.md")));
  });
});

describe("writebackMode is not forked from app-settings for Kernel writes", () => {
  it("desktopWritebackMode source prefers only explicit opts (code contract)", async () => {
    // Structural: shipped kernel-api must not read appSettings.writebackMode
    const src = fs.readFileSync(
      path.join(desktopRoot, "electron/lib/kernel-api.mjs"),
      "utf8",
    );
    const fnStart = src.indexOf("function desktopWritebackMode");
    assert.ok(fnStart >= 0);
    const fnBody = src.slice(fnStart, src.indexOf("\nexport async function kernelDurableWrite", fnStart));
    assert.doesNotMatch(fnBody, /appSettings\?\.writebackMode|appSettings\.writebackMode/u);
    assert.match(fnBody, /return undefined/u);
  });

  it("updateSettings with writebackMode mirrors into topmind.yaml", async () => {
    const ws = mkTmp("tm-desk-wb-");
    try {
      for (const d of ["00-收件箱", "88-输出", "99-归档"]) {
        fs.mkdirSync(path.join(ws, d), { recursive: true });
      }
      const kernel = await loadKernelApi();
      kernel.writeContract(ws, {
        ...kernel.buildDefaultContract(),
        writeback: { ...kernel.buildDefaultContract().writeback, mode: "auto" },
      });

      // Write a minimal app-settings path for updateSettings
      const settingsPath = path.join(ws, "app-settings.json");
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ writebackMode: "auto", theme: "system" }),
        "utf8",
      );

      const { SystemService } = await import("../electron/system-service.mjs");
      const ctx = {
        ...makeCtx(ws),
        workspaceStatePaths: { settingsFilePath: settingsPath },
        updateAppSettingsInMemory: () => {},
      };
      await SystemService.updateSettings({ patch: { writebackMode: "confirm" } }, ctx);

      const loaded = kernel.loadContract(ws);
      assert.equal(loaded.writeback.mode, "confirm");
      const inspection = kernel.inspectContract(ws);
      assert.equal(inspection.onDiskValid, true);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("resolveWorkspaceWritebackMode and AI writes follow yaml, not app-settings", async () => {
    const ws = mkTmp("tm-desk-wb-merge-");
    try {
      for (const d of ["00-收件箱", "20-专题", "88-输出", "99-归档"]) {
        fs.mkdirSync(path.join(ws, d), { recursive: true });
      }
      const kernel = await loadKernelApi();
      const base = kernel.buildDefaultContract();
      kernel.writeContract(ws, {
        ...base,
        writeback: { ...base.writeback, mode: "auto" },
      });

      const ctx = {
        ...makeCtx(ws),
        appSettings: { writebackMode: "confirm" },
      };

      assert.equal(
        await resolveWorkspaceWritebackMode(ctx),
        "auto",
        "yaml auto must win over app-settings confirm",
      );

      const autoWrite = await kernelDurableWrite(
        { relativePath: "20-专题/from-auto.md", content: "# auto\n" },
        ctx,
        { actor: "ai", isCreate: true },
      );
      assert.equal(autoWrite.pending, false, "yaml auto: AI write must not pending");
      assert.equal(autoWrite.wroteFiles, true);
      assert.ok(fs.existsSync(path.join(ws, "20-专题", "from-auto.md")));

      kernel.writeContract(ws, {
        ...kernel.loadContract(ws),
        writeback: { ...kernel.loadContract(ws).writeback, mode: "confirm" },
      });
      ctx.appSettings = { writebackMode: "auto" };

      assert.equal(
        await resolveWorkspaceWritebackMode(ctx),
        "confirm",
        "yaml confirm must win over app-settings auto",
      );

      const confirmWrite = await kernelDurableWrite(
        { relativePath: "20-专题/from-confirm.md", content: "# confirm\n" },
        ctx,
        { actor: "ai", isCreate: true },
      );
      assert.equal(confirmWrite.pending, true, "yaml confirm: AI write must stay pending");
      assert.equal(confirmWrite.wroteFiles, false);
      assert.ok(!fs.existsSync(path.join(ws, "20-专题", "from-confirm.md")));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe("ensure empty root creates valid contract (Desktop open path)", () => {
  it("empty folder → on-disk valid v4 after ensureWorkspaceStructure", async () => {
    const ws = mkTmp("tm-desk-empty-");
    try {
      const result = await ensureWorkspaceStructure(ws, "stream");
      assert.equal(result.contractOnDiskValid, true);
      assert.ok(["created", "ok", "repaired", "migrated"].includes(result.contractStatus));
      const kernel = await loadKernelApi();
      const inspection = kernel.inspectContract(ws);
      assert.equal(inspection.onDiskValid, true);
      const c = kernel.loadContract(ws);
      assert.equal(c.contract_version, 4);
      assert.ok(c.writeback?.mode);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
