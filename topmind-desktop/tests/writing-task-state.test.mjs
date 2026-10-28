import test from "node:test";
import assert from "node:assert/strict";
import { writingTaskBlocker } from "../src/plugins/topmind-wechat/writing-task-state.ts";

const ready = {
  sourcePath: "drafts/article.md",
  sourceLoading: false,
  sourceError: "",
  aiBusy: false,
  skillsEnabled: true,
  enabledSkillIds: null,
  actionId: "topmind-revise",
};

test("writing task starts only with a loaded Markdown source and an available skill", () => {
  assert.equal(writingTaskBlocker(ready), null);
  assert.equal(writingTaskBlocker({ ...ready, sourcePath: "" }), "source");
  assert.equal(writingTaskBlocker({ ...ready, sourcePath: "drafts/image.png" }), "source");
  assert.equal(writingTaskBlocker({ ...ready, sourceLoading: true }), "loading");
  assert.equal(writingTaskBlocker({ ...ready, sourceError: "missing" }), "source-error");
  assert.equal(writingTaskBlocker({ ...ready, aiBusy: true }), "ai-busy");
  assert.equal(writingTaskBlocker({ ...ready, sessionError: true }), "session-error");
  assert.equal(writingTaskBlocker({ ...ready, skillsEnabled: false }), "skills-off");
  assert.equal(writingTaskBlocker({ ...ready, enabledSkillIds: ["topmind-format"] }), "skill-off");
  assert.equal(writingTaskBlocker({ ...ready, enabledSkillIds: ["topmind-revise"] }), null);
});
