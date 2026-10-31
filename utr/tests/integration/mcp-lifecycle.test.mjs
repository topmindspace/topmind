import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const server = path.join(root, "utr", "server", "topmind-mcp.mjs");

test("MCP child exits cleanly when its stdio transport closes", async () => {
  const child = spawn(process.execPath, [server, "--engine-root", root, "--workspace-root", root], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end();
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [code, signal] = await once(child, "exit");
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
    assert.doesNotMatch(stderr, /ReferenceError/u);
  } finally {
    clearTimeout(timeout);
  }
});
