import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/tooltip";
import { HelpTip } from "../settings/fields";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";
import type { LucideIcon } from "lucide-react";

/** Visible page subtitle under tab title (everyday guidance). */
const TAB_DESC_KEYS: Record<string, string> = {
  general: "settings:tabDesc.general",
  workspace: "settings:tabDesc.workspace",
  ai: "settings:tabDesc.ai",
  skills: "settings:tabDesc.skills",
  tools: "settings:tabDesc.tools",
  plugins: "settings:tabDesc.plugins",
  manage: "settings:tabDesc.manage",
  "topmind-ingest.settings": "settings:tabDesc.topmind-ingest.settings",
  "topmind-weread.settings": "settings:tabDesc.topmind-weread.settings",
  "topmind-x.settings": "settings:tabDesc.topmind-x.settings",
};

/** Deep / rare help behind tip only. */
const TAB_HELP_KEYS: Record<string, string> = {
  general: "settings:tabHelp.general",
  workspace: "settings:tabHelp.workspace",
  ai: "settings:tabHelp.ai",
  skills: "settings:tabHelp.skills",
  tools: "settings:tabHelp.tools",
  plugins: "settings:tabHelp.plugins",
  manage: "settings:tabHelp.manage",
  "topmind-ingest.settings": "settings:tabHelp.topmind-ingest.settings",
  "topmind-weread.settings": "settings:tabHelp.topmind-weread.settings",
  "topmind-x.settings": "settings:tabHelp.topmind-x.settings",
};

export interface SettingsTabItem {
  id: string;
  label: string;
  icon: LucideIcon;
  order: number;
  group: string;
}

interface SettingsLayoutProps {
  tabs: SettingsTabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  children: ReactNode;
}

/** Settings chrome: left nav + header + close + scroll container (presentation only). */
export function SettingsLayout({
  tabs,
  activeTab,
  onTabChange,
  saving,
  error,
  onClose,
  children,
}: SettingsLayoutProps) {
  const { t } = useTranslation(["settings", "common"]);
  /** Filter left nav — lowers scan cost across 环境/智能体/扩展/管理与更新 */
  const [navQuery, setNavQuery] = useState("");

  const activeMeta = tabs.find((t) => t.id === activeTab);

  const qNav = navQuery.trim().toLowerCase();
  const filteredTabs = qNav
    ? tabs.filter((tab) => {
        const hay = `${tab.label} ${tab.group} ${t(TAB_DESC_KEYS[tab.id] || "")}`.toLowerCase();
        return hay.includes(qNav);
      })
    : tabs;

  // Group labels for nav (环境 / 智能体 / 扩展 / 管理与更新)
  const navItems: Array<{ type: "group"; label: string } | { type: "tab"; tab: SettingsTabItem }> = [];
  let lastGroup = "";
  for (const tab of filteredTabs) {
    const g = tab.group || "";
    if (g && g !== lastGroup) {
      navItems.push({ type: "group", label: g });
      lastGroup = g;
    }
    navItems.push({ type: "tab", tab });
  }

  const pageDesc =
    t(TAB_DESC_KEYS[activeTab] || "") ||
    (activeMeta?.group ? `${activeMeta.group}` : t("common:action.autoSave"));
  const pageHelp = TAB_HELP_KEYS[activeTab] ? t(TAB_HELP_KEYS[activeTab]) : undefined;

  /** Workspace / AI / Skills need a wider content column so nested lists aren't truncated. */
  const wideContent =
    activeTab === "workspace" ||
    activeTab === "ai" ||
    activeTab === "skills" ||
    activeTab === "plugins" ||
    activeTab === "manage";

  return (
    <div
      className="v4-overlay-sheet v4-settings-dialog flex h-[min(860px,94vh)] w-[min(1040px,96vw)] overflow-hidden"
      data-settings-dialog
    >
      <Tabs value={activeTab} onValueChange={onTabChange} className="flex w-full min-h-0">
        <TabsList
          className="v4-sidebar-scroll v4-settings-nav m-2.5 mr-0 flex h-auto w-[176px] shrink-0 flex-col items-stretch gap-0.5 self-stretch overflow-y-auto rounded-[var(--radius-lg)] border border-border-subtle-dim bg-app-chrome/50 p-1.5 shadow-none ring-0"
          data-settings-nav
        >
          <div className="mb-1.5 shrink-0 px-0.5">
            <input
              type="search"
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder={t("settings:filterPlaceholder")}
              aria-label={t("settings:filterLabel")}
              className="h-7 w-full rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface px-2 text-3xs text-text-primary outline-none placeholder:text-text-quaternary focus-visible:border-accent-color focus-visible:ring-2 focus-visible:ring-ring/35"
            />
          </div>
          {navItems.length === 0 ? (
            <div className="px-2 py-3 text-center text-3xs text-text-quaternary">{t("common:action.noResults")}</div>
          ) : (
            navItems.map((item, i) =>
              item.type === "group" ? (
                <div
                  key={`g-${item.label}-${i}`}
                  className="mb-0.5 mt-2 px-2 pt-0.5 text-3xs font-medium tracking-wide text-text-quaternary first:mt-0.5"
                  data-settings-nav-group
                >
                  {item.label}
                </div>
              ) : (
                <TabsTrigger
                  key={item.tab.id}
                  value={item.tab.id}
                  className="h-8 justify-start gap-1.5 rounded-[var(--radius-md)] px-2 text-3xs text-text-secondary data-[state=active]:bg-surface-elevated data-[state=active]:font-semibold data-[state=active]:text-text-primary data-[state=active]:shadow-[var(--shadow-card)] data-[state=active]:ring-1 data-[state=active]:ring-border-subtle-dim"
                >
                  <item.tab.icon size={ICON.xs} className="shrink-0 opacity-70" /> {item.tab.label}
                </TabsTrigger>
              ),
            )
          )}
        </TabsList>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border-subtle-dim bg-surface-elevated">
          <div
            className="flex shrink-0 items-start justify-between gap-3 border-b border-border-subtle-dim bg-[var(--color-dialog-header)] px-4 py-2.5"
            data-settings-header
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <div className="text-sm font-semibold tracking-tight text-text-primary">
                  {activeMeta?.label || t("settings:title")}
                </div>
                {pageHelp ? <HelpTip content={pageHelp} /> : null}
              </div>
              <p className="mt-0.5 text-3xs leading-snug text-text-quaternary">{pageDesc}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
              {saving ? (
                <span className="inline-flex items-center gap-1 text-3xs text-accent-color" role="status">
                  <Loader2 size={ICON.micro} className="animate-spin" aria-hidden /> {t("common:action.saving")}
                </span>
              ) : (
                <span className="text-3xs text-text-quaternary">{t("common:action.autoSave")}</span>
              )}
              <Tooltip content={`${t("common:action.close")} (Esc)`}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={onClose}
                >
                  <X size={ICON.xs} />
                </Button>
              </Tooltip>
            </div>
          </div>
          <div
            className="v4-content-scroll min-h-0 flex-1 overflow-auto overscroll-contain bg-background/40 px-3.5 py-3 sm:px-5"
            data-settings-content
          >
            {error ? (
              <div className="mb-2.5 rounded-[var(--radius-md)] border border-error/20 bg-status-error-bg px-2.5 py-1.5 text-3xs text-error">
                {error}
              </div>
            ) : null}
            <div
              key={activeTab}
              className={cn("mx-auto w-full", wideContent ? "max-w-2xl" : "max-w-xl")}
            >
              {children}
            </div>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
