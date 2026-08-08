import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Bot, FolderTree, Info, Loader2, Puzzle, BookOpen, Twitter, Sparkles, Terminal, FileInput, Link2 } from "lucide-react";
import { useViewStore } from "../../stores/view-store";
import { useRegistry } from "../../plugins/registry";
import { ICON } from "../../lib/icons";
import type { LucideIcon } from "lucide-react";
import { GeneralPanel } from "../settings/GeneralPanel";
import { AiProviderPanel } from "../settings/AiProviderPanel";
import { WorkspacePanel } from "../settings/WorkspacePanel";
import { AboutPanel } from "../settings/AboutPanel";
import { PluginsPanel } from "../settings/PluginsPanel";
import { SkillsPanel } from "../settings/SkillsPanel";
import { ToolsPanel } from "../settings/ToolsPanel";
import { CompanionsPanel } from "../settings/CompanionsPanel";
import { SettingsLayout, type SettingsTabItem } from "./SettingsLayout";
import { useSettingsController } from "./useSettingsController";

/** Icon map for settings slots that use string icon names. */
const SLOT_ICON_MAP: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  twitter: Twitter,
  "file-input": FileInput,
};

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

  /** Nav metadata only — never pre-create panel JSX (keeps open + auto-save snappy). */
  const tabs = useMemo<SettingsTabItem[]>(() => {
    // IA: 环境 → 智能体 → 扩展 → 关于
    const builtin: SettingsTabItem[] = [
      { id: "general", label: t("settings:tabs.general"), icon: Settings, order: 0, group: t("settings:groups.environment") },
      { id: "workspace", label: t("settings:tabs.workspace"), icon: FolderTree, order: 10, group: t("settings:groups.environment") },
      { id: "ai", label: t("settings:tabs.ai"), icon: Bot, order: 20, group: t("settings:groups.agent") },
      { id: "skills", label: t("settings:tabs.skills"), icon: Sparkles, order: 25, group: t("settings:groups.agent") },
      { id: "tools", label: t("settings:tabs.tools"), icon: Terminal, order: 30, group: t("settings:groups.agent") },
      { id: "plugins", label: t("settings:tabs.plugins"), icon: Puzzle, order: 40, group: t("settings:groups.extensions") },
      { id: "companions", label: t("settings:tabs.companions"), icon: Link2, order: 45, group: t("settings:groups.extensions") },
    ];
    const dynamic = settingsSlots.map((slot) => ({
      id: slot.id,
      label: slot.labelKey ? t(slot.labelKey) : slot.label,
      icon: SLOT_ICON_MAP[slot.icon ?? ""] ?? Puzzle,
      order: 50 + (slot.order ?? 100),
      group: t("settings:groups.extensions"),
    }));
    const footer = [{ id: "about", label: t("settings:tabs.about"), icon: Info, order: 990, group: t("settings:groups.about") }];
    return [...builtin, ...dynamic, ...footer].sort((a, b) => a.order - b.order);
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
      case "companions":
        return <CompanionsPanel settings={settings} />;
      case "about":
        return <AboutPanel settings={settings} />;
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
      <div className="v4-overlay-sheet flex h-[min(480px,70vh)] w-[min(720px,90vw)] items-center justify-center gap-2.5 text-text-tertiary">
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
        void flushPending();
        closeOverlay();
      }}
    >
      {renderActivePanel()}
    </SettingsLayout>
  );
}
