/**
 * Prompt / step-budget / Settings fallback — drives shipped builders.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt, resolvePromptLocale } from "../electron/ai-prompts.mjs";
import {
  describeWritebackModeForPrompt,
  MODEL_A_FORBIDDEN_RE,
} from "../electron/lib/writeback-mode-copy.mjs";
import {
  AGENT_STEPS_DEFAULT,
  AGENT_STEPS_MIN,
  AGENT_STEPS_MAX,
  clampMaxAgentSteps,
} from "../electron/lib/settings-core.mjs";
import {
  AGENT_STEPS_DEFAULT as UI_DEFAULT,
  AGENT_STEPS_MIN as UI_MIN,
  AGENT_STEPS_MAX as UI_MAX,
  AGENT_STEP_OPTION_VALUES,
  fallbackMaxAgentSteps,
} from "../src/lib/agent-steps.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_TOOLS = [
  "read_file",
  "edit_file",
  "save_file",
  "search",
  "capture_to_inbox",
  "list_categories",
];

function assertPromptContract(prompt, { locale, writeback }) {
  for (const name of REQUIRED_TOOLS) {
    assert.match(prompt, new RegExp(name), `missing tool ${name}`);
  }
  assert.doesNotMatch(prompt, MODEL_A_FORBIDDEN_RE);
  assert.doesNotMatch(prompt, /must match file content exactly|必须精确匹配文件内容/u);
  assert.match(prompt, /unique-span|unique span|唯一片段|先精确再容忍|newline\/trailing-space/i);
  assert.match(prompt, /protection outranks|保护级别优先/u);
  if (writeback === "confirm") {
    assert.match(prompt, /ask before save|pending|保存前问我|待确认写入/u);
    assert.match(prompt, /write tools|write 工具|save_file|edit_file/u);
  } else {
    assert.match(prompt, /auto-save|自动保存/u);
  }
  if (locale === "en") {
    assert.match(prompt, /You are the topmind/i);
    assert.doesNotMatch(prompt, /你是 topmind 个人知识工作台助手/);
  } else {
    assert.match(prompt, /你是 topmind/);
    assert.doesNotMatch(prompt, /You are the topmind/);
  }
}

test("buildSystemPrompt zh/en × auto/confirm names real tools and unique-span writeback", () => {
  for (const locale of ["zh-CN", "en-US"]) {
    for (const writeback of ["auto", "confirm"]) {
      const prompt = buildSystemPrompt({
        workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
        writebackMode: writeback,
        skillsEnabled: false,
        locale,
      });
      assertPromptContract(prompt, { locale: resolvePromptLocale(locale), writeback });
    }
  }
});

test("describeWritebackModeForPrompt mentions protection outranks + Model B", () => {
  for (const mode of ["auto", "confirm"]) {
    for (const loc of ["zh", "en"]) {
      const line = describeWritebackModeForPrompt(mode, loc);
      assert.doesNotMatch(line, MODEL_A_FORBIDDEN_RE);
      assert.match(line, /protection outranks|保护级别优先/u);
    }
  }
});

test("step-budget triple is one number set: settings-core = stream = Settings UI", () => {
  assert.equal(AGENT_STEPS_MIN, 3);
  assert.equal(AGENT_STEPS_DEFAULT, 20);
  assert.equal(AGENT_STEPS_MAX, 50);
  assert.equal(UI_MIN, AGENT_STEPS_MIN);
  assert.equal(UI_DEFAULT, AGENT_STEPS_DEFAULT);
  assert.equal(UI_MAX, AGENT_STEPS_MAX);
  const streamSrc = readFileSync(path.join(root, "electron/ai-stream.mjs"), "utf8");
  assert.match(streamSrc, /DEFAULT_MAX_AGENT_STEPS = AGENT_STEPS_DEFAULT/);
  assert.equal(clampMaxAgentSteps(1), AGENT_STEPS_MIN);
  assert.equal(clampMaxAgentSteps(99), AGENT_STEPS_MAX);
  assert.equal(clampMaxAgentSteps(undefined), AGENT_STEPS_DEFAULT);
  assert.equal(fallbackMaxAgentSteps(undefined), AGENT_STEPS_DEFAULT);
  assert.equal(fallbackMaxAgentSteps(null), AGENT_STEPS_DEFAULT);
  assert.ok(AGENT_STEP_OPTION_VALUES.includes(AGENT_STEPS_DEFAULT));
  assert.ok(AGENT_STEP_OPTION_VALUES.includes(AGENT_STEPS_MIN));
  assert.ok(AGENT_STEP_OPTION_VALUES.includes(AGENT_STEPS_MAX));
});

test("Settings control does not default to 12; stream clamp imports settings-core", () => {
  const panel = readFileSync(path.join(root, "src/components/settings/AiProviderPanel.tsx"), "utf8");
  const stream = readFileSync(path.join(root, "electron/ai-stream.mjs"), "utf8");
  assert.match(panel, /fallbackMaxAgentSteps/);
  assert.doesNotMatch(panel, /\?\?\s*12/);
  assert.match(stream, /clampMaxAgentSteps/);
  assert.match(stream, /AGENT_STEPS_DEFAULT/);
});
