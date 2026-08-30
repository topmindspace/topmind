import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Bot, FolderTree, Loader2, Puzzle, BookOpen, Twitter, Sparkles, Terminal, FileInput, Boxes, Plug, Stethoscope } from "lucide-react";
import i18n from "../../locales";
import { useViewStore } from "../../stores/view-store";
import { useRegistry } from "../../plugins/registry";
import { ICON } from "../../lib/icons";
import type { LucideIcon } from "lucide-react";
import { GeneralPanel } from "../settings/GeneralPanel";
import { AiProviderPanel } from "../settings/AiProviderPanel";
import { WorkspacePanel } from "../settings/WorkspacePanel";
import { ManageAboutPanel, ManageIntegrationsPanel, ManageDiagnosticsPanel, ManagePanel } from "../settings/ManagePanel";
import { PluginsPanel } from "../settings/PluginsPanel";
import { SkillsPanel } from "../settings/SkillsPanel";
import { ToolsPanel } from "../settings/ToolsPanel";
import { SettingsLayout, type SettingsTabItem } from "./SettingsLayout";
import { useSettingsController } from "./useSettingsController";
import { setOverlayCloseGuard } from "../../lib/overlay-close-guard";

/** Icon map for settings slots that use string icon names. */
const SLOT_ICON_MAP: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  twitter: Twitter,
  "file-input": FileInput,
};

/** Panel id → settings.json top-level sections it renders (for content search). */
const PANEL_SEARCH_KEYS: Record<string, string[]> = {
  general: ["general"],
  workspace: ["workspace"],
  ai: ["ai", "chatInput"],
  skills: ["skills"],
  tools: ["tools"],
  plugins: ["plugins"],
  about: ["about"],
  integrations: ["manage", "companions"],
  diagnostics: ["env", "about"],
};

function collectPanelStrings(topKeys: string[]): string[] {
  try {
    const bundle = i18n.getResourceBundle(i18n.language || "zh-CN", "settings") as
      | Record<string, unknown>
      | undefined;
    if (!bundle) return [];
    const out: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") {
        if (v) out.push(v);
      } else if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (v && typeof v === "object") {
        Object.values(v).forEach(walk);
      }
    };
    for (const k of topKeys) walk(bundle[k]);
    return out;
  } catch {
    return [];
  }
}

export function SettingsDialog() {
  const { t } = useTranslation(["settings", "common"]);
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const overlayContext = useViewStore((s) => s.overlayContext);
  const [activeTab, setActiveTab] = useState(overlayContext?.topicId || "general");

  const settingsSlots = useRegistry((s) => s.settingsSlots);
  const { settings, saving, error, update, flushPending } = useSettingsController();

  useEffect(() => {
    if (overlayContext?.topicId) setActiveTab(overlayContext.topicId);
  }, [overlayContext]);

  // Route every close path (Esc, scrim click, shortcut navigation) through the
  // flush-then-close order — only the X button did this before, so the other
  // paths could drop the debounced batch's side effects.
  useEffect(() => {
    setOverlayCloseGuard(async () => {
      await flushPending();
    });
    return () => setOverlayCloseGuard(null);
  }, [flushPending]);

  /** Nav metadata only — never pre-create panel JSX (keeps open + auto-save snappy). */
  const tabs = useMemo<SettingsTabItem[]>(() => {
    // IA: 环境 → 智能体 → 扩展 → 管理与更新
    const builtin: SettingsTabItem[] = [
      { id: "general", label: t("settings:tabs.general"), icon: Settings, order: 0, group: t("settings:groups.environment") },
      { id: "workspace", label: t("settings:tabs.workspace"), icon: FolderTree, order: 10, group: t("settings:groups.environment") },
      { id: "ai", label: t("settings:tabs.ai"), icon: Bot, order: 20, group: t("settings:groups.agent") },
      { id: "skills", label: t("settings:tabs.skills"), icon: Sparkles, order: 25, group: t("settings:groups.agent") },
      { id: "tools", label: t("settings:tabs.tools"), icon: Terminal, order: 30, group: t("settings:groups.agent") },
      { id: "plugins", label: t("settings:tabs.plugins"), icon: Puzzle, order: 40, group: t("settings:groups.extensions") },
    ];
    // Panel-content search: flatten the panel's settings.json sections so the
    // nav filter reaches section titles/descriptions, not just page names.
    const attachKeywords = (tab: SettingsTabItem, topKeys: string[]): SettingsTabItem => ({
      ...tab,
      keywords: collectPanelStrings(topKeys),
    });
    const builtinWithSearch = builtin.map((tab) => {
      const keys = PANEL_SEARCH_KEYS[tab.id];
      return keys ? attachKeywords(tab, keys) : tab;
    });
    const dynamic = settingsSlots.map((slot) => ({
      id: slot.id,
      label: slot.labelKey ? t(slot.labelKey) : slot.label,
      icon: SLOT_ICON_MAP[slot.icon ?? ""] ?? Puzzle,
      order: 50 + (slot.order ?? 100),
      group: t("settings:groups.extensions"),
    }));
    const footer = [
      { id: "about", label: t("settings:tabs.about"), icon: Boxes, order: 990, group: t("settings:groups.manage") },
      { id: "integrations", label: t("settings:tabs.integrations"), icon: Plug, order: 991, group: t("settings:groups.manage") },
      { id: "diagnostics", label: t("settings:tabs.diagnostics"), icon: Stethoscope, order: 992, group: t("settings:groups.manage") },
    ];
    const footerWithSearch = footer.map((tab) => {
      const keys = PANEL_SEARCH_KEYS[tab.id];
      return keys ? attachKeywords(tab, keys) : tab;
    });
    return [...builtinWithSearch, ...dynamic, ...footerWithSearch].sort((a, b) => a.order - b.order);
  }, [settingsSlots]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === activeTab)) setActiveTab("general");
  }, [tabs, activeTab]);

  /** Mount only the active panel — inactive tabs stay unmounted. */
  const renderActivePanel = () => {
    if (!settings) return null;
    switch (activeTab) {
      case "general":
        return <GeneralPanel settings={settings} update={update} saving={saving} />;
      case "workspace":
        return <WorkspacePanel settings={settings} />;
      case "ai":
        return <AiProviderPanel settings={settings} update={update} saving={saving} />;
      case "skills":
        return <SkillsPanel settings={settings} onPatch={update} />;
      case "tools":
        return <ToolsPanel settings={settings} />;
      case "plugins":
        return <PluginsPanel settings={settings} update={update} />;
      case "manage":
        // Legacy deep-link target — render everything
        return <ManagePanel settings={settings} update={update} />;
      case "about":
        return <ManageAboutPanel settings={settings} update={update} />;
      case "integrations":
        return <ManageIntegrationsPanel settings={settings} update={update} />;
      case "diagnostics":
        return <ManageDiagnosticsPanel settings={settings} update={update} />;
      default: {
        const slot = settingsSlots.find((s) => s.id === activeTab);
        if (slot) {
          return slot.render({
            settings,
            update: update as (patch: Record<string, unknown>) => void,
          });
        }
        return null;
      }
    }
  };

  if (!settings) {
    return (
      <div
        className="v4-overlay-sheet flex h-[min(480px,70vh)] w-[min(720px,90vw)] items-center justify-center gap-2.5 text-text-tertiary"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings:title")}
      >
        <Loader2 size={ICON.md} className="animate-spin text-accent-color/70" />
        <span className="text-sm">{t("common:status.loading")}</span>
      </div>
    );
  }

  return (
    <SettingsLayout
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      saving={saving}
      error={error}
      onClose={() => {
        // Await the debounced batch before unmount — fire-and-forget here could
        // lose the last edit if the app quits right after the dialog closes.
        void (async () => {
          await flushPending();
          closeOverlay();
        })();
      }}
    >
      {renderActivePanel()}
    </SettingsLayout>
  );
}
