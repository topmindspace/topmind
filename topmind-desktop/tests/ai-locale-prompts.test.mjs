/**
 * AI locale matching: system prompts, writeback copy, inline complete.
 * Drives shipped builders with en + zh; no network / Electron.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildSystemPrompt,
  resolvePromptLocale,
  getSkillPrompts,
  SKILL_PROMPTS,
} from "../electron/ai-prompts.mjs";
import {
  resolveOutputLanguage,
  resolveAgentOutputLanguage,
} from "../../lib/ai-output-locale.mjs";
import {
  describeWritebackModeForPrompt,
  MODEL_A_FORBIDDEN_RE,
} from "../electron/lib/writeback-mode-copy.mjs";
import {
  buildInlineCompletePrompt,
  getInlineSystem,
  INLINE_SYSTEM,
} from "../electron/lib/inline-complete-prompt.mjs";

test("resolvePromptLocale maps tags to zh|en", () => {
  assert.equal(resolvePromptLocale(undefined), "zh");
  assert.equal(resolvePromptLocale(""), "zh");
  assert.equal(resolvePromptLocale("zh"), "zh");
  assert.equal(resolvePromptLocale("zh-CN"), "zh");
  assert.equal(resolvePromptLocale("en"), "en");
  assert.equal(resolvePromptLocale("en-US"), "en");
  assert.equal(resolvePromptLocale("en-GB"), "en");
});

test("buildSystemPrompt default (zh) uses Chinese markers", () => {
  const prompt = buildSystemPrompt({
    workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
    writebackMode: "auto",
    skillsEnabled: false,
  });
  assert.match(prompt, /你是 topmind/);
  assert.match(prompt, /工作区/);
  assert.match(prompt, /质量|少问多做/);
  assert.match(prompt, /写回/);
  assert.doesNotMatch(prompt, /You are the topmind/);
  assert.match(prompt, /edit_file|list_categories/);
});

test("buildSystemPrompt en uses English and omits Chinese-only shell copy", () => {
  const prompt = buildSystemPrompt({
    workspaceContext: { userWorkspaceRoot: "/tmp/ws" },
    writebackMode: "auto",
    skillsEnabled: false,
    locale: "en-US",
  });
  assert.match(prompt, /You are the topmind/i);
  assert.match(prompt, /Workspace:/);
  assert.match(prompt, /writeback|Writeback/i);
  assert.match(prompt, /Quality|Habits/i);
  assert.match(prompt, /edit_file/);
  assert.match(prompt, /list_categories/);
  // Chinese intro / focus shell should not appear
  assert.doesNotMatch(prompt, /你是 topmind 个人知识工作台助手/);
  assert.doesNotMatch(prompt, /## 焦点/);
  assert.doesNotMatch(prompt, /## 质量/);
  assert.doesNotMatch(prompt, /少问多做/);
});

test("buildSystemPrompt en confirm writeback is Model B English", () => {
  const prompt = buildSystemPrompt({
    writebackMode: "confirm",
    skillsEnabled: false,
    locale: "en",
  });
  assert.doesNotMatch(prompt, MODEL_A_FORBIDDEN_RE);
  assert.match(prompt, /ask before save|pending/i);
  assert.match(prompt, /write tools|save_file/i);
  assert.doesNotMatch(prompt, /保存前问我|待确认写入/);
});

test("buildSystemPrompt zh confirm still Chinese Model B", () => {
  const prompt = buildSystemPrompt({
    writebackMode: "confirm",
    skillsEnabled: false,
    locale: "zh-CN",
  });
  assert.doesNotMatch(prompt, MODEL_A_FORBIDDEN_RE);
  assert.match(prompt, /保存前问我|待确认写入/);
  assert.match(prompt, /write 工具|save_file/);
});

test("describeWritebackModeForPrompt bilingual", () => {
  const zhAuto = describeWritebackModeForPrompt("auto");
  const enAuto = describeWritebackModeForPrompt("auto", "en");
  const zhConfirm = describeWritebackModeForPrompt("confirm", "zh");
  const enConfirm = describeWritebackModeForPrompt("confirm", "en-US");

  assert.match(zhAuto, /自动保存|写回/);
  assert.match(enAuto, /auto-save|Writeback/i);
  assert.doesNotMatch(enAuto, /自动保存/);

  assert.match(zhConfirm, /保存前问我|待确认写入/);
  assert.match(enConfirm, /ask before save|pending/i);
  assert.doesNotMatch(enConfirm, /待确认写入/);
  assert.doesNotMatch(zhConfirm, MODEL_A_FORBIDDEN_RE);
  assert.doesNotMatch(enConfirm, MODEL_A_FORBIDDEN_RE);
});

test("getInlineSystem + INLINE_SYSTEM default zh", () => {
  assert.equal(INLINE_SYSTEM, getInlineSystem("zh"));
  assert.match(INLINE_SYSTEM, /你是 topmind 编辑器/);
  const en = getInlineSystem("en-US");
  assert.match(en, /You are the topmind editor/i);
  assert.match(en, /Polish|whole-document|Whole-document|format consistency/i);
  assert.doesNotMatch(en, /你是 topmind 编辑器/);
});

test("buildInlineCompletePrompt default zh polish markers", () => {
  const out = buildInlineCompletePrompt({
    text: "hello world sample text",
    mode: "rewrite",
    action: "polish",
    documentText: "# Title\n\n- a\n- b\n\nhello world sample text\n",
  });
  assert.match(out.system, /你是 topmind/);
  assert.match(out.prompt, /选中原文|请只输出改写结果|润色这段文字/);
  assert.doesNotMatch(out.prompt, /Selected text:|Output only the rewrite/);
});

test("buildInlineCompletePrompt en polish markers and default Polish instr", () => {
  const out = buildInlineCompletePrompt({
    text: "hello world sample text",
    mode: "rewrite",
    action: "polish",
    documentText: "# Title\n\n- a\n- b\n\nhello world sample text\n",
    locale: "en",
  });
  assert.match(out.system, /You are the topmind editor/i);
  assert.match(out.prompt, /Selected text:|Output only the rewrite|Polish this text/i);
  assert.match(out.prompt, /Whole-document format|Full document/i);
  assert.doesNotMatch(out.prompt, /选中原文|请只输出改写结果|润色这段文字/);
  assert.doesNotMatch(out.system, /你是 topmind 编辑器/);
});

test("buildInlineCompletePrompt en continue mode", () => {
  const out = buildInlineCompletePrompt({
    text: "Once upon a time",
    mode: "continue",
    locale: "en-US",
  });
  assert.match(out.prompt, /Output only the continuation|Preceding text/i);
  assert.doesNotMatch(out.prompt, /请只输出续写内容|上文（请接续/);
});

test("buildSystemPrompt states 3-tier output language and honors outputLocale", () => {
  const zh = buildSystemPrompt({ skillsEnabled: false, locale: "zh-CN" });
  assert.match(zh, /## 输出语言/);
  assert.match(zh, /本轮用户明确要求/);
  assert.match(zh, /正在处理的原文/);
  assert.match(zh, /workspace locale|topmind\.yaml/u);

  const enChromeZhOut = buildSystemPrompt({
    skillsEnabled: false,
    locale: "en-US",
    outputLocale: "zh",
  });
  assert.match(enChromeZhOut, /You are the topmind/i);
  assert.match(enChromeZhOut, /## Output language/);
  assert.match(enChromeZhOut, /Chinese/);
  assert.match(enChromeZhOut, /explicit language request/i);
  assert.doesNotMatch(enChromeZhOut, /你是 topmind 个人知识工作台助手/);
});

test("inline complete locale follows shipped 3-tier resolver, not workspace/UI", () => {
  const zhFromSource = resolveOutputLanguage({
    userText: "",
    sourceText: "今天把报告改完了，下午继续写结论。",
    contract: { workspace: { locale: "en-US" } },
  });
  assert.equal(zhFromSource, "zh");
  const zhOut = buildInlineCompletePrompt({
    text: "今天把报告改完了，下午继续写结论。",
    mode: "rewrite",
    action: "polish",
    locale: zhFromSource,
  });
  assert.match(zhOut.prompt, /选中原文|请只输出改写结果|润色这段文字/);
  assert.doesNotMatch(zhOut.prompt, /Selected text:|Output only the rewrite/);

  const enFromRequest = resolveOutputLanguage({
    userText: "用英语写",
    sourceText: "今天把报告改完了，下午继续写结论。",
    contract: { workspace: { locale: "zh-CN" } },
  });
  assert.equal(enFromRequest, "en");
  const enOut = buildInlineCompletePrompt({
    text: "今天把报告改完了，下午继续写结论。",
    mode: "rewrite",
    action: "polish",
    locale: enFromRequest,
  });
  assert.match(enOut.prompt, /Selected text:|Output only the rewrite/i);
});

test("ai-service durable path calls kernel resolveAgentOutputLanguage, not UI-first locale", () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../electron/ai-service.mjs"),
    "utf8",
  );
  assert.match(src, /resolveAgentOutputLanguage/);
  assert.match(src, /resolveDurableOutputLocale/);
  assert.match(src, /resolveChromeLocale/);
  assert.match(src, /complete\([\s\S]*resolveDurableOutputLocale/u);
  assert.match(src, /invoke\([\s\S]*resolveDurableOutputLocale/u);
  const durableStart = src.indexOf("async function resolveDurableOutputLocale");
  assert.ok(durableStart >= 0, "resolveDurableOutputLocale must exist");
  const after = src.slice(durableStart, durableStart + 2200);
  assert.match(after, /kernel\.resolveAgentOutputLanguage/);
  assert.doesNotMatch(after, /settings\?\.ui\.locale/);
  // invoke must not concatenate profile/overview/topicContext into source
  assert.doesNotMatch(src, /aiContext\.profile[\s\S]{0,80}sourceBlob|sourceBlob[\s\S]{0,120}aiContext\.profile/u);
  assert.doesNotMatch(src, /topicContext,\s*\n\s*aiContext\.profile/u);
});

test("Agent picker: English open note wins over Chinese profile; empty doc uses workspace", () => {
  const zhProfile = "我喜欢用中文写日记，目前在推进几个长期目标，周末会复盘。";
  const enNote = "Finished the report today, synced with the team, and will keep drafting tonight.";
  assert.equal(
    resolveAgentOutputLanguage({
      userText: "summarize this",
      focusPath: "note.md",
      mountedFiles: [{ name: "note.md", content: enNote }],
      profile: zhProfile,
      topicContext: "这是专题首页的中文说明文字。",
      contract: { workspace: { locale: "zh-CN" } },
    }),
    "en",
  );
  assert.equal(
    resolveAgentOutputLanguage({
      userText: "help me capture",
      mountedFiles: [],
      profile: zhProfile,
      contract: { workspace: { locale: "en-US" } },
    }),
    "en",
  );
});

test("getSkillPrompts / SKILL_PROMPTS locale", () => {
  assert.match(SKILL_PROMPTS.capture, /帮我收进/);
  assert.match(getSkillPrompts("zh").capture, /帮我收进/);
  const en = getSkillPrompts("en");
  assert.match(en.capture, /Help me capture/i);
  assert.match(en.organize, /organize/i);
  assert.doesNotMatch(en.write, /帮我写作/);
  // tool-ish skill ids stay load_skill + snake skill names
  assert.match(en.memory, /load_skill topmind-memory/);
});
