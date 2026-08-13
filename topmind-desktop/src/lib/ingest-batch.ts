/**
 * Unified knowledge-ingest pipeline entry.
 * All drop / pick / clipboard / capture-attachment paths should call submitIngestBatch.
 *
 * confirmBeforeConvert=false (default): auto enqueue path references.
 * confirmBeforeConvert=true: open staging sheet for select/exclude then enqueue.
 */
import i18n from "../locales";
import { api } from "../services/api";
import { emitLocal } from "../plugins/host";
import { useViewStore } from "../stores/view-store";
import { useIngestStagingStore, type IngestDest } from "../stores/ingest-staging-store";
import type { IngestBatchItem, IngestSettings } from "../types";

export type SubmitIngestResult =
  | { status: "enqueued"; jobIds: string[]; count: number }
  | { status: "staging"; count: number }
  | { status: "empty" }
  | { status: "cancelled" };

function isPlainNotePath(item: IngestBatchItem): boolean {
  const k = item.kind;
  if (k === "markdown" || k === "text") return true;
  const n = (item.name || "").toLowerCase();
  return n.endsWith(".md") || n.endsWith(".markdown") || n.endsWith(".txt");
}

async function resolveIngestSettings(): Promise<IngestSettings> {
  try {
    const st = await api.ingest.toolsStatus(false);
    if (st.settings) return st.settings as IngestSettings;
  } catch {
    /* fall through */
  }
  try {
    const app = await api.sys.settings();
    return {
      enabled: true,
      keepOriginal: false,
      maxFileBytes: 80_000_000,
      maxFolderFiles: 200,
      concurrency: 1,
      defaultDest: "inbox",
      preferExternalConverters: true,
      preferredConverter: "auto",
      autoConvert: true,
      confirmBeforeConvert: false,
      skipConfirmForSingleMd: true,
      openQueueOnEnqueue: false,
      ...(app.ingest || {}),
    };
  } catch {
    return {
      enabled: true,
      keepOriginal: false,
      maxFileBytes: 80_000_000,
      maxFolderFiles: 200,
      concurrency: 1,
      defaultDest: "inbox",
      preferExternalConverters: true,
      preferredConverter: "auto",
      autoConvert: true,
      confirmBeforeConvert: false,
      skipConfirmForSingleMd: true,
      openQueueOnEnqueue: false,
    };
  }
}

async function enqueuePaths(
  paths: string[],
  dest: IngestDest,
  openQueue: boolean,
): Promise<SubmitIngestResult> {
  if (!paths.length) return { status: "empty" };
  const res = await api.ingest.enqueue({
    items: paths.map((absolutePath) => ({ absolutePath })),
    dest,
  });
  emitLocal("workspace:file-changed");
  emitLocal("ingest:queue-changed");
  if (openQueue) {
    useViewStore.getState().select({ kind: "connector", id: "ingest" });
  }
  return {
    status: "enqueued",
    jobIds: res.jobIds || [],
    count: res.jobIds?.length || paths.length,
  };
}

/**
 * Submit absolute file/folder paths into the knowledge pipeline.
 */
export async function submitIngestBatch(
  paths: string[],
  opts?: {
    dest?: IngestDest;
    /** Force confirm sheet even if setting is off */
    forceConfirm?: boolean;
    /** Force auto-enqueue even if setting is on */
    forceAuto?: boolean;
    /** Navigate to hub after enqueue (overrides setting when set) */
    openQueue?: boolean;
  },
): Promise<SubmitIngestResult> {
  const unique = Array.from(
    new Set(
      (paths || [])
        .map((p) => String(p || "").trim())
        .filter(Boolean),
    ),
  );
  if (!unique.length) return { status: "empty" };

  const settings = await resolveIngestSettings();
  const dest: IngestDest =
    opts?.dest ||
    (settings.defaultDest === "topic" ? { mode: "inbox" } : { mode: "inbox" });

  const openQueue =
    typeof opts?.openQueue === "boolean"
      ? opts.openQueue
      : settings.openQueueOnEnqueue === true;

  let items: IngestBatchItem[] = [];
  let capped = false;
  try {
    const preview = await api.ingest.previewItems({ paths: unique });
    items = (preview.items || []).map((it) => ({
      ...it,
      selected: it.selected !== false && !it.warning?.includes("不存在"),
    }));
    capped = Boolean(preview.capped);
  } catch {
    items = unique.map((absolutePath) => {
      const name = absolutePath.split(/[/\\]/u).pop() || absolutePath;
      return {
        absolutePath,
        name,
        selected: true,
      };
    });
  }

  if (!items.length) return { status: "empty" };

  const confirm =
    opts?.forceAuto === true
      ? false
      : opts?.forceConfirm === true || settings.confirmBeforeConvert === true;

  // Single plain note shortcut when confirm is on
  if (
    confirm &&
    settings.skipConfirmForSingleMd !== false &&
    items.length === 1 &&
    isPlainNotePath(items[0])
  ) {
    return enqueuePaths([items[0].absolutePath], dest, openQueue);
  }

  if (!confirm) {
    const selected = items
      .filter((it) => it.selected !== false && !it.warning?.includes("不存在"))
      .map((it) => it.absolutePath);
    return enqueuePaths(selected, dest, openQueue);
  }

  useIngestStagingStore.getState().openBatch({ items, dest, capped });
  return { status: "staging", count: items.length };
}

/** Confirm staging selection → enqueue. */
export async function confirmIngestStaging(opts?: {
  /** After enqueue, open Knowledge Ingest hub (default true) */
  openQueue?: boolean;
}): Promise<SubmitIngestResult> {
  const state = useIngestStagingStore.getState();
  const paths = state.items
    .filter((it) => it.selected !== false && it.absolutePath)
    .map((it) => it.absolutePath);
  if (!paths.length) {
    state.setError(i18n.t("ingest:hub.noFilesError"));
    return { status: "empty" };
  }
  state.setBusy(true);
  state.setError(null);
  try {
    const openQueue = opts?.openQueue !== false;
    const result = await enqueuePaths(paths, state.dest, openQueue);
    state.close();
    // Float capture: also focus main hub (select alone is no-op in float renderer)
    if (openQueue) {
      try {
        const { api } = await import("../services/api");
        await api.sys.openIngestHub();
      } catch {
        /* main may already be focused */
      }
    }
    return result;
  } catch (e) {
    state.setError(e instanceof Error ? e.message : String(e));
    state.setBusy(false);
    throw e;
  }
}

export async function enqueueFromClipboardBatch(opts?: {
  dest?: IngestDest;
}): Promise<SubmitIngestResult> {
  const clip = await api.ingest.readClipboard();
  if (!clip.filePaths?.length) return { status: "empty" };
  return submitIngestBatch(clip.filePaths, {
    dest: opts?.dest || { mode: "inbox" },
    openQueue: true,
  });
}
