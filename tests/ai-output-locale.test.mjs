/**
 * 3-tier output language — drives the shipped resolver (lib/ai-output-locale.mjs).
 * No re-implementation: every assertion calls resolveOutputLanguage / extract /
 * detect on the real module.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveOutputLanguage,
  resolveAiLocale,
  detectSourceScript,
  extractExplicitLanguageRequest,
  pickDocumentSourceForOutputLanguage,
  resolveAgentOutputLanguage,
  resolveProductAiLanguage,
} from "../lib/ai-output-locale.mjs";
import {
  resolveOutputLanguage as resolveFromSanitize,
  resolveAgentOutputLanguage as resolveAgentFromSanitize,
} from "../lib/ai-content-sanitize.mjs";
import { generateSuggestions } from "../lib/suggest-engine.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ZH_NOTE = "今天把报告改完了，下午和同事对了一下进度，晚上继续写结论。";
const EN_NOTE = "Finished the report today, synced with the team, and will keep drafting tonight.";
const ZH_PROFILE = "我喜欢用中文写日记，目前在推进几个长期目标，周末会复盘。";

describe("resolveOutputLanguage 3-tier policy", () => {
  it("sanitize re-export is the same shipped function", () => {
    assert.equal(resolveFromSanitize, resolveOutputLanguage);
    assert.equal(resolveAgentFromSanitize, resolveAgentOutputLanguage);
  });

  it("explicit request wins over source and workspace", () => {
    assert.equal(
      resolveOutputLanguage({
        userText: "用英语写这段总结",
        sourceText: ZH_NOTE,
        contract: { workspace: { locale: "zh-CN" } },
      }),
      "en",
    );
    assert.equal(
      resolveOutputLanguage({
        userText: "Please rewrite this in Chinese",
        sourceText: EN_NOTE,
        contract: { workspace: { locale: "en-US" } },
      }),
      "zh",
    );
    assert.equal(
      resolveOutputLanguage({
        userText: "translate to English",
        sourceText: ZH_NOTE,
        workspaceLocale: "zh-CN",
      }),
      "en",
    );
  });

  it("source-document language wins over workspace when there is no request", () => {
    assert.equal(
      resolveOutputLanguage({
        sourceText: ZH_NOTE,
        contract: { workspace: { locale: "en-US" } },
      }),
      "zh",
    );
    assert.equal(
      resolveOutputLanguage({
        sourceText: EN_NOTE,
        contract: { workspace: { locale: "zh-CN" } },
      }),
      "en",
    );
  });

  it("edited span beats the rest of the file", () => {
    assert.equal(
      resolveOutputLanguage({
        editedSpan: EN_NOTE,
        sourceText: ZH_NOTE,
        contract: { workspace: { locale: "zh-CN" } },
      }),
      "en",
    );
  });

  it("workspace locale is used when there is no request and no usable source", () => {
    assert.equal(
      resolveOutputLanguage({
        sourceText: "",
        contract: { workspace: { locale: "en-US" } },
      }),
      "en",
    );
    assert.equal(
      resolveOutputLanguage({
        sourceText: "OK",
        contract: { workspace: { locale: "zh-CN" } },
      }),
      "zh",
    );
    assert.equal(
      resolveOutputLanguage({
        contract: { locale: "en" },
      }),
      "en",
    );
    assert.equal(resolveOutputLanguage({}), "zh");
  });

  it("UI localeOverride is not a force on resolveAiLocale", () => {
    assert.equal(
      resolveAiLocale({ workspace: { locale: "zh-CN" } }, "en-US"),
      "zh",
    );
    assert.equal(
      resolveAiLocale({ workspace: { locale: "en-US" } }, "zh-CN"),
      "en",
    );
  });
});

describe("pickDocumentSourceForOutputLanguage / resolveAgentOutputLanguage", () => {
  it("uses the focused mounted note and ignores profile / overview / topicContext", () => {
    const picked = pickDocumentSourceForOutputLanguage({
      focusPath: "10-动态/note.md",
      mountedFiles: [{ name: "10-动态/note.md", content: EN_NOTE }],
      profile: ZH_PROFILE,
      overview: "类别概览：收件箱、动态、专题",
      topicContext: "这是专题首页的中文摘要和背景说明。",
      memoryProfile: ZH_PROFILE,
    });
    assert.equal(picked.editedSpan, EN_NOTE);
    assert.equal(picked.sourceText, EN_NOTE);
    assert.doesNotMatch(picked.sourceText, /长期目标|专题首页|类别概览/);

    assert.equal(
      resolveAgentOutputLanguage({
        userText: "summarize this please",
        focusPath: "10-动态/note.md",
        mountedFiles: [{ name: "10-动态/note.md", content: EN_NOTE }],
        profile: ZH_PROFILE,
        overview: "类别概览：收件箱、动态、专题",
        topicContext: "这是专题首页的中文摘要和背景说明。",
        contract: { workspace: { locale: "zh-CN" } },
      }),
      "en",
    );
  });

  it("no document + Chinese profile still follows en-US workspace locale", () => {
    const picked = pickDocumentSourceForOutputLanguage({
      mountedFiles: [],
      profile: ZH_PROFILE,
      overview: "类别概览：收件箱、动态、专题",
      topicContext: ZH_NOTE,
    });
    assert.equal(picked.editedSpan, "");
    assert.equal(picked.sourceText, "");

    assert.equal(
      resolveAgentOutputLanguage({
        userText: "help me capture an idea",
        mountedFiles: [],
        profile: ZH_PROFILE,
        overview: "类别概览：收件箱、动态、专题",
        topicContext: ZH_NOTE,
        contract: { workspace: { locale: "en-US" } },
      }),
      "en",
    );
  });

  it("inline-style editedSpan still wins when passed directly", () => {
    assert.equal(
      resolveAgentOutputLanguage({
        userText: "",
        editedSpan: EN_NOTE,
        sourceText: EN_NOTE,
        profile: ZH_PROFILE,
        contract: { workspace: { locale: "zh-CN" } },
      }),
      "en",
    );
  });
});

describe("extractExplicitLanguageRequest / detectSourceScript", () => {
  it("reads common explicit asks and ignores bare translate", () => {
    assert.equal(extractExplicitLanguageRequest("用英语写"), "en");
    assert.equal(extractExplicitLanguageRequest("in English please"), "en");
    assert.equal(extractExplicitLanguageRequest("用中文回复"), "zh");
    assert.equal(extractExplicitLanguageRequest("translate this"), null);
    assert.equal(extractExplicitLanguageRequest(""), null);
  });
});

describe("resolveProductAiLanguage (suggest / todo / ops)", () => {
  it("host UI locale wins over workspace and source-like extras", () => {
    assert.equal(
      resolveProductAiLanguage({
        uiLocale: "en-US",
        contract: { workspace: { locale: "zh-CN" } },
      }),
      "en",
    );
    assert.equal(
      resolveProductAiLanguage({
        uiLocale: "zh-CN",
        contract: { workspace: { locale: "en-US" } },
      }),
      "zh",
    );
  });

  it("auto / empty UI falls through to workspace", () => {
    assert.equal(
      resolveProductAiLanguage({
        uiLocale: "auto",
        contract: { workspace: { locale: "en-US" } },
      }),
      "en",
    );
    assert.equal(
      resolveProductAiLanguage({
        uiLocale: null,
        contract: { workspace: { locale: "zh-CN" } },
      }),
      "zh",
    );
  });

  it("explicit request still beats UI locale", () => {
    assert.equal(
      resolveProductAiLanguage({
        userText: "用中文回复",
        uiLocale: "en-US",
        contract: { workspace: { locale: "en-US" } },
      }),
      "zh",
    );
  });
});

describe("generateSuggestions follows host UI locale", () => {
  it("Desktop en-US + zh workspace yields English card chrome", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "suggest-ui-locale-"));
    try {
      for (const d of ["00-收件箱", "10-动态", "20-专题", "88-输出", "99-归档", "memory"]) {
        fs.mkdirSync(path.join(ws, d), { recursive: true });
      }
      fs.writeFileSync(
        path.join(ws, "topmind.yaml"),
        "contract_version: 4\nworkspace:\n  template: stream\n  locale: zh-CN\n",
        "utf8",
      );
      const cards = await generateSuggestions({
        workspaceRoot: ws,
        localeOverride: "en-US",
      });
      const open = cards.find((c) => c.kind === "open_profile");
      assert.ok(open, "expected open_profile card");
      assert.match(open.title, /Complete your profile/i);
      assert.doesNotMatch(open.title, /我的情况/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe("extractExplicitLanguageRequest / detectSourceScript", () => {
  it("detects CJK vs Latin and ignores URLs / fences", () => {
    assert.equal(detectSourceScript(ZH_NOTE), "zh");
    assert.equal(detectSourceScript(EN_NOTE), "en");
    assert.equal(
      detectSourceScript("```js\nconst x = 1;\n```\n\n今天完成了报告并且写了结论。"),
      "zh",
    );
    assert.equal(detectSourceScript("https://example.com/very-long-path"), null);
  });
});
