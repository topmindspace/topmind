import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AiService } from "../electron/ai-service.mjs";
import { resolveWorkspaceStatePaths } from "../electron/lib/workspace-home.mjs";

test("real AiService light turn reaches a fully offline provider without workspace/tool prefetch", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "topmind-light-turn-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  const engineRoot = fileURLToPath(new URL("../../", import.meta.url));
  const workspaceStatePaths = resolveWorkspaceStatePaths(path.join(root, "state"), workspace);
  await mkdir(path.dirname(workspaceStatePaths.settingsFilePath), { recursive: true });
  await mkdir(path.join(workspace, "memory"), { recursive: true });
  await writeFile(path.join(workspace, "topmind.yaml"), "schema_version: 4\nlocale: en-US\n");
  await writeFile(path.join(workspace, "private.md"), "PRIVATE_FILE_CANARY");
  await writeFile(path.join(workspace, "memory", "profile.md"), "# Profile\n\n## Preferences\n\n- PROFILE_CANARY must remain outside this greeting.\n");
  await writeFile(workspaceStatePaths.settingsFilePath, JSON.stringify({
    theme: "light", writebackMode: "auto", ui: { locale: "en-US" },
    ai: { sourcePreference: "custom", defaultModel: "review-fixture", skillsEnabled: true,
      manual: { customBaseUrl: "https://offline-fixture.invalid/v1", customKey: "fixture-local-only" },
    },
  }));

  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(new URL(String(url)).hostname, "offline-fixture.invalid", "all network access must stay mocked");
    requests.push(JSON.parse(init.body));
    const chunk = (delta, finish_reason = null) => ({
      id: "offline-review", object: "chat.completion.chunk", created: 1, model: "review-fixture",
      choices: [{ index: 0, delta, finish_reason }],
    });
    const events = [chunk({ role: "assistant", content: "" }), chunk({ content: "Hello from the offline fixture." }), chunk({}, "stop")];
    const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  });
  const events = [];
  const result = await AiService.invoke({
    messages: [{ role: "user", content: "hello" }], sessionId: "offline-light", model: "custom/review-fixture",
    focusPath: "private.md", mountedFiles: ["private.md"],
  }, {
    engineRoot, workspaceRoot: { engineRoot, userWorkspaceRoot: workspace }, workspaceStatePaths,
    emit: (_event, payload) => events.push(payload),
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, "Hello from the offline fixture.");
  assert.equal(requests.length, 1);
  assert.equal((requests[0].tools || []).length, 0);
  assert.doesNotMatch(JSON.stringify(requests[0].messages), /PRIVATE_FILE_CANARY|PROFILE_CANARY|load_skill/u);
  assert.ok(events.some((event) => event.type === "text" && event.delta.includes("offline fixture")));
});

test("cancelling during preparation prevents the model from starting", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "topmind-preparing-cancel-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  const workspaceStatePaths = resolveWorkspaceStatePaths(path.join(root, "state"), workspace);
  t.mock.method(globalThis, "fetch", async () => assert.fail("a cancelled preparation must never reach a provider"));
  const run = AiService.invoke({ messages: [{ role: "user", content: "hello" }], sessionId: "cancel-preparing" }, {
    workspaceRoot: { userWorkspaceRoot: workspace }, workspaceStatePaths,
  }).then((result) => result, (error) => ({ error }));
  const cancel = await AiService.cancelStream({ sessionId: "cancel-preparing" });
  const result = await run;
  assert.equal(cancel.ok, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, true);
});
