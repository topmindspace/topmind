import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "../ui/select";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import type { AppSettings } from "../../types";
import { Field, SwitchField, SettingsSection } from "./fields";
import { ICON } from "../../lib/icons";
import { RotateCcw, Copy, RefreshCw } from "lucide-react";
import { Tooltip } from "../ui/tooltip";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { useActionStore } from "../../stores/action-store";
import { applyLocale } from "../../locales";

const WRITEBACK_HELP_KEY: Record<string, string> = {
  auto: "settings:general.writebackHelpAuto",
  confirm: "settings:general.writebackHelpConfirm",
};

const DEFAULT_UI = {
  sidebarWidth: 240,
  sidebarCollapsed: false,
  aiPanelOpen: true,
  aiPanelWidth: 360,
  sidebarView: "stream" as const,
  fileFilter: "default" as const,
  closeBehavior: "ask" as const,
};

const DEFAULT_EDITOR = {
  fontSize: 16,
  lineHeight: 1.7,
  fontFamily: "sans" as const,
  autoSaveMs: 1500,
  tabMode: "multi" as const,
  wordWrap: true,
  contentWidth: "reading" as const,
  pagePadding: "comfortable" as const,
  paper: "default" as const,
  inlineAiAutoPopup: true,
} as const;

export function GeneralPanel({
  settings,
  update,
  saving,
}: {
  settings: AppSettings;
  update: (p: Partial<AppSettings>) => void;
  saving: boolean;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const wb = settings.writebackMode || "auto";
  const ed = { ...DEFAULT_EDITOR, ...settings.editor };
  const ui = { ...DEFAULT_UI, ...settings.ui };
  const clip = {
    enabled: false,
    port: 19827,
    token: "",
    downloadImages: true,
    ...settings.clipBridge,
  };
  const [bridgeLive, setBridgeLive] = useState<{
    running: boolean;
    endpoint: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api.sys
      .clipBridgeStatus()
      .then((s) => setBridgeLive({ running: s.running, endpoint: s.endpoint }))
      .catch(() => setBridgeLive(null));
  }, [settings.clipBridge?.enabled, settings.clipBridge?.port, settings.clipBridge?.token]);

  const resetLayout = () => update({ ui: { ...DEFAULT_UI } });
  const resetEditor = () => update({ editor: { ...DEFAULT_EDITOR } });

  const copyToken = async () => {
    if (!clip.token) return;
    try {
      await navigator.clipboard.writeText(clip.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const rotateToken = async () => {
    try {
      const res = await api.sys.clipBridgeRotateToken();
      if (res.settings) update(res.settings);
    } catch {
      /* parent surfaces */
    }
  };

  return (
    <div>
      <SettingsSection title={t("settings:general.appearance")} description={t("settings:general.appearanceDesc")}>
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
          <Field label={t("settings:general.theme")} compact>
            <Select
              value={settings.theme}
              onChange={(e) => update({ theme: e.target.value as AppSettings["theme"] })}
              options={[
                { value: "auto", label: t("settings:general.themeAuto") },
                { value: "light", label: t("settings:general.themeLight") },
                { value: "dark", label: t("settings:general.themeDark") },
              ]}
            />
          </Field>
          <Field label={t("settings:general.defaultSidebar")} description={t("settings:general.defaultSidebarDesc")} compact>
            <Select
              value={ui.sidebarView || "stream"}
              onChange={(e) => update({ ui: { sidebarView: e.target.value } })}
              options={[
                { value: "stream", label: t("settings:general.sidebarStream") },
                { value: "category", label: t("settings:general.sidebarCategory") },
                { value: "timeline", label: t("settings:general.sidebarTimeline") },
                { value: "tags", label: t("settings:general.sidebarTags") },
                { value: "kanban", label: t("settings:general.sidebarKanban") },
              ]}
            />
          </Field>
          <Field label={t("settings:general.language")} description={t("settings:general.languageDesc")} compact>
            <Select
              value={ui.locale || "auto"}
              onChange={(e) => {
                const locale = e.target.value as "auto" | "zh-CN" | "en-US";
                // Partial ui delta only — do not re-send cached widths (would clobber shell resize).
                update({ ui: { locale } });
                applyLocale(locale);
              }}
              options={[
                { value: "auto", label: t("settings:general.languageAuto") },
                { value: "zh-CN", label: t("settings:general.languageZhCN") },
                { value: "en-US", label: t("settings:general.languageEnUS") },
              ]}
            />
          </Field>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-border-subtle-dim pt-2">
          <SwitchField
            label={t("settings:general.openAiPanel")}
            description={t("settings:general.openAiPanelDesc")}
            checked={ui.aiPanelOpen !== false}
            onChange={(aiPanelOpen) => update({ ui: { aiPanelOpen } })}
            className="mb-0 flex-1"
          />
          <Tooltip content={t("settings:general.resetLayoutTip", { sidebar: DEFAULT_UI.sidebarWidth, ai: DEFAULT_UI.aiPanelWidth })}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 text-3xs"
              onClick={resetLayout}
            >
              <RotateCcw size={ICON.micro} aria-hidden /> {t("settings:general.resetLayout")}
            </Button>
          </Tooltip>
        </div>
        <p className="mt-1 text-3xs text-text-quaternary">
          {t("settings:general.currentWidths", { sidebar: ui.sidebarWidth, ai: ui.aiPanelWidth })}
          {ui.sidebarCollapsed ? t("settings:general.sidebarCollapsed") : ""}
        </p>
      </SettingsSection>

      <SettingsSection
        title={t("settings:general.workspaceBrowse")}
        description={t("settings:general.workspaceBrowseDesc")}
      >
        <Field label={t("settings:general.fileFilter")} description={t("settings:general.fileFilterDesc")} compact>
          <Select
            value={ui.fileFilter || "default"}
            onChange={(e) =>
              update({ ui: { fileFilter: e.target.value as "default" | "markdown" | "all" } })
            }
            options={[
              { value: "default", label: t("settings:general.fileFilterDefault") },
              { value: "markdown", label: t("settings:general.fileFilterMarkdown") },
              { value: "all", label: t("settings:general.fileFilterAll") },
            ]}
          />
        </Field>
        <Field
          label={t("settings:general.closeWindow")}
          description={t("settings:general.closeWindowDesc")}
          compact
        >
          <Select
            value={ui.closeBehavior || "ask"}
            onChange={(e) =>
              update({
                ui: { closeBehavior: e.target.value as "ask" | "quit" | "hide" },
              })
            }
            options={[
              { value: "ask", label: t("settings:general.closeAsk") },
              { value: "hide", label: t("settings:general.closeHide") },
              { value: "quit", label: t("settings:general.closeQuit") },
            ]}
          />
        </Field>
      </SettingsSection>

      <SettingsSection
        title={t("settings:general.editorReading")}
        description={t("settings:general.editorReadingDesc")}
        action={
          <Tooltip content={t("settings:general.resetEditor")}>
            <Button type="button" variant="ghost" size="sm" className="h-6 text-3xs" onClick={resetEditor} aria-label={t("settings:general.resetEditor")}>
              <RotateCcw size={ICON.micro} aria-hidden />
            </Button>
          </Tooltip>
        }
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
          <Field label={t("settings:general.fontSize")} description={t("settings:general.fontSizeDesc")} compact>
            <Input
              type="number"
              min={12}
              max={24}
              value={ed.fontSize}
              onChange={(e) => update({ editor: { ...ed, fontSize: Number(e.target.value) } })}
            />
          </Field>
          <Field label={t("settings:general.lineHeight")} description={t("settings:general.lineHeightDesc")} compact>
            <Input
              type="number"
              step={0.1}
              min={1.2}
              max={2.5}
              value={ed.lineHeight}
              onChange={(e) => update({ editor: { ...ed, lineHeight: Number(e.target.value) } })}
            />
          </Field>
          <Field label={t("settings:general.fontFamily")} compact className="col-span-2 sm:col-span-1">
            <Select
              value={ed.fontFamily}
              onChange={(e) => update({ editor: { ...ed, fontFamily: e.target.value } })}
              options={[
                { value: "sans", label: t("settings:general.fontFamilySans") },
                { value: "serif", label: t("settings:general.fontFamilySerif") },
                { value: "mono", label: t("settings:general.fontFamilyMono") },
              ]}
            />
          </Field>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
          <Field
            label={t("settings:general.contentWidth")}
            description={t("settings:general.contentWidthDesc")}
            compact
          >
            <Select
              value={ed.contentWidth || "reading"}
              onChange={(e) => {
                const contentWidth = e.target.value as "compact" | "reading" | "wide" | "full";
                update({ editor: { ...ed, contentWidth } });
                const prev = useViewStore.getState().editorSettings;
                useViewStore.getState().setEditorSettings({ ...prev, contentWidth });
              }}
              options={[
                { value: "compact", label: t("settings:general.contentWidthCompact") },
                { value: "reading", label: t("settings:general.contentWidthReading") },
                { value: "wide", label: t("settings:general.contentWidthWide") },
                { value: "full", label: t("settings:general.contentWidthFull") },
              ]}
            />
          </Field>
          <Field label={t("settings:general.pagePadding")} description={t("settings:general.pagePaddingDesc")} compact>
            <Select
              value={ed.pagePadding || "comfortable"}
              onChange={(e) => {
                const pagePadding = e.target.value as "compact" | "comfortable" | "spacious";
                update({ editor: { ...ed, pagePadding } });
                const prev = useViewStore.getState().editorSettings;
                useViewStore.getState().setEditorSettings({ ...prev, pagePadding });
              }}
              options={[
                { value: "compact", label: t("settings:general.pagePaddingCompact") },
                { value: "comfortable", label: t("settings:general.pagePaddingComfortable") },
                { value: "spacious", label: t("settings:general.pagePaddingSpacious") },
              ]}
            />
          </Field>
          <Field label={t("settings:general.paper")} description={t("settings:general.paperDesc")} compact className="col-span-1 sm:col-span-2">
            <Select
              value={ed.paper || "default"}
              onChange={(e) => {
                const paper = e.target.value as "default" | "soft" | "paper" | "sepia";
                update({ editor: { ...ed, paper } });
                const prev = useViewStore.getState().editorSettings;
                useViewStore.getState().setEditorSettings({ ...prev, paper });
              }}
              options={[
                { value: "default", label: t("settings:general.paperDefault") },
                { value: "soft", label: t("settings:general.paperSoft") },
                { value: "paper", label: t("settings:general.paperPaper") },
                { value: "sepia", label: t("settings:general.paperSepia") },
              ]}
            />
          </Field>
          <Field label={t("settings:general.autoSave")} description={t("settings:general.autoSaveDesc")} compact>
            <Select
              value={String(ed.autoSaveMs ?? 1500)}
              onChange={(e) => update({ editor: { ...ed, autoSaveMs: Number(e.target.value) } })}
              options={[
                { value: "500", label: t("settings:general.autoSave05") },
                { value: "1000", label: t("settings:general.autoSave1") },
                { value: "1500", label: t("settings:general.autoSave15") },
                { value: "2500", label: t("settings:general.autoSave25") },
                { value: "5000", label: t("settings:general.autoSave5") },
              ]}
            />
          </Field>
          <div className="flex items-end pb-0.5">
            <SwitchField
              label={t("settings:general.wordWrap")}
              description={t("settings:general.wordWrapDesc")}
              checked={ed.wordWrap !== false}
              onChange={(wordWrap) => update({ editor: { ...ed, wordWrap } })}
              className="mb-0 w-full"
            />
          </div>
          <div className="flex items-end pb-0.5">
            <SwitchField
              label={t("settings:general.inlineAiAutoPopup")}
              description={t("settings:general.inlineAiAutoPopupDesc")}
              checked={ed.inlineAiAutoPopup !== false}
              onChange={(inlineAiAutoPopup) => {
                update({ editor: { ...ed, inlineAiAutoPopup } });
                const prev = useViewStore.getState().editorSettings;
                useViewStore.getState().setEditorSettings({ ...prev, inlineAiAutoPopup });
              }}
              className="mb-0 w-full"
            />
          </div>
          <Field label={t("settings:general.tabMode")} description={t("settings:general.tabModeDesc")} compact className="col-span-1 sm:col-span-2">
            <Select
              value={ed.tabMode === "single" ? "single" : "multi"}
              onChange={(e) => {
                const tabMode = e.target.value === "single" ? "single" : "multi";
                update({ editor: { ...ed, tabMode } });
                useViewStore.getState().setEditorTabMode(tabMode);
              }}
              options={[
                { value: "multi", label: t("settings:general.tabModeMulti") },
                { value: "single", label: t("settings:general.tabModeSingle") },
              ]}
            />
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings:general.writeback")} description={t("settings:general.writebackDesc")}>
        <Field label={t("settings:general.writebackMode")} compact>
          <Select
            value={wb}
            onChange={(e) => update({ writebackMode: e.target.value })}
            options={[
              { value: "auto", label: t("settings:general.writebackAuto") },
              { value: "confirm", label: t("settings:general.writebackConfirm") },
            ]}
          />
        </Field>
        <p className="mt-1.5 rounded-[var(--radius-md)] bg-surface-muted/50 px-2.5 py-1.5 text-3xs leading-relaxed text-text-tertiary">
          {t(WRITEBACK_HELP_KEY[wb] || WRITEBACK_HELP_KEY.auto)}
        </p>
        <SwitchField
          label={t("settings:general.autoPrepareSuggestions")}
          description={t("settings:general.autoPrepareSuggestionsDesc")}
          checked={settings.ai?.autoPrepareSuggestions !== false}
          disabled={saving}
          onChange={(autoPrepareSuggestions) => {
            update({
              ai: {
                ...settings.ai,
                autoPrepareSuggestions,
              },
            });
            // Absolute sync — Settings already persists via update(); skip second write
            void useActionStore.getState().setAutoPrepare(autoPrepareSuggestions, {
              persist: false,
            });
          }}
          className="mt-2"
        />
        <SwitchField
          label={t("settings:general.autoMaintainTodos")}
          description={t("settings:general.autoMaintainTodosDesc")}
          checked={settings.ai?.autoMaintainTodos === true}
          disabled={saving}
          onChange={(autoMaintainTodos) =>
            update({
              ai: {
                ...settings.ai,
                autoMaintainTodos,
              },
            })
          }
          className="mt-2"
        />
      </SettingsSection>

      <SettingsSection
        title={t("settings:general.clipBridge")}
        description={
          bridgeLive?.running
            ? t("settings:general.clipBridgeDescRunning", { endpoint: bridgeLive.endpoint || "127.0.0.1" })
            : t("settings:general.clipBridgeDescStopped")
        }
        help={t("settings:general.clipBridgeHelp")}
      >
        <SwitchField
          label={t("settings:general.clipBridgeEnable")}
          description={clip.enabled ? t("settings:general.clipBridgeEnableOn") : t("settings:general.clipBridgeEnableOff")}
          checked={clip.enabled}
          disabled={saving}
          onChange={(enabled) =>
            update({ clipBridge: { ...clip, enabled, token: clip.token || "" } })
          }
        />
        <SwitchField
          label={t("settings:general.clipDownloadImages")}
          description={t("settings:general.clipDownloadImagesDesc")}
          checked={clip.downloadImages !== false}
          disabled={saving || !clip.enabled}
          onChange={(downloadImages) =>
            update({ clipBridge: { ...clip, downloadImages } })
          }
        />
        <div className="mt-1 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-[100px_1fr]">
          <Field label={t("settings:general.clipPort")} description={t("settings:general.clipPortDesc")} compact>
            <Input
              type="number"
              min={1024}
              max={65535}
              value={clip.port}
              disabled={saving}
              onChange={(e) =>
                update({ clipBridge: { ...clip, port: Number(e.target.value) || 19827 } })
              }
            />
          </Field>
          <Field label={t("settings:general.clipToken")} compact>
            <div className="flex gap-1">
              <Input
                readOnly
                value={clip.token ? `${clip.token.slice(0, 10)}…` : "—"}
                className="min-w-0 flex-1 font-mono text-3xs"
              />
              <Tooltip content={copied ? t("common:action.copied") : t("settings:general.clipCopyToken")}>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0"
                  disabled={!clip.token}
                  onClick={() => void copyToken()}
                >
                  <Copy size={ICON.micro} />
                </Button>
              </Tooltip>
              <Tooltip content={t("settings:general.clipRotateToken")}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 shrink-0 p-0"
                  disabled={saving}
                  onClick={() => void rotateToken()}
                >
                  <RefreshCw size={ICON.micro} />
                </Button>
              </Tooltip>
            </div>
          </Field>
        </div>
        <ol className="mt-2 list-decimal space-y-1 rounded-[var(--radius-md)] border border-border-subtle bg-surface-muted/50 px-3.5 py-2 pl-7 text-3xs leading-relaxed text-text-secondary">
          <li>{t("settings:general.clipSteps1")}</li>
          <li>{t("settings:general.clipSteps2")}</li>
          <li>{t("settings:general.clipSteps3")}</li>
        </ol>
      </SettingsSection>

      <SettingsSection
        title={t("settings:general.captureTray")}
        description={t("settings:general.captureTrayDesc")}
        help={t("settings:general.captureTrayHelp")}
      >
        <Field label={t("settings:general.globalShortcut")} description={t("settings:general.globalShortcutDesc")}>
          <Select
            value={settings.capture?.globalMode || "float"}
            onChange={(e) =>
              update({
                capture: {
                  ...(settings.capture || {}),
                  globalMode: e.target.value as "float" | "overlay",
                },
              })
            }
            options={[
              { value: "float", label: t("settings:general.globalModeFloat") },
              { value: "overlay", label: t("settings:general.globalModeOverlay") },
            ]}
          />
        </Field>
        <SwitchField
          label={t("settings:general.trayIcon")}
          description={t("settings:general.trayIconDesc")}
          checked={settings.capture?.showTray !== false}
          onChange={(v) =>
            update({
              capture: { ...(settings.capture || {}), showTray: v },
            })
          }
        />
        <SwitchField
          label={t("settings:general.floatOnTop")}
          description={t("settings:general.floatOnTopDesc")}
          checked={settings.capture?.floatAlwaysOnTop !== false}
          onChange={(v) =>
            update({
              capture: { ...(settings.capture || {}), floatAlwaysOnTop: v },
            })
          }
        />
        <SwitchField
          label={t("settings:general.smartPaste")}
          description={t("settings:general.smartPasteDesc")}
          checked={settings.capture?.smartPaste !== false}
          onChange={(v) =>
            update({
              capture: { ...(settings.capture || {}), smartPaste: v },
            })
          }
        />
        <SwitchField
          label={t("settings:general.closeFloatOnSave")}
          description={t("settings:general.closeFloatOnSaveDesc")}
          checked={settings.capture?.closeFloatOnSave !== false}
          onChange={(v) =>
            update({
              capture: { ...(settings.capture || {}), closeFloatOnSave: v },
            })
          }
        />
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void api.sys.openCaptureSurface({ mode: "float" })}
          >
            {t("settings:general.tryFloat")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => useViewStore.getState().openOverlay("quick-capture")}
          >
            {t("settings:general.openCaptureLayer")}
          </Button>
        </div>
        <p className="text-3xs leading-relaxed text-text-quaternary">
          {t("settings:general.floatNote")}
        </p>
      </SettingsSection>

      <SettingsSection title={t("settings:general.shortcuts")} description={t("settings:general.shortcutsDesc")} help={t("settings:general.shortcutsHelp")}>
        <div className="grid grid-cols-1 gap-y-1 sm:grid-cols-2 sm:gap-x-4">
          {(
            [
              ["⌘N", t("settings:general.shortcutCapture")],
              ["⌘⇧N", t("settings:general.shortcutGlobalCapture")],
              ["⌘K / ⌘P", t("settings:general.shortcutCommand")],
              ["⌘,", t("settings:general.shortcutSettings")],
              ["⌘S", t("settings:general.shortcutSave")],
              ["⌘⇧I / O / A", t("settings:general.shortcutNav")],
              ["⌘⇧S", t("settings:general.shortcutStream")],
              ["⌘⇧T", t("settings:general.shortcutTodo")],
              ["⌘⇧B", t("settings:general.shortcutKanban")],
              ["⌘⌥F", t("settings:general.shortcutFocusMode")],
              ["⌘⇧J", t("settings:general.shortcutTaskPanel")],
              ["⌘[ / ⌘]", t("settings:general.shortcutHistory")],
              ["⌘⇧W", t("settings:general.shortcutWorkspaceSwitch")],
              ["⌘⌥W", t("settings:general.shortcutCloseAllTabs")],
            ] as const
          ).map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] py-0.5"
            >
              <kbd className="v4-kbd shrink-0 text-5xs">{k}</kbd>
              <span className="text-3xs text-text-quaternary">{v}</span>
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}
