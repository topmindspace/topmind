import test from "node:test";
import assert from "node:assert/strict";

import { validateCommandPayload, normalizeCommandPayload } from "../../core/contract-validator.mjs";

// v3.4 mock command definitions aligned to current contract structure
const createTopicCmd = {
  label: "创建专题",
  group: "workflow",
  risk_level: "medium",
  review_policy: "preview_or_auto",
  requires_topic: false,
  idempotent: false,
  inputs: {
    category: { type: "category", label: "大类", required: true },
    topic: { type: "topic", label: "专题", required: true },
    title: { type: "text", label: "专题首页标题（可选）" },
  },
};

const archiveTopicCmd = {
  label: "归档专题",
  group: "danger",
  risk_level: "high",
  review_policy: "preview_or_auto",
  requires_topic: true,
  idempotent: false,
  destructive: true,
  inputs: {
    category: { type: "category", label: "大类", required: true },
    topic: { type: "topic", label: "专题", required: true },
    reason: { type: "text", label: "归档理由", required: true },
  },
};

const captureNoteCmd = {
  label: "捕获笔记",
  group: "atomic",
  risk_level: "low",
  review_policy: "preview_or_auto",
  idempotent: true,
  inputs: {
    routing: { type: "category-and-topic", label: "路由", required: true },
    title: { type: "text", label: "标题", required: true },
    content: { type: "textarea", label: "内容", required: true },
    sourceType: {
      type: "select", label: "来源类型", required: true, default: "user-original",
      options: [
        { value: "user-original", label: "用户手写" },
        { value: "ai-derived", label: "AI 分析/提取" },
        { value: "external-capture", label: "外部抓取" },
      ],
    },
  },
};

const saveOutputCmd = {
  label: "保存输出",
  group: "assistive",
  risk_level: "low",
  review_policy: "auto",
  idempotent: true,
  inputs: {
    category: { type: "category", label: "大类", required: true },
    topic: { type: "topic", label: "专题", required: true },
    title: { type: "text", label: "标题", required: true },
    content: { type: "textarea", label: "内容", required: true },
    count: { type: "number", label: "字数", default: 5, min: 1, max: 20 },
  },
};

// --- Validation tests ---

test("validateCommandPayload returns empty for valid payload", () => {
  const errors = validateCommandPayload(createTopicCmd, {
    category: "20 研究",
    topic: "2026-示例记录",
  });
  assert.deepEqual(errors, []);
});

test("validateCommandPayload detects missing required field", () => {
  const errors = validateCommandPayload(createTopicCmd, {});
  assert.ok(errors.length >= 1);
  assert.ok(errors.some((e) => e.includes("缺少必需参数")));
  assert.ok(errors.some((e) => e.includes("大类")));
});

test("validateCommandPayload detects invalid select value", () => {
  const errors = validateCommandPayload(captureNoteCmd, {
    routing: { category: "20 研究" },
    title: "Test",
    content: "Body",
    sourceType: "invalid-source-type",
  });
  assert.ok(errors.length >= 1);
  assert.ok(errors.some((e) => e.includes("无效值")));
  assert.ok(errors.some((e) => e.includes("invalid-source-type")));
});

test("validateCommandPayload accepts valid select value", () => {
  const errors = validateCommandPayload(captureNoteCmd, {
    routing: { category: "20 研究" },
    title: "Test",
    content: "Body",
    sourceType: "external-capture",
  });
  assert.deepEqual(errors, []);
});

test("validateCommandPayload accepts localized topic names used by topic folders", () => {
  const errors = validateCommandPayload(createTopicCmd, {
    category: "20 研究",
    topic: "2026-示例创作",
  });
  assert.deepEqual(errors, []);
});

test("validateCommandPayload detects invalid category format", () => {
  const errors = validateCommandPayload(createTopicCmd, {
    category: "研究/2026-with-slash",
    topic: "2026-示例专题",
  });
  // The CATEGORY_PATTERN rejects characters outside letter/number/space/chinese/dash, like /
  assert.ok(errors.length >= 1);
  assert.ok(errors.some((e) => e.includes("大类")));
});

test("validateCommandPayload detects invalid topic format", () => {
  const errors = validateCommandPayload(createTopicCmd, {
    category: "20 研究",
    topic: "../escape",
  });
  assert.ok(errors.some((e) => e.includes("专题")));
});

test("validateCommandPayload detects number out of range", () => {
  const errors = validateCommandPayload(saveOutputCmd, {
    category: "20 研究",
    topic: "2026-示例专题",
    title: "Test",
    content: "Body",
    count: 999,
  });
  assert.ok(errors.some((e) => e.includes("最大值")));
});

test("validateCommandPayload accepts valid number", () => {
  const errors = validateCommandPayload(saveOutputCmd, {
    category: "20 研究",
    topic: "2026-示例专题",
    title: "Test",
    content: "Body",
    count: 10,
  });
  assert.deepEqual(errors, []);
});

// --- Normalization tests ---

test("normalizeCommandPayload trims text fields", () => {
  const result = normalizeCommandPayload(createTopicCmd, {
    category: "  20 研究  ",
    topic: "2026-示例记录  ",
    title: "  示例标题  ",
  });
  assert.equal(result.category, "20 研究");
  assert.equal(result.topic, "2026-示例记录");
  assert.equal(result.title, "示例标题");
});

test("normalizeCommandPayload coerces number fields from string", () => {
  const result = normalizeCommandPayload(saveOutputCmd, {
    category: "20 研究",
    topic: "2026-示例专题",
    title: "Test",
    content: "Body",
    count: "8",
  });
  assert.equal(result.count, 8);
});

test("normalizeCommandPayload applies defaults for missing fields", () => {
  const result = normalizeCommandPayload(saveOutputCmd, {
    category: "20 研究",
    topic: "2026-示例专题",
    title: "Test",
    content: "Body",
  });
  assert.equal(result.count, 5); // default from fixture
});

test("normalizeCommandPayload normalizes path-like fields", () => {
  const cmd = {
    inputs: {
      sourcePath: { type: "path", label: "笔记路径", required: true },
    },
  };
  const result = normalizeCommandPayload(cmd, {
    sourcePath: "\\notes\\demo\\note.md",
  });
  assert.equal(result.sourcePath, "notes/demo/note.md");
});

test("normalizeCommandPayload preserves kind and command", () => {
  const result = normalizeCommandPayload(createTopicCmd, {
    kind: "workspace-write",
    command: "create-topic",
    category: "20 研究",
    topic: "2026-test",
  });
  assert.equal(result.kind, "workspace-write");
  assert.equal(result.command, "create-topic");
});

test("normalizeCommandPayload trims category-and-topic routing", () => {
  const result = normalizeCommandPayload(captureNoteCmd, {
    routing: { category: "  20 研究  ", topic: "  2026-示例专题  " },
    title: "Test",
    content: "Body",
  });
  assert.equal(result.routing.category, "20 研究");
  assert.equal(result.routing.topic, "2026-示例专题");
});