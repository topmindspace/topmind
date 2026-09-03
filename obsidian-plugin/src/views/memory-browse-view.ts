// ── Memory browse: 我的情况 as a feed/card (profile + periodic + topic memory)

import { ItemView, WorkspaceLeaf, MarkdownRenderer, TFile, setIcon } from "obsidian";
import type TopmindPlugin from "../main";
import { t } from "../i18n";
import { VIEW_TYPE_MEMORY_BROWSE } from "../constants";
import {
  assembleMemoryFeed,
  filterMemoryFeedByLayer,
  isMemoryFeedLayer,
  type MemoryFeedItem,
  type MemoryFeedKind,
  type MemoryFeedLayer,
} from "../utils";

export class MemoryBrowseView extends ItemView {
  plugin: TopmindPlugin;
  /** Selected layer chip — survives re-render. */
  private layer: MemoryFeedLayer = "all";

  constructor(leaf: WorkspaceLeaf, plugin: TopmindPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_MEMORY_BROWSE;
  }

  getDisplayText(): string {
    return t("toolbar_btn_profile");
  }

  getIcon(): string {
    return "user";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
    /* no-op */
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  private cache = new Map<string, { mtime: number; content: string }>();

  private memoryDirRel(): string {
    const profile = this.plugin.kernelService.profileRelPath();
    const slash = profile.lastIndexOf("/");
    return slash > 0 ? profile.slice(0, slash) : "memory";
  }

  private async walkMdFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const exists = await this.app.vault.adapter.exists(dir);
      if (!exists) return results;
      const list = await this.app.vault.adapter.list(dir);
      for (const f of list.files) {
        if (f.endsWith(".md")) results.push(f.replace(/\\/g, "/"));
      }
      for (const sub of list.folders) {
        const subFiles = await this.walkMdFiles(sub);
        results.push(...subFiles);
      }
    } catch {
      /* ignore */
    }
    return results;
  }

  private async collectSources(): Promise<{
    profile: { path: string; markdown: string } | null;
    periodic: Array<{ path: string; markdown: string }>;
    topics: Array<{ path: string; markdown: string }>;
  }> {
    const memDir = this.memoryDirRel();
    const profilePath = this.plugin.kernelService.profileRelPath();
    // Scan within memory/ directory only — never enumerate whole vault
    const periodicFiles = await this.walkMdFiles(`${memDir}/periodic`);
    const topicFiles = await this.walkMdFiles(`${memDir}/topics`);

    const periodic: Array<{ path: string; markdown: string }> = [];
    const topics: Array<{ path: string; markdown: string }> = [];

    for (const p of periodicFiles) {
      if (/(?:^|\/)todo\.md$/iu.test(p)) continue;
      periodic.push({ path: p, markdown: "" });
    }
    for (const p of topicFiles) {
      if (/(?:^|\/)todo\.md$/iu.test(p)) continue;
      topics.push({ path: p, markdown: "" });
    }

    return {
      profile: profilePath ? { path: profilePath, markdown: "" } : null,
      periodic,
      topics,
    };
  }

  private async readFile(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const mtime = file.stat.mtime;
      const cached = this.cache.get(path);
      if (cached && cached.mtime === mtime) {
        return cached.content;
      }
      try {
        const content = await this.app.vault.cachedRead(file);
        this.cache.set(path, { mtime, content });
        return content;
      } catch {
        return "";
      }
    }
    return "";
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tm-memory-browse");
    const layout = this.plugin.settings.feedLayout === "card" ? "card" : "list";
    contentEl.setAttr("data-layout", layout);
    contentEl.setAttr("data-memory-feed", "true");

    const header = contentEl.createDiv({ cls: "tm-section-header" });
    header.createSpan({ text: t("toolbar_btn_profile"), cls: "tm-section-title" });
    const controls = header.createDiv({ cls: "tm-section-controls" });
    const organizeBtn = controls.createEl("button", { cls: "tm-btn-secondary" });
    setIcon(organizeBtn, "list-tree");
    organizeBtn.createSpan({ text: t("memory_browse_organize") });
    organizeBtn.setAttribute("aria-label", t("cmd_memory_organize"));
    organizeBtn.setAttribute("data-memory-organize", "true");
    organizeBtn.addEventListener("click", () => {
      this.plugin.enqueueAiOperation(
        "memory_organize",
        "op_label_memory_organize",
        "notice_memory_done",
        "all",
      );
    });
    const layers = contentEl.createDiv({ cls: "tm-feed-chrome" });
    layers.setAttr("data-feed-chrome", "true");
    layers.setAttr("role", "tablist");
    for (const [id, label] of [
      ["all", t("memory_browse_layer_all")],
      ["profile", t("memory_kind_profile")],
      ["periodic", t("memory_kind_periodic")],
      ["topic", t("memory_kind_topic")],
      ["history", t("memory_kind_history")],
    ] as const) {
      const chip = layers.createEl("button", { cls: "tm-btn-secondary tm-feed-layout-btn", text: label });
      chip.setAttr("data-memory-layer", id);
      const active = this.layer === id;
      chip.setAttr("aria-pressed", active ? "true" : "false");
      if (active) chip.setAttr("data-active", "true");
      chip.addEventListener("click", () => {
        if (!isMemoryFeedLayer(id)) return;
        this.layer = id;
        void this.render();
      });
    }
    this.renderLayoutToggle(layers);

    const collected = await this.collectSources();
    if (collected.profile) {
      collected.profile.markdown = await this.readFile(collected.profile.path);
    }
    for (const f of collected.periodic) f.markdown = await this.readFile(f.path);
    for (const f of collected.topics) f.markdown = await this.readFile(f.path);

    const items = assembleMemoryFeed(collected);
    const visible = filterMemoryFeedByLayer(items, this.layer);
    if (visible.length === 0) {
      const empty = contentEl.createDiv({ cls: "tm-empty-state" });
      empty.createDiv({ text: t("memory_browse_empty"), cls: "tm-empty-title" });
      empty.createDiv({ text: t("memory_browse_empty_hint"), cls: "tm-empty-hint" });
      return;
    }

    const feed = contentEl.createDiv({ cls: "tm-memory-feed" });
    feed.setAttr("data-layout", layout);
    for (const item of visible) {
      await this.renderItem(feed, item);
    }
  }

  private renderLayoutToggle(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: "tm-feed-layout-toggle" });
    wrap.setAttr("data-feed-layout-toggle", "true");
    wrap.setAttr("role", "group");
    wrap.setAttr("aria-label", t("feed_layout_toggle"));
    const current = this.plugin.settings.feedLayout === "card" ? "card" : "list";
    for (const id of ["list", "card"] as const) {
      const btn = wrap.createEl("button", {
        cls: "tm-btn-secondary tm-feed-layout-btn",
        text: id === "list" ? t("feed_layout_list") : t("feed_layout_card"),
      });
      btn.setAttr("data-layout-option", id);
      if (current === id) btn.setAttr("data-active", "true");
      btn.addEventListener("click", async () => {
        this.plugin.settings.feedLayout = id;
        await this.plugin.saveSettings();
        await this.render();
      });
    }
  }

  private kindLabel(item: MemoryFeedItem): string {
    if (item.history) return t("memory_kind_history");
    if (item.kind === "periodic") return t("memory_kind_periodic");
    if (item.kind === "topic") return t("memory_kind_topic");
    return t("memory_kind_profile");
  }

  private async renderItem(container: HTMLElement, item: MemoryFeedItem): Promise<void> {
    const card = container.createDiv({ cls: "tm-card tm-memory-card" });
    card.setAttr("data-memory-feed-item", "true");
    card.setAttr("data-memory-path", item.path);
    card.setAttr("data-memory-kind", item.kind);
    const header = card.createDiv({ cls: "tm-card-header" });
    const icon = header.createSpan({ cls: "tm-card-time-icon" });
    setIcon(icon, item.kind === "periodic" ? "calendar" : item.kind === "topic" ? "folder" : "user");
    const firstLine = (item.body || "").split("\n").find((l) => l.trim()) || "";
    const firstPlain = firstLine
      .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/u, "")
      .replace(/^\s*\d+\.\s+/u, "")
      .replace(/^#{1,6}\s+/u, "")
      .trim();
    const titleDupesBody = Boolean(item.title) && firstPlain === item.title;
    if (!titleDupesBody && item.title) {
      header.createSpan({ text: item.title, cls: "tm-card-time" });
    }
    if (item.heading && item.heading !== item.title) {
      header.createSpan({ text: item.heading, cls: "tm-card-tag" });
    }
    header.createSpan({ text: this.kindLabel(item), cls: "tm-card-tag" });
    const openBtn = header.createEl("button", {
      cls: "tm-card-action-btn",
      attr: { "aria-label": t("stream_open_in_editor"), title: t("stream_open_in_editor") },
    });
    setIcon(openBtn, "pencil");
    openBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      void this.app.workspace.openLinkText(item.path, "", false);
    });
    card.addEventListener("click", () => {
      void this.app.workspace.openLinkText(item.path, "", false);
    });
    const body = card.createDiv({ cls: "tm-card-body" });
    const md = String(item.body || "").trim() || item.preview;
    if (md) {
      try {
        await MarkdownRenderer.render(this.app, md.slice(0, 1600), body, item.path, this);
      } catch {
        body.textContent = md;
      }
    }
  }
}
