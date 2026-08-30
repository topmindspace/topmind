/**
 * topmind Skills Dock — 5 ActionSlots (`group: "skill"`).
 *
 * Product boundary: all actions use Desktop WorkspaceService only.
 * No UTR hard dependency. Portable Skills pack remains independent
 * (agent hosts run Markdown skills with host file tools).
 *
 * Capture: QuickCapture → Inbox. Memory: QuickCapture → Stable Memory.
 * Organize: open topic overview (native list). Loop: native workspaceHealth.
 * Write: ensure topic.md exists (never overwrite), then open it.
 *
 * Surfaces in Command Palette (⌘K). Failures throw for visible errors.
 */
import type { ActionSlot } from "../types";
import type { Selection } from "../../types";
import i18n from "../../locales";

/** Split a topicId ("10 分类/2024-主题") into category + topic. */
function splitTopicId(topicId: string): { category: string; topic: string } {
  const slash = topicId.indexOf("/");
  if (slash < 0) return { category: "", topic: topicId };
  return { category: topicId.slice(0, slash), topic: topicId.slice(slash + 1) };
}

/** Resolve the topicId a selection belongs to, if any. */
function topicIdOf(sel: Selection): string | undefined {
  if (sel.kind === "topic") return sel.topicId;
  if (sel.kind === "file") return sel.topicId;
  return undefined;
}

/**
 * Create skill action slots.
 * The `lang` parameter is kept for backward compatibility but is no longer
 * used — i18n is resolved from the active locale at call time.
 */
export function createSkillActions(_lang?: "zh" | "en"): ActionSlot[] {
  return [
    {
      kind: "action",
      id: "skill.capture",
      label: "Note it — full capture",
      labelKey: "workspace:skills.capture",
      shortcut: "⌘N",
      group: "skill",
      order: 100,
      run: (ctx) => {
        ctx.events.emit("overlay:open", { kind: "quick-capture" });
      },
    },
    {
      kind: "action",
      id: "skill.organize",
      label: "Organize — open current topic",
      labelKey: "workspace:skills.organize",
      group: "skill",
      order: 110,
      available: (sel) => sel.kind === "topic" || (sel.kind === "file" && Boolean(sel.topicId)),
      async run(ctx, sel) {
        const topicId = topicIdOf(sel);
        if (!topicId) return;
        const topic = (await ctx.rpc.invoke("workspace.getTopic", { topicId })) as {
          topicId?: string;
          files?: { name: string }[];
        };
        const files = topic?.files || [];
        const md = files.filter((f) => /\.md$/iu.test(f.name)).length;
        const hasTopic = files.some((f) => f.name === "topic.md");
        const topicText = i18n.t(hasTopic ? "workspace:skills.hasTopic" : "workspace:skills.noTopic");
        ctx.toast({ text: i18n.t("workspace:skills.organizeToast", { files: files.length, md, project: topicText }), kind: "success" });
        ctx.events.emit("navigate:select", { kind: "topic", topicId });
        ctx.events.emit("workspace:file-changed", { topicId });
      },
    },
    {
      kind: "action",
      id: "skill.write",
      label: "Write — open topic home",
      labelKey: "workspace:skills.write",
      group: "skill",
      order: 120,
      available: (sel) => sel.kind === "topic" || (sel.kind === "file" && Boolean(sel.topicId)),
      async run(ctx, sel) {
        const topicId = topicIdOf(sel);
        if (!topicId) return;
        const topicPath = `${topicId}/topic.md`;
        try {
          await ctx.rpc.invoke("workspace.readPath", { relativePath: topicPath });
        } catch {
          const { topic } = splitTopicId(topicId);
          await ctx.rpc.invoke("workspace.saveNote", {
            topicId,
            filename: "topic.md",
            content: `# ${topic}\n\n`,
            sourceType: "user-original",
          });
          ctx.events.emit("workspace:file-changed", { topicId });
        }
        ctx.events.emit("navigate:select", { kind: "file", path: topicPath, topicId });
      },
    },
    {
      kind: "action",
      id: "skill.memory",
      label: "Topic memory — append",
      labelKey: "workspace:skills.memory",
      group: "skill",
      order: 130,
      available: (sel) =>
        sel.kind === "topic" || (sel.kind === "file" && Boolean(sel.topicId)),
      run: (ctx, sel) => {
        const topicId =
          sel.kind === "topic" ? sel.topicId : sel.kind === "file" ? sel.topicId : undefined;
        if (!topicId) return;
        ctx.events.emit("overlay:open", { kind: "quick-capture", intent: "memory", topicId });
      },
    },
    {
      kind: "action",
      id: "skill.loop",
      label: "Loop — workspace health",
      labelKey: "workspace:skills.loop",
      group: "skill",
      order: 140,
      async run(ctx) {
        const res = (await ctx.rpc.invoke("workspace.workspaceHealth", {})) as {
          ok?: boolean;
          summary?: {
            categoryCount?: number;
            topicCount?: number;
            looseNoteCount?: number;
            errorCount?: number;
            warningCount?: number;
          };
          issues?: { severity: string; code?: string; message: string; path?: string }[];
        };
        const s = res?.summary;
        const errN = s?.errorCount ?? res?.issues?.filter((i) => i.severity === "error").length ?? 0;
        const warnN = s?.warningCount ?? 0;
        ctx.events.emit("overlay:open", {
          kind: "loop-report",
          loopReport: {
            ...res,
            ranAt: new Date().toISOString(),
          },
        });
        if (errN > 0) {
          ctx.toast(
            i18n.t("workspace:skills.loopToast", {
              categories: s?.categoryCount ?? 0,
              topics: s?.topicCount ?? 0,
              warnings: warnN ? i18n.t("workspace:skills.warningsCount", { count: warnN }) : "",
            }),
          );
        } else {
          ctx.toast(
            i18n.t("workspace:skills.loopToast", {
              categories: s?.categoryCount ?? 0,
              topics: s?.topicCount ?? 0,
              warnings: warnN ? i18n.t("workspace:skills.warningsCount", { count: warnN }) : "",
            }),
          );
        }
        ctx.events.emit("workspace:file-changed");
      },
    },
  ];
}
