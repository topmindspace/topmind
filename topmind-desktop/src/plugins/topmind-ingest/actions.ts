/**
 * Ingest ActionSlots — command palette.
 * Labels resolved via i18n key (overlays:command.actions.*) by CommandPalette.
 */
import type { ActionSlot, PluginContext } from "../types";
import { api } from "../../services/api";
import { emitLocal } from "../host";
import { enqueueFromClipboardBatch, submitIngestBatch } from "../../lib/ingest-batch";

export function createIngestActions(ctx: PluginContext): ActionSlot[] {
  return [
    {
      kind: "action",
      id: "topmind-ingest.open",
      pluginId: "topmind-ingest",
      label: "Knowledge Ingest · Open",
      labelKey: "overlays:command.actions.ingestOpen",
      icon: "file-input",
      group: "ingest",
      order: 40,
      run: async () => {
        ctx.navigate({ kind: "connector", id: "ingest" });
      },
    },
    {
      kind: "action",
      id: "topmind-ingest.paste-clipboard",
      pluginId: "topmind-ingest",
      label: "Knowledge Ingest · Paste clipboard files",
      labelKey: "overlays:command.actions.ingestPaste",
      icon: "clipboard-paste",
      group: "ingest",
      order: 40.5,
      run: async () => {
        const r = await enqueueFromClipboardBatch({ dest: { mode: "inbox" } });
        if (r.status === "empty") {
          ctx.toast({ text: "No importable files in clipboard", kind: "error" });
          return;
        }
        if (r.status === "enqueued") {
          ctx.navigate({ kind: "connector", id: "ingest" });
          ctx.toast({ text: `Enqueued ${r.count} files from clipboard`, kind: "success" });
        } else if (r.status === "staging") {
          ctx.toast(`${r.count} items to confirm`);
        }
      },
    },
    {
      kind: "action",
      id: "topmind-ingest.open-float",
      pluginId: "topmind-ingest",
      label: "Capture · Open sticky note",
      labelKey: "overlays:command.actions.ingestFloat",
      icon: "sticky-note",
      group: "ingest",
      order: 39,
      run: async () => {
        await api.sys.openCaptureSurface({ mode: "float" });
      },
    },
    {
      kind: "action",
      id: "topmind-ingest.import-files",
      pluginId: "topmind-ingest",
      label: "Knowledge Ingest · Import files…",
      labelKey: "overlays:command.actions.ingestImportFiles",
      icon: "file-plus",
      group: "ingest",
      order: 41,
      run: async () => {
        const { paths } = await api.ingest.pickFiles();
        if (!paths.length) return;
        const r = await submitIngestBatch(paths, {
          dest: { mode: "inbox" },
          openQueue: true,
        });
        if (r.status === "enqueued") {
          ctx.navigate({ kind: "connector", id: "ingest" });
          ctx.toast({ text: `Enqueued ${r.count} files`, kind: "success" });
        } else if (r.status === "staging") {
          ctx.toast(`${r.count} items to confirm`);
        }
      },
    },
    {
      kind: "action",
      id: "topmind-ingest.import-folder",
      pluginId: "topmind-ingest",
      label: "Knowledge Ingest · Import folder…",
      labelKey: "overlays:command.actions.ingestImportFolder",
      icon: "folder-input",
      group: "ingest",
      order: 42,
      run: async () => {
        const { path: folder } = await api.ingest.pickFolder();
        if (!folder) return;
        const r = await submitIngestBatch([folder], {
          dest: { mode: "inbox" },
          openQueue: true,
        });
        if (r.status === "enqueued") {
          ctx.navigate({ kind: "connector", id: "ingest" });
          ctx.toast({ text: "Folder enqueued", kind: "success" });
        } else if (r.status === "staging") {
          ctx.toast(`${r.count} items to confirm`);
        }
        emitLocal("workspace:file-changed");
      },
    },
  ];
}
