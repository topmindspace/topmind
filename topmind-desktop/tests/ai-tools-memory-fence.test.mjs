import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isFencedMemoryPath,
  memoryFence,
  MEMORY_WRITE_TOOLS,
} from "../electron/lib/memory-fence.mjs";

describe("memory-plane fence", () => {
  test("isFencedMemoryPath: memory/ is fenced, ledgers/ is not", () => {
    assert.equal(isFencedMemoryPath("memory/profile/bio.md"), true);
    assert.equal(isFencedMemoryPath("memory/periodic/2026/W30.md"), true);
    assert.equal(isFencedMemoryPath("memory/topics/x.md"), true);
    assert.equal(isFencedMemoryPath("memory/todo.md"), true);
    assert.equal(isFencedMemoryPath("memory/ledgers/cash.md"), false);
    assert.equal(isFencedMemoryPath("memory/ledgers"), false);
    assert.equal(isFencedMemoryPath("10-动态/note.md"), false);
    assert.equal(isFencedMemoryPath(""), false);
    assert.equal(isFencedMemoryPath(undefined), false);
    // Windows separators normalize
    assert.equal(isFencedMemoryPath("memory\\profile\\bio.md"), true);
  });

  test("memoryFence checks EVERY path arg (copy_file dest cannot sneak past)", () => {
    // Source open, dest fenced — the old `||` short-circuit missed this.
    const viaDest = memoryFence("copy_file", {
      relativePath: "00-Inbox/src.md",
      destRelativePath: "memory/profile/stolen.md",
    });
    assert.equal(viaDest?.error, "write-blocked:memory-plane");

    // Source fenced, dest open
    const viaSrc = memoryFence("copy_file", {
      relativePath: "memory/profile/secret.md",
      destRelativePath: "10-动态/dump.md",
    });
    assert.equal(viaSrc?.error, "write-blocked:memory-plane");

    // move_to_topic inbox alias
    const viaInbox = memoryFence("move_to_topic", {
      inboxRelativePath: "memory/topics/alias.md",
      targetTopicId: "t1",
    });
    assert.equal(viaInbox?.error, "write-blocked:memory-plane");
  });

  test("memoryFence: memory tools and open planes pass", () => {
    for (const name of MEMORY_WRITE_TOOLS) {
      assert.equal(memoryFence(name, { relativePath: "memory/profile/bio.md" }), null, name);
    }
    assert.equal(
      memoryFence("save_file", { relativePath: "10-动态/note.md", content: "hi" }),
      null,
    );
    assert.equal(
      memoryFence("save_file", { relativePath: "memory/ledgers/cash.md", content: "hi" }),
      null,
      "ledgers/ is a sanctioned generic-write plane",
    );
    assert.equal(memoryFence("save_file", {}), null);
  });

  test("block note names the memory tools and the ledgers carve-out", () => {
    const res = memoryFence("save_file", { relativePath: "memory/profile/x.md" });
    assert.equal(res.ok, false);
    assert.equal(res.tool, "save_file");
    assert.match(res.note, /append_core_memory/);
    assert.match(res.note, /ledgers/);
  });
});
