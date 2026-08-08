import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadContractRegistry, getTool, getCommand, listTools, listCommands } from "../../core/contract-registry.mjs";

const CATEGORY_DOMAINS = ["contract", "derived", "lifecycle", "memory", "workspace-maintain", "workspace-read", "workspace-transform", "workspace-write"];

let registry;

test("loadContractRegistry loads only category-first tool domains", async () => {
  registry = await loadContractRegistry();
  assert.equal(registry.toolCount, 8);
  assert.equal(registry.commandCount, 27);
  assert.deepEqual(Array.from(registry.byKind.keys()).sort(), CATEGORY_DOMAINS);
});

test("registry indexes the target category command domains", () => {
  for (const domain of CATEGORY_DOMAINS) {
    const tools = listTools(registry, { skill: domain });
    assert.equal(tools.length, 1, `${domain} should have one contract`);
    assert.equal(tools[0].kind, domain);
  }
});

test("workspace-read exposes read-only workspace commands", () => {
  const tool = getTool(registry, "workspace-read");
  assert.equal(tool.skill, "workspace-read");
  assert.deepEqual(Object.keys(tool.commands).sort(), [
    "inspect-topic",
    "list-categories",
    "list-inbox",
    "list-recent-captures",
    "list-safety-receipts",
    "list-topic-files",
    "list-topics",
  ]);
  assert.equal(tool.commands["list-safety-receipts"].label, "列出恢复记录");
  assert.doesNotMatch(JSON.stringify(tool.commands["list-safety-receipts"]), /可逆记录|可逆写回/u);
});

test("workspace-write capture-note supports global writeback mode", () => {
  const entry = getCommand(registry, "workspace-write", "capture-note");
  assert.equal(entry.commandName, "capture-note");
  assert.equal(entry.command.risk_level, "low");
  assert.equal(entry.command.review_policy, "preview_or_auto");
  assert.equal(entry.command.supports_dry_run, true);
  assert.equal(entry.command.inputs.dryRun.default, true);
  assert.equal(entry.command.inputs.writebackMode.default, "auto");
  assert.deepEqual(entry.command.inputs.writebackMode.options.map((option) => option.value), ["auto", "confirm"]);
  assert.ok(entry.command.writes.length > 0);
});

test("workspace-write create-topic routes by category not project type", () => {
  const entry = getCommand(registry, "workspace-write", "create-topic");
  assert.equal(entry.commandName, "create-topic");
  assert.equal(entry.command.inputs.category.type, "category");
  assert.equal(entry.command.inputs.topic.type, "topic");
  // No v2.x projectType input
  assert.equal(entry.command.inputs.projectType, undefined);
  assert.equal(entry.command.inputs.projectId, undefined);
  assert.doesNotMatch(JSON.stringify(entry.command), /projects\/|knowledge\/|writing\//u);
});

test("workspace-write save-output defaults to preview before apply", () => {
  const entry = getCommand(registry, "workspace-write", "save-output");
  assert.equal(entry.commandName, "save-output");
  assert.equal(entry.command.review_policy, "preview_or_auto");
  assert.equal(entry.command.supports_dry_run, true);
  assert.equal(entry.command.inputs.dryRun.default, true);
  assert.equal(entry.command.inputs.ifExists.default, "create-new");
  // Outputs go to flat delivery layer (88-输出/ canonical; 88 Outputs/ compatible at FS level)
  assert.ok(entry.command.writes.some((pattern) => /88[- ]输出/.test(pattern)));
});

test("memory append-topic is append-only", () => {
  const entry = getCommand(registry, "memory", "append-topic");
  assert.equal(entry.commandName, "append-topic");
  assert.equal(entry.command.risk_level, "low");
  assert.equal(entry.command.review_policy, "auto");
});

test("workspace-write update-topic uses reason plus reversible writeback safety", () => {
  const entry = getCommand(registry, "workspace-write", "update-topic");
  assert.equal(entry.command.risk_level, "high");
  assert.equal(entry.command.inputs.replaceReason.required, true);
  assert.equal(entry.command.inputs.confirmFullReplace, undefined);
  assert.equal(entry.command.review_policy, "preview_or_auto");
  assert.equal(entry.command.supports_dry_run, true);
  assert.match(entry.command.workflow_note, /high-impact|writeback/iu);
});

test("workspace-maintain archive-topic follows global writeback mode without a second review policy", () => {
  const entry = getCommand(registry, "workspace-maintain", "archive-topic");
  assert.equal(entry.command.risk_level, "high");
  assert.equal(entry.command.review_policy, "preview_or_auto");
  assert.equal(entry.command.inputs.reason.required, true);
  assert.equal(entry.command.inputs.writebackMode.default, "auto");
  assert.deepEqual(entry.command.inputs.writebackMode.options.map((option) => option.value), ["auto", "confirm"]);
  assert.equal(entry.command.destructive, true);
  assert.match(entry.command.workflow_note, /without a second confirmation/u);
});

test("workspace-maintain restore-safety-receipt follows writeback mode and never overwrites directly", () => {
  const entry = getCommand(registry, "workspace-maintain", "restore-safety-receipt");
  assert.equal(entry.command.label, "恢复记录");
  assert.equal(entry.command.inputs.receiptPath.label, "记录路径");
  assert.equal(entry.command.risk_level, "high");
  assert.equal(entry.command.review_policy, "preview_or_auto");
  assert.equal(entry.command.inputs.receiptPath.required, true);
  assert.equal(entry.command.inputs.reason.required, true);
  assert.equal(entry.command.inputs.writebackMode.default, "auto");
  assert.equal(entry.command.destructive, false);
  assert.doesNotMatch(JSON.stringify(entry.command), /可逆记录|可逆写回/u);
  assert.match(entry.command.workflow_note, /never overwritten|restored copy/u);
});

test("writeback mode options use save settings labels instead of internal mode copy", () => {
  const entries = [
    getCommand(registry, "workspace-write", "create-topic"),
    getCommand(registry, "workspace-write", "capture-note"),
    getCommand(registry, "workspace-write", "save-output"),
    getCommand(registry, "workspace-write", "update-topic"),
    getCommand(registry, "workspace-maintain", "archive-topic"),
    getCommand(registry, "workspace-maintain", "restore-safety-receipt"),
  ];

  for (const entry of entries) {
    const writebackMode = entry.command.inputs.writebackMode;
    assert.equal(writebackMode?.label, "保存设置");
    assert.match(writebackMode?.options?.find((option) => option.value === "auto")?.label ?? "", /自动/u);
    assert.match(writebackMode?.options?.find((option) => option.value === "confirm")?.label ?? "", /审阅/u);
    assert.doesNotMatch(JSON.stringify(entry.command), /写回模式|自动写入并回执|确认模式|写入前确认|归档前确认|confirm 先预览/u);
  }
});

test("primary MCP surface is smaller than full registry (agent-friendly)", () => {
  const all = listCommands(registry);
  const primary = all.filter((c) => c.exposure === "primary" || c.exposure === "danger");
  const advanced = all.filter((c) => c.exposure === "advanced");
  assert.equal(all.length, 27);
  assert.equal(primary.length, 18);
  assert.equal(advanced.length, 9);
  assert.ok(primary.some((c) => c.command === "capture-note"));
  assert.ok(advanced.some((c) => c.command === "migrate-v4"));
  assert.throws(() => getCommand(registry, "workspace-transform", "normalize-topic"), /未知|Unknown|不存在|command/iu);
  assert.throws(() => getCommand(registry, "workspace-maintain", "repair-topic-index"), /未知|Unknown|不存在|command/iu);
});

test("listCommands returns normalized category domain labels", () => {
  const commands = listCommands(registry);
  assert.ok(commands.length >= 20);
  assert.ok(commands.every((command) => CATEGORY_DOMAINS.includes(command.skill)));
  assert.ok(commands.every((command) => command.sourceEngineLabel.length > 0));
});

test("old command domains are absent", () => {
  assert.throws(() => getTool(registry, "project-manager"), /未知工具/u);
  assert.throws(() => getTool(registry, "knowledge-lint"), /未知工具/u);
  assert.deepEqual(listTools(registry, { skill: "writing-skills" }), []);
  assert.deepEqual(listTools(registry, { skill: "mind-skills" }), []);
});

test("loadContractRegistry rejects old skill domains in new contracts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "topmind-utr-contracts-"));
  try {
    const skillDir = path.join(tempRoot, "old-domain");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "old-tool.json"), JSON.stringify({
      schema_version: 1,
      kind: "old-tool",
      skill: "writing-skills",
      label: "Old Tool",
      description: "Invalid old-domain contract",
      execution: {
        runtime: "node",
        cwd_mode: "engine_root",
        script: "old/tools/old.mjs",
        args_template: ["{command}"],
      },
      commands: {
        run: {
          label: "Run",
          group: "assistive",
          risk_level: "low",
          review_policy: "auto",
          requires_topic: false,
          idempotent: true,
          inputs: {},
          reads: [],
          writes: [],
        },
      },
    }, null, 2));

    await assert.rejects(
      () => loadContractRegistry({ contractsDir: tempRoot }),
      /skill 无效: writing-skills/u,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("loadContractRegistry accepts node runtime contracts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "topmind-utr-node-contracts-"));
  try {
    const skillDir = path.join(tempRoot, "workspace-read");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "node-tool.json"), JSON.stringify({
      schema_version: 1,
      kind: "node-tool",
      skill: "workspace-read",
      label: "Node Tool",
      description: "Test-only Node runtime contract",
      execution: {
        runtime: "node",
        cwd_mode: "engine_root",
        script: "utr/tools/node-tool.mjs",
        args_template: ["{command}"],
      },
      commands: {
        ping: {
          label: "Ping",
          group: "assistive",
          risk_level: "low",
          review_policy: "auto",
          requires_topic: false,
          idempotent: true,
          inputs: {},
          reads: [],
          writes: [],
        },
      },
    }, null, 2));

    const loaded = await loadContractRegistry({ contractsDir: tempRoot });
    assert.equal(getTool(loaded, "node-tool").execution.runtime, "node");
    assert.equal(getCommand(loaded, "node-tool", "ping").commandName, "ping");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("loadContractRegistry rejects non-node execution runtimes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "topmind-utr-runtime-contracts-"));
  try {
    const skillDir = path.join(tempRoot, "workspace-read");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "external-runtime-tool.json"), JSON.stringify({
      schema_version: 1,
      kind: "external-runtime-tool",
      skill: "workspace-read",
      label: "External Runtime Tool",
      description: "Invalid non-Node runtime contract",
      execution: {
        runtime: "deno",
        cwd_mode: "engine_root",
        script: "utr/tools/external-runtime-tool.ts",
        args_template: ["{command}"],
      },
      commands: {
        ping: {
          label: "Ping",
          group: "assistive",
          risk_level: "low",
          review_policy: "auto",
          requires_topic: false,
          idempotent: true,
          inputs: {},
          reads: [],
          writes: [],
        },
      },
    }, null, 2));

    await assert.rejects(
      () => loadContractRegistry({ contractsDir: tempRoot }),
      /execution\.runtime 无效: deno/u,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("loadContractRegistry rejects execution fallback hooks", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "topmind-utr-fallback-contracts-"));
  try {
    const skillDir = path.join(tempRoot, "workspace-read");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "workspace-read.json"), JSON.stringify({
      schema_version: 1,
      kind: "workspace-read",
      skill: "workspace-read",
      label: "Project Read",
      description: "Invalid fallback contract",
      execution: {
        runtime: "node",
        cwd_mode: "engine_root",
        script: "utr/tools/workspace-read.mjs",
        fallback: "old-read",
        args_template: ["{command}"],
      },
      commands: {
        "list-topics": {
          label: "List",
          group: "assistive",
          risk_level: "low",
          review_policy: "auto",
          requires_topic: false,
          idempotent: true,
          inputs: {},
          reads: [],
          writes: [],
        },
      },
    }, null, 2));

    await assert.rejects(
      () => loadContractRegistry({ contractsDir: tempRoot }),
      /execution\.fallback 已废弃/u,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});