import test from "node:test";
import assert from "node:assert/strict";

import { buildMcpToolSchema } from "../../server/tool-mapper.mjs";

test("MCP schema does not expose conflicting dryRun default when writebackMode controls writes", () => {
  const schema = buildMcpToolSchema({
    contract: {
      kind: "workspace-write",
      label: "项目写入工具",
      description: "测试工具",
    },
    commandName: "capture-note",
    command: {
      label: "捕获笔记",
      description: "保存材料。",
      supports_dry_run: true,
      inputs: {
        title: { type: "text", label: "标题", required: true },
        writebackMode: {
          type: "select",
          label: "保存设置",
          default: "auto",
          options: [
            { value: "auto", label: "自动保存并返回回执" },
            { value: "confirm", label: "需要审阅" },
          ],
        },
        dryRun: { type: "toggle", label: "仅预览", default: true },
      },
    },
  });

  assert.equal(schema.inputSchema.properties.writebackMode.default, "auto");
  assert.equal("default" in schema.inputSchema.properties.dryRun, false);
  assert.match(schema.inputSchema.properties.dryRun.description, /省略时按保存设置处理/u);
  assert.match(schema.inputSchema.properties.dryRun.description, /自动保存|审阅入口/u);
  assert.doesNotMatch(schema.inputSchema.properties.dryRun.description, /写回模式决定|auto 直接写入|confirm 进入审阅/u);
});
