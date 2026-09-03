import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolsSrc = readFileSync(path.join(root, "electron/ai-tools.mjs"), "utf8");

test("ai-tools: delete_path pending note does not misleadingly suggest save_file", () => {
  // pendingDelete exists in both locales
  assert.match(toolsSrc, /pendingDelete:\s*"Ask-before-save: file deletion requires user confirmation/);
  assert.match(toolsSrc, /pendingDelete:\s*"保存前问我：删除操作已拦截/);

  // wrapWrite uses pendingDelete specifically when toolName is delete_path
  assert.match(
    toolsSrc,
    /toolName === "delete_path"\s*\?\s*writeCopy\.pendingDelete\s*:\s*\(result\.pendingId \? writeCopy\.pendingStashed : writeCopy\.pendingNoBody\)/,
  );
});
