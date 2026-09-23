/**
 * Contract lifecycle — ensure / repair / reseed / cross-surface same-root.
 * Drives shipped Kernel APIs (lib/contract-engine.mjs + ensureRequiredStructure).
 * No theater: asserts on-disk topmind.yaml after each action.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  buildDefaultContract,
  loadContract,
  validateContract,
  inspectContract,
  ensureContract,
  reseedContract,
  writeContract,
  sanitizeContract,
  CONTRACT_VERSION,
  CONTRACT_FILE_NAME,
  LEGACY_CONFIG_FILE_NAME,
} from "../lib/contract-engine.mjs";
import { ensureRequiredStructure } from "../lib/workspace-model.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readYamlRaw(ws) {
  return fs.readFileSync(path.join(ws, CONTRACT_FILE_NAME), "utf8");
}

function assertValidOnDisk(ws) {
  const inspection = inspectContract(ws);
  assert.equal(inspection.state, "ok", `expected ok, got ${inspection.state}: ${inspection.errors.join("; ")}`);
  assert.equal(inspection.onDiskValid, true);
  const loaded = loadContract(ws);
  const v = validateContract(loaded);
  assert.equal(v.valid, true, v.errors.join("; "));
  assert.equal(loaded.contract_version, CONTRACT_VERSION);
  return loaded;
}

describe("ensureContract: missing → create valid v4 on disk", () => {
  let ws;
  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it("creates topmind.yaml when absent", () => {
    ws = mkTmp("tm-contract-miss-");
    assert.equal(fs.existsSync(path.join(ws, CONTRACT_FILE_NAME)), false);
    const result = ensureContract(ws, { templateId: "stream", locale: "zh-CN" });
    assert.equal(result.status, "created");
    assert.equal(result.onDiskValid, true);
    assert.ok(fs.existsSync(path.join(ws, CONTRACT_FILE_NAME)));
    const c = assertValidOnDisk(ws);
    assert.equal(c.workspace.template, "stream");
    assert.equal(c.workspace.locale, "zh-CN");
    assert.equal(c.writeback.mode, "auto");
    assert.equal(c.stream.packing, "weekly");
  });
});

describe("ensureContract: corrupt → unrepairable without reseed; reseed recovers", () => {
  let ws;
  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it("does not invent healthy on-disk state for garbage YAML", () => {
    ws = mkTmp("tm-contract-corrupt-");
    // User content that must survive reseed
    fs.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
    fs.writeFileSync(path.join(ws, "10-动态", "keep-me.md"), "# keep\n", "utf8");
    fs.writeFileSync(path.join(ws, CONTRACT_FILE_NAME), "{{{{not: valid: yaml::: [[[\n", "utf8");

    const before = readYamlRaw(ws);
    const result = ensureContract(ws);
    assert.equal(result.status, "unrepairable");
    assert.equal(result.onDiskValid, false);
    assert.equal(result.contract, null);
    // Disk still corrupt — no silent rewrite
    assert.equal(readYamlRaw(ws), before);
    assert.ok(result.operationalContract?.contract_version === CONTRACT_VERSION);

    const inspection = inspectContract(ws);
    assert.equal(inspection.state, "corrupt");
    assert.equal(inspection.onDiskValid, false);
  });

  it("reseed backs up bad file and writes valid v4 without deleting content", () => {
    const result = reseedContract(ws, { templateId: "balanced" });
    assert.equal(result.status, "reseeded");
    assert.equal(result.onDiskValid, true);
    assert.ok(result.backupPath, "must report backup path");
    const backupAbs = path.join(ws, result.backupPath);
    assert.ok(fs.existsSync(backupAbs), `backup missing: ${result.backupPath}`);
    const c = assertValidOnDisk(ws);
    assert.equal(c.workspace.template, "balanced");
    // Content preserved
    assert.ok(fs.existsSync(path.join(ws, "10-动态", "keep-me.md")));
    assert.equal(
      fs.readFileSync(path.join(ws, "10-动态", "keep-me.md"), "utf8"),
      "# keep\n",
    );
  });
});

describe("ensureContract: repairable wrong version / unknown keys", () => {
  let ws;
  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it("repairs version + strips unknown top-level keys and fills defaults", () => {
    ws = mkTmp("tm-contract-repair-");
    fs.writeFileSync(
      path.join(ws, CONTRACT_FILE_NAME),
      [
        "contract_version: 3",
        "workspace:",
        "  template: research",
        "  locale: en-US",
        "legacy_flat_key: should-be-stripped",
        "writeback:",
        "  mode: confirm",
      ].join("\n") + "\n",
      "utf8",
    );
    const result = ensureContract(ws);
    assert.equal(result.status, "repaired");
    assert.equal(result.onDiskValid, true);
    const c = assertValidOnDisk(ws);
    assert.equal(c.workspace.template, "research");
    assert.equal(c.workspace.locale, "en-US");
    assert.equal(c.writeback.mode, "confirm");
    assert.equal(c.stream.packing, "weekly"); // filled from defaults
    const raw = readYamlRaw(ws);
    assert.doesNotMatch(raw, /legacy_flat_key/);
    assert.match(raw, /contract_version:\s*4/);
  });
});

describe("ensureContract: legacy .topmind-config.json migrates", () => {
  let ws;
  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it("writes topmind.yaml from v3 JSON", () => {
    ws = mkTmp("tm-contract-legacy-");
    fs.writeFileSync(
      path.join(ws, LEGACY_CONFIG_FILE_NAME),
      JSON.stringify({
        template: "periodic",
        locale: "en-US",
        separator: " ",
        stream: { packing: "daily" },
      }),
      "utf8",
    );
    const result = ensureContract(ws);
    assert.equal(result.status, "migrated");
    assert.equal(result.onDiskValid, true);
    const c = assertValidOnDisk(ws);
    assert.equal(c.workspace.template, "periodic");
    assert.equal(c.workspace.locale, "en-US");
    assert.equal(c.workspace.category_separator, " ");
    assert.equal(c.stream.packing, "daily");
    // Legacy content is preserved under a retired name (never deleted), and
    // the active name is gone so a later hand-deleted topmind.yaml can NOT
    // re-migrate from this stale v3 snapshot.
    assert.equal(fs.existsSync(path.join(ws, LEGACY_CONFIG_FILE_NAME)), false);
    assert.ok(fs.existsSync(path.join(ws, `${LEGACY_CONFIG_FILE_NAME}.migrated`)));
    assert.ok(result.actions.includes("legacy_retired"));
  });

  it("retired sidecar cannot remigrate after yaml is deleted", () => {
    // Hand-deleting topmind.yaml used to remigrate from the leftover
    // .topmind-config.json and clobber every v4 change made since.
    fs.unlinkSync(path.join(ws, CONTRACT_FILE_NAME));
    const result = ensureContract(ws);
    assert.equal(result.status, "created", "must create defaults, not remigrate");
    assert.equal(fs.existsSync(path.join(ws, LEGACY_CONFIG_FILE_NAME)), false);
    assert.ok(fs.existsSync(path.join(ws, `${LEGACY_CONFIG_FILE_NAME}.migrated`)));
    const c = assertValidOnDisk(ws);
    // Fresh defaults — not the v3 snapshot (periodic / en-US / daily).
    assert.equal(c.workspace.template, "stream");
    assert.notEqual(c.stream.packing, "daily");
  });
});

describe("ensureRequiredStructure shares ensureContract + memory plane", () => {
  let ws;
  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it("empty root gets required roles, memory/, and valid contract", () => {
    ws = mkTmp("tm-contract-struct-");
    const { created, contractStatus, contractOnDiskValid } = ensureRequiredStructure(ws, {
      engineRoot,
      templateId: "stream",
    });
    assert.equal(contractOnDiskValid, true);
    assert.ok(["created", "ok", "repaired", "migrated"].includes(contractStatus));
    assertValidOnDisk(ws);
    assert.ok(fs.existsSync(path.join(ws, "memory")));
    // Required role dirs present (locale-aware names from template)
    const dirs = fs.readdirSync(ws).filter((n) => /^\d{2}[ -]/.test(n));
    assert.ok(dirs.some((d) => d.startsWith("00")));
    assert.ok(dirs.some((d) => d.startsWith("88")));
    assert.ok(dirs.some((d) => d.startsWith("99")));
    assert.ok(Array.isArray(created));
  });
});

describe("cross-surface same-root equivalence", () => {
  let ws;
  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it("Kernel load paths agree on critical nested fields", () => {
    ws = mkTmp("tm-contract-xsurf-");
    const seed = sanitizeContract({
      workspace: {
        name: "shared-ws",
        locale: "en-US",
        template: "research",
        category_separator: "-",
      },
      writeback: { mode: "confirm" },
      stream: { packing: "monthly" },
    });
    writeContract(ws, seed);

    // Path A: direct contract-engine (UTR / Kernel consumers)
    const a = loadContract(ws);
    // Path B: ensureContract ok path returns same contract shape
    const ensured = ensureContract(ws);
    assert.equal(ensured.status, "ok");
    const b = ensured.contract;
    // Path C: ensureRequiredStructure re-reads same disk
    const { model } = ensureRequiredStructure(ws, { engineRoot });
    const c = loadContract(ws);

    for (const contract of [a, b, c]) {
      assert.equal(contract.contract_version, 4);
      assert.equal(contract.workspace.locale, "en-US");
      assert.equal(contract.workspace.template, "research");
      assert.equal(contract.workspace.category_separator, "-");
      assert.equal(contract.writeback.mode, "confirm");
      assert.equal(contract.stream.packing, "monthly");
    }
    // Model config projected from same root
    assert.equal(model.config?.template || model.contract?.workspace?.template, "research");
  });
});

describe("sanitizeContract + validateContract clean surface", () => {
  it("buildDefaultContract and sanitize output pass validateContract", () => {
    const d = buildDefaultContract();
    assert.deepEqual(validateContract(d), { valid: true, errors: [] });
    const s = sanitizeContract({
      contract_version: 99,
      workspace: { template: "stream" },
      unknown_junk: true,
      categoryExtensions: { "11": { name: "x" } }, // flat alias must not survive as top key
    });
    assert.equal(s.contract_version, 4);
    assert.equal(s.workspace.template, "stream");
    assert.equal(s.unknown_junk, undefined);
    assert.equal(s.categoryExtensions, undefined);
    assert.deepEqual(validateContract(s), { valid: true, errors: [] });
  });
});

describe("loadContract is operational fallback, not health claim", () => {
  let ws;
  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it("returns usable defaults while inspect reports corrupt on-disk", () => {
    ws = mkTmp("tm-contract-load-");
    fs.writeFileSync(path.join(ws, CONTRACT_FILE_NAME), "not: [yaml: broken", "utf8");
    const operational = loadContract(ws);
    assert.equal(operational.contract_version, 4);
    assert.ok(operational.writeback?.mode);
    const inspection = inspectContract(ws);
    assert.equal(inspection.onDiskValid, false);
    assert.notEqual(inspection.state, "ok");
  });
});

describe("repair convergence: null sections + version stamps", () => {
  let ws;
  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it("repairs `memory: null` to defaults in one pass (no permanent repairable loop)", () => {
    ws = mkTmp("tm-contract-nullsec-");
    fs.writeFileSync(
      path.join(ws, CONTRACT_FILE_NAME),
      [
        "contract_version: 4",
        "workspace: {}",
        "memory: null",
        "stream:",
        "  packing: weekly",
        "protection: {}",
        "writeback: {}",
      ].join("\n") + "\n",
      "utf8",
    );
    const first = inspectContract(ws);
    assert.equal(first.state, "repairable");
    const result = ensureContract(ws);
    assert.equal(result.status, "repaired");
    // The whole point: second inspection must be healthy, not repairable again
    const c = assertValidOnDisk(ws);
    assert.ok(c.memory?.layers?.global?.file, "memory section must be filled from defaults");
    assert.doesNotMatch(readYamlRaw(ws), /memory:\s*null/);
  });

  it("stamps missing contract_version via repairable path", () => {
    const dir = mkTmp("tm-contract-nover-");
    try {
      fs.writeFileSync(
        path.join(dir, CONTRACT_FILE_NAME),
        [
          "workspace:",
          "  template: balanced",
          "stream: {}",
          "memory: {}",
          "protection: {}",
          "writeback: {}",
        ].join("\n") + "\n",
        "utf8",
      );
      const first = inspectContract(dir);
      assert.equal(first.state, "repairable");
      const result = ensureContract(dir);
      assert.equal(result.status, "repaired");
      const c = assertValidOnDisk(dir);
      assert.equal(c.workspace.template, "balanced", "repair keeps user template");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts string contract_version \"4\" (Number compare, no contradictory error)", () => {
    const dir = mkTmp("tm-contract-strver-");
    try {
      fs.writeFileSync(
        path.join(dir, CONTRACT_FILE_NAME),
        'contract_version: "4"\nworkspace: {}\nstream: {}\nmemory: {}\nprotection: {}\nwriteback: {}\n',
        "utf8",
      );
      const inspection = inspectContract(dir);
      assert.equal(inspection.state, "ok");
      assert.equal(inspection.onDiskValid, true);
      for (const e of inspection.validation.errors) {
        assert.doesNotMatch(e, /expected 4\).*expected 4/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("corrupt yaml + legacy JSON: backup before migration overwrite", () => {
  it("migrates legacy but keeps the corrupt file as backup", () => {
    const dir = mkTmp("tm-contract-legacybak-");
    try {
      fs.writeFileSync(path.join(dir, CONTRACT_FILE_NAME), "garbage: [unparseable\n", "utf8");
      fs.writeFileSync(
        path.join(dir, LEGACY_CONFIG_FILE_NAME),
        JSON.stringify({ template: "balanced" }),
        "utf8",
      );
      const result = ensureContract(dir);
      assert.equal(result.status, "migrated");
      assert.ok(result.backupPath, "corrupt file must be backed up before overwrite");
      const backupAbs = path.join(dir, result.backupPath);
      assert.ok(fs.existsSync(backupAbs));
      assert.equal(fs.readFileSync(backupAbs, "utf8"), "garbage: [unparseable\n");
      assertValidOnDisk(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("reseed forces fresh defaults on any state", () => {
  it("reseeds a healthy contract (no silent no-op)", () => {
    const dir = mkTmp("tm-contract-reseedok-");
    try {
      ensureContract(dir, { templateId: "research" });
      const result = reseedContract(dir);
      assert.equal(result.status, "reseeded");
      assert.ok(result.backupPath, "healthy file must still be backed up on reseed");
      assert.ok(fs.existsSync(path.join(dir, result.backupPath)));
      // Fresh defaults: user template research is gone
      const c = assertValidOnDisk(dir);
      assert.equal(c.workspace.template, "stream");
      assert.ok(result.actions.includes("reseeded"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("two reseeds in the same second produce distinct backups", () => {
    const dir = mkTmp("tm-contract-reseedx2-");
    try {
      fs.writeFileSync(path.join(dir, CONTRACT_FILE_NAME), "broken: [\n", "utf8");
      const r1 = reseedContract(dir);
      assert.equal(r1.status, "reseeded");
      fs.writeFileSync(path.join(dir, CONTRACT_FILE_NAME), "broken: [\n", "utf8");
      const r2 = reseedContract(dir);
      assert.equal(r2.status, "reseeded");
      assert.notEqual(r1.backupPath, r2.backupPath);
      assert.ok(fs.existsSync(path.join(dir, r1.backupPath)));
      assert.ok(fs.existsSync(path.join(dir, r2.backupPath)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("repair never clobbers user template/locale/name via opts", () => {
  it("ensureContract(templateId=stream) keeps on-disk balanced template during repair", () => {
    const dir = mkTmp("tm-contract-tmplkeep-");
    try {
      fs.writeFileSync(
        path.join(dir, CONTRACT_FILE_NAME),
        [
          "contract_version: 3",
          "workspace:",
          "  template: balanced",
          "  locale: en-US",
          "  name: user-workspace",
        ].join("\n") + "\n",
        "utf8",
      );
      // Obsidian-style open path: templateId hardcoded on every launch
      const result = ensureContract(dir, { templateId: "stream" });
      assert.equal(result.status, "repaired");
      const c = assertValidOnDisk(dir);
      assert.equal(c.workspace.template, "balanced");
      assert.equal(c.workspace.locale, "en-US");
      assert.equal(c.workspace.name, "user-workspace");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ensureContract(templateId) still applies on create (first init)", () => {
    const dir = mkTmp("tm-contract-tmplnew-");
    try {
      const result = ensureContract(dir, { templateId: "research" });
      assert.equal(result.status, "created");
      const c = assertValidOnDisk(dir);
      assert.equal(c.workspace.template, "research");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
