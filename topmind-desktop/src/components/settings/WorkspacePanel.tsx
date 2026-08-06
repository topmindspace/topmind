import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Plus,
  FolderOpen,
  ArrowRight,
  LogOut,
  AlertTriangle,
  X,
  RefreshCw,
  Eye,
  EyeOff,
  Pencil,
} from "lucide-react";
import { api } from "../../services/api";
import { emitLocal } from "../../plugins/host";
import { useViewStore } from "../../stores/view-store";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/select";
import { Tooltip } from "../ui/tooltip";
import { ICON } from "../../lib/icons";
import type { AppSettings } from "../../types";
import { Field, SettingsSection } from "./fields";

type CategoryRow = {
  slot: string;
  name: string;
  directory: string;
  role: string;
  specialBehavior?: string;
  source?: string;
  hidden?: boolean;
  ok?: boolean;
};

const ROLE_KEYS: Record<string, string> = {
  "deep-work": "settings:workspace.roleDeepWork",
  "loose-stream": "settings:workspace.roleLooseStream",
  fallback: "settings:workspace.roleFallback",
  reference: "settings:workspace.roleReference",
  buffer: "settings:workspace.roleBuffer",
  delivery: "settings:workspace.roleDelivery",
  system: "settings:workspace.roleSystem",
};

const VIEW_KEYS: Record<string, string> = {
  stream: "settings:workspace.viewsStream",
  category: "settings:workspace.viewsCategory",
  timeline: "settings:workspace.viewsTimeline",
  tags: "settings:workspace.viewsTags",
  kanban: "settings:workspace.viewsKanban",
};

const SYSTEM_ROLES = new Set(["buffer", "delivery", "system"]);

export function WorkspacePanel({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation(["settings", "common"]);
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [separator, setSeparator] = useState("-");
  const [template, setTemplate] = useState("stream");
  const [streamPacking, setStreamPacking] = useState("weekly");
  const [memoryProfile, setMemoryProfile] = useState("");
  const [memoryDir, setMemoryDir] = useState("");
  const [memoryFilesText, setMemoryFilesText] = useState("");
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [recent, setRecent] = useState(settings.workspaces?.recent ?? []);
  const [newName, setNewName] = useState("");
  const [newSlot, setNewSlot] = useState("");
  const [newRole, setNewRole] = useState("deep-work");
  const [showAdd, setShowAdd] = useState(false);
  const [renameSlot, setRenameSlot] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [enabledViews, setEnabledViews] = useState<string[]>(["stream", "category", "timeline", "tags", "kanban"]);
  const [defaultView, setDefaultView] = useState("stream");
  const [wereadCat, setWereadCat] = useState("auto");
  const [xCat, setXCat] = useState("auto");

  const reloadConfig = useCallback(async () => {
    const cfg = await api.sys.getWorkspaceConfig();
    setSeparator(cfg.categorySeparator);
    setTemplate(cfg.template);
    setStreamPacking(cfg.stream?.packing || "weekly");
    setMemoryProfile(cfg.memory?.profileFile || "");
    setMemoryDir(cfg.memory?.dir || "");
    setMemoryFilesText((cfg.memory?.files || []).join(", "));
    setCategories(
      (cfg.categories || []).map((c) => ({
        slot: c.slot,
        name: c.name,
        directory: c.directory,
        role: c.role,
        specialBehavior: c.specialBehavior,
        source: c.source,
        hidden: c.hidden,
        ok: c.ok,
      })),
    );
    if (cfg.views?.enabled?.length) setEnabledViews(cfg.views.enabled);
    if (cfg.views?.default) setDefaultView(cfg.views.default);
    const cd = cfg.connectorDefaults as Record<string, { syncCategory?: string }> | undefined;
    setWereadCat(cd?.weread?.syncCategory || "auto");
    setXCat(cd?.x?.syncCategory || "auto");
  }, []);

  useEffect(() => {
    void reloadConfig().catch(() => {});
  }, [reloadConfig]);

  const handleSeparatorChange = async (nextSep: string) => {
    setSwitching("configuring");
    setError(null);
    try {
      setSeparator(nextSep);
      await api.sys.updateWorkspaceConfig({ categorySeparator: nextSep });
      closeOverlay();
      setTimeout(() => window.location.reload(), 150);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitching(null);
    }
  };

  const persistViewsAndConnectors = async (patch: {
    views?: { default: string; enabled: string[] };
    connectorDefaults?: Record<string, { syncCategory: string }>;
  }) => {
    setSwitching("configuring");
    setError(null);
    try {
      await api.sys.updateWorkspaceConfig(patch);
      await reloadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitching(null);
    }
  };

  const handleRoleChange = async (slot: string, role: string) => {
    setSwitching(`role:${slot}`);
    setError(null);
    try {
      await api.sys.updateCategory({ slot, role });
      await reloadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitching(null);
    }
  };

  const handleToggleHidden = async (slot: string, hidden: boolean) => {
    setSwitching(`hide:${slot}`);
    setError(null);
    try {
      await api.sys.updateCategory({ slot, hidden });
      await reloadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitching(null);
    }
  };

  const handleRename = async (slot: string) => {
    if (!renameValue.trim()) {
      setError(t("settings:workspace.renameDesc"));
      return;
    }
    setSwitching(`rename:${slot}`);
    setError(null);
    try {
      await api.sys.renameCategory({ slot, newName: renameValue.trim() });
      setRenameSlot(null);
      setRenameValue("");
      await reloadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitching(null);
    }
  };

  const handleAddCategory = async () => {
    if (!newName.trim()) {
      setError(t("settings:workspace.categoryName"));
      return;
    }
    setSwitching("adding");
    setError(null);
    try {
      let slot = newSlot.trim();
      if (!slot) {
        const sug = await api.sys.suggestCategorySlot();
        slot = sug.slot;
      }
      await api.sys.createCategory({
        slot,
        name: newName.trim(),
        role: newRole,
        specialBehavior: newRole === "loose-stream" ? "flat-default" : undefined,
      });
      setNewName("");
      setNewSlot("");
      setNewRole("deep-work");
      setShowAdd(false);
      await reloadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitching(null);
    }
  };

  const handleRebuildMap = async () => {
    setSwitching("map");
    setError(null);
    try {
      const res = await api.sys.rebuildWorkspaceMap();
      setError(null);
      // reuse error line as soft success? better as transient note
      await reloadConfig();
      emitLocal("toast:show", t("settings:workspace.rebuildToast", { path: res.path }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitching(null);
    }
  };

  const handleSwitch = async (rootPath: string) => {
    setSwitching(rootPath);
    setError(null);
    try {
      await api.sys.switchWorkspace(rootPath, { createIfMissing: false });
      closeOverlay();
      setTimeout(() => window.location.reload(), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRecent((prev) => prev.filter((w) => w.rootPath !== rootPath));
    } finally {
      setSwitching(null);
    }
  };

  const handleRemove = async (rootPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSwitching(`rm:${rootPath}`);
    setError(null);
    try {
      const res = await api.sys.removeRecentWorkspace(rootPath);
      setRecent(res.settings?.workspaces?.recent ?? recent.filter((w) => w.rootPath !== rootPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSwitching(null);
    }
  };

  const handlePickNew = async () => {
    setSwitching("picking");
    setError(null);
    try {
      const { path } = await api.sys.pickWorkspaceFolder();
      if (!path) {
        setSwitching(null);
        return;
      }
      await api.sys.openOrCreateWorkspace(path);
      closeOverlay();
      setTimeout(() => window.location.reload(), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitching(null);
    }
  };

  const handleCloseWorkspace = async () => {
    setSwitching("closing");
    setError(null);
    try {
      await api.sys.closeWorkspace();
      closeOverlay();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSwitching(null);
    }
  };

  const categoryDirOptions = [
    { value: "auto", label: t("settings:workspace.connectorAuto") },
    ...categories
      .filter((c) => c.ok !== false && !SYSTEM_ROLES.has(c.role))
      .map((c) => ({ value: c.directory, label: c.directory })),
  ];

  const toggleView = (id: string) => {
    const next = enabledViews.includes(id)
      ? enabledViews.filter((v) => v !== id)
      : [...enabledViews, id];
    // Always keep at least category
    const ensured = next.includes("category") ? next : ["category", ...next];
    setEnabledViews(ensured);
    const def = ensured.includes(defaultView) ? defaultView : ensured[0];
    setDefaultView(def);
    void persistViewsAndConnectors({ views: { default: def, enabled: ensured } });
  };

  return (
    <div>
      <SettingsSection
        title={t("settings:workspace.currentTitle")}
        description={t("settings:workspace.currentDesc")}
        help={t("settings:workspace.currentHelp")}
      >
        <Field label={t("settings:workspace.pathLabel")} description={t("settings:workspace.pathDesc")} compact>
          <Input
            value={settings.workspaceRoot || "（未打开 · Landing）"}
            readOnly
            className="font-mono text-3xs"
          />
        </Field>

        <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
          <Field label={t("settings:workspace.templateLabel")} description={t("settings:workspace.templateDesc")} compact>
            <Input value={template} readOnly className="font-mono text-3xs" />
          </Field>
          <Field
            label={t("settings:workspace.separatorLabel")}
            description={t("settings:workspace.separatorDesc")}
            compact
          >
            <Select
              value={separator}
              disabled={!!switching}
              onChange={(e) => void handleSeparatorChange(e.target.value)}
              options={[
                { value: "-", label: t("settings:workspace.separatorDash") },
                { value: " ", label: t("settings:workspace.separatorSpace") },
              ]}
            />
          </Field>
          <Field
            label={t("settings:workspace.streamPackingLabel")}
            description={t("settings:workspace.streamPackingDesc")}
            compact
          >
            <Select
              value={streamPacking}
              disabled={!!switching}
              onChange={(e) => {
                const packing = e.target.value;
                setStreamPacking(packing);
                void (async () => {
                  setSwitching("configuring");
                  setError(null);
                  try {
                    await api.sys.updateWorkspaceConfig({
                      stream: { packing, appendHeading: "day" },
                    });
                    await reloadConfig();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSwitching(null);
                  }
                })();
              }}
              options={[
                { value: "weekly", label: t("settings:workspace.packingWeekly") },
                { value: "daily", label: t("settings:workspace.packingDaily") },
                { value: "monthly", label: t("settings:workspace.packingMonthly") },
                { value: "atom", label: t("settings:workspace.packingAtom") },
              ]}
            />
          </Field>
          <Field
            label={t("settings:workspace.memoryProfileLabel")}
            description={t("settings:workspace.memoryProfileDesc")}
            compact
          >
            <Input
              value={memoryProfile}
              disabled={!!switching}
              className="font-mono text-3xs"
              onChange={(e) => setMemoryProfile(e.target.value)}
              onBlur={() => {
                const profileFile = memoryProfile.trim() || "我的情况.md";
                void (async () => {
                  setSwitching("configuring");
                  try {
                    await api.sys.updateWorkspaceConfig({
                      memory: {
                        dir: memoryDir.trim() || null,
                        profileFile,
                        files: memoryFilesText
                          .split(/[,，]/u)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    });
                    await reloadConfig();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSwitching(null);
                  }
                })();
              }}
            />
          </Field>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
          <Field
            label={t("settings:workspace.memoryDirLabel")}
            description={t("settings:workspace.memoryDirDesc")}
            compact
          >
            <Input
              value={memoryDir}
              disabled={!!switching}
              placeholder={t("settings:workspace.memoryDirPlaceholder")}
              className="font-mono text-3xs"
              onChange={(e) => setMemoryDir(e.target.value)}
              onBlur={() => {
                void (async () => {
                  setSwitching("configuring");
                  try {
                    await api.sys.updateWorkspaceConfig({
                      memory: {
                        dir: memoryDir.trim() || null,
                        profileFile: memoryProfile.trim() || "我的情况.md",
                        files: memoryFilesText
                          .split(/[,，]/u)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    });
                    await reloadConfig();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSwitching(null);
                  }
                })();
              }}
            />
          </Field>
          <Field
            label={t("settings:workspace.extraMemoryFilesLabel")}
            description={t("settings:workspace.extraMemoryFilesDesc")}
            compact
          >
            <Input
              value={memoryFilesText}
              disabled={!!switching}
              placeholder={t("settings:workspace.extraMemoryFilesPlaceholder")}
              className="font-mono text-3xs"
              onChange={(e) => setMemoryFilesText(e.target.value)}
              onBlur={() => {
                void (async () => {
                  setSwitching("configuring");
                  try {
                    await api.sys.updateWorkspaceConfig({
                      memory: {
                        dir: memoryDir.trim() || null,
                        profileFile: memoryProfile.trim() || "我的情况.md",
                        files: memoryFilesText
                          .split(/[,，]/u)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    });
                    await reloadConfig();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSwitching(null);
                  }
                })();
              }}
            />
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings:workspace.sidebarViewsTitle")} description={t("settings:workspace.sidebarViewsDesc")}>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(VIEW_KEYS).map(([id, key]) => {
            const on = enabledViews.includes(id);
            return (
              <button
                key={id}
                type="button"
                disabled={!!switching || (id === "category" && on && enabledViews.length === 1)}
                onClick={() => toggleView(id)}
                className={
                  "rounded-full border px-2.5 py-1 text-3xs transition-colors " +
                  (on
                    ? "border-accent-border-subtle bg-accent-bg-subtle text-accent-color"
                    : "border-border-subtle-dim text-text-tertiary hover:border-border-subtle")
                }
              >
                {t(key)}
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings:workspace.connectorCats")} description={t("settings:workspace.connectorCatsDesc")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-3xs text-text-tertiary">{t("settings:workspace.weread")}</div>
            <Select
              value={wereadCat}
              disabled={!!switching}
              onChange={(e) => {
                const v = e.target.value;
                setWereadCat(v);
                void persistViewsAndConnectors({
                  connectorDefaults: {
                    weread: { syncCategory: v },
                    x: { syncCategory: xCat },
                  },
                });
              }}
              options={categoryDirOptions}
            />
          </div>
          <div>
            <div className="mb-1 text-3xs text-text-tertiary">{t("settings:workspace.x")}</div>
            <Select
              value={xCat}
              disabled={!!switching}
              onChange={(e) => {
                const v = e.target.value;
                setXCat(v);
                void persistViewsAndConnectors({
                  connectorDefaults: {
                    weread: { syncCategory: wereadCat },
                    x: { syncCategory: v },
                  },
                });
              }}
              options={categoryDirOptions}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("settings:workspace.firstLevelCats")}
        description={
          categories.length > 0
            ? t("settings:workspace.firstLevelCatsDescHas", { count: categories.length })
            : t("settings:workspace.firstLevelCatsDescEmpty")
        }
        help={t("settings:workspace.firstLevelCatsHelp")}
        action={
          <div className="flex items-center gap-1">
            <Tooltip content={t("settings:workspace.reloadConfig")}>
              <Button variant="ghost" size="sm" className="h-6" disabled={!!switching} onClick={() => void reloadConfig()}>
                <RefreshCw size={ICON.xs} />
              </Button>
            </Tooltip>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-3xs"
              disabled={!!switching || !settings.workspaceRoot}
              onClick={() => setShowAdd((v) => !v)}
            >
              <Plus size={ICON.xs} /> {t("settings:workspace.addCategory")}
            </Button>
          </div>
        }
      >
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-3xs"
            disabled={!!switching || !settings.workspaceRoot}
            onClick={() => void handleRebuildMap()}
          >
            {t("settings:workspace.rebuildIndex")}
          </Button>
          <span className="text-3xs text-text-quaternary">
            {t("settings:workspace.rebuildHint")}
          </span>
        </div>

        {showAdd ? (
          <div className="mb-3 space-y-2 rounded-[var(--radius-md)] border border-accent-border-subtle bg-accent-bg-subtle/25 p-3">
            <div className="text-3xs font-medium text-text-secondary">{t("settings:workspace.newCategory")}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[7rem_1fr]">
              <Input
                placeholder={t("settings:workspace.slotPlaceholder")}
                value={newSlot}
                onChange={(e) => setNewSlot(e.target.value)}
                className="font-mono text-3xs"
              />
              <Input
                placeholder={t("settings:workspace.namePlaceholder")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="text-3xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[12rem] flex-1">
                <Select value={newRole} onChange={(e) => setNewRole(e.target.value)} options={Object.entries(ROLE_KEYS).map(([value, key]) => ({ value, label: t(key) }))} />
              </div>
              <Button size="sm" disabled={!!switching} onClick={() => void handleAddCategory()}>
                {switching === "adding" ? <Loader2 size={ICON.xs} className="animate-spin" /> : null}
                {t("settings:workspace.createCategoryBtn")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
                {t("common:action.cancel")}
              </Button>
            </div>
            <p className="text-3xs text-text-quaternary">{t("settings:workspace.createCategorySlotHelp")}</p>
          </div>
        ) : null}

        {/* Full expanded list — no nested max-height scroll; parent settings pane scrolls */}
        <ul className="m-0 list-none space-y-2 p-0">
          {categories.map((c) => {
            const roleLabel =
              ROLE_KEYS[c.role] ? t(ROLE_KEYS[c.role]) : c.role;
            const isSystem = SYSTEM_ROLES.has(c.role);
            return (
              <li
                key={c.directory}
                className={
                  "rounded-[var(--radius-lg)] border border-border-subtle-dim bg-surface px-3 py-2.5 text-3xs shadow-[inset_0_1px_0_0_var(--color-border-subtle-dim)] " +
                  (c.hidden ? "opacity-70" : "")
                }
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="break-all font-mono text-2xs font-semibold tracking-tight text-text-primary">
                        {c.directory}
                      </span>
                      {c.hidden ? (
                        <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-3xs font-medium text-text-tertiary">
                          {t("settings:workspace.hidden")}
                        </span>
                      ) : null}
                      {isSystem ? (
                        <span className="rounded-full bg-accent-bg-subtle px-1.5 py-0.5 text-3xs font-medium text-accent-color">
                          {t("settings:workspace.system")}
                        </span>
                      ) : null}
                      {c.ok === false ? (
                        <span className="rounded-full bg-status-warning-bg px-1.5 py-0.5 text-3xs font-medium text-warning">
                          {t("settings:workspace.dirError")}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-3xs leading-relaxed text-text-quaternary">
                        <span>
                          {t("settings:workspace.slot")} <span className="font-mono text-text-tertiary">{c.slot}</span>
                        </span>
                        <span>
                          {t("settings:workspace.role")} <span className="text-text-tertiary">{roleLabel}</span>
                        </span>
                        {c.specialBehavior ? (
                          <span>
                            {t("settings:workspace.behavior")} <span className="font-mono text-text-tertiary">{c.specialBehavior}</span>
                          </span>
                        ) : null}
                        {c.source ? (
                          <span title={c.source}>
                            {t("settings:workspace.source")} <span className="text-text-tertiary">{c.source}</span>
                          </span>
                        ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <div className="min-w-[10.5rem]">
                      <Select
                        value={c.role}
                        disabled={!!switching || isSystem}
                        onChange={(e) => void handleRoleChange(c.slot, e.target.value)}
                        options={Object.entries(ROLE_KEYS).map(([value, key]) => ({ value, label: t(key) }))}
                      />
                    </div>
                    {!isSystem ? (
                      <Tooltip content={c.hidden ? t("settings:workspace.showTooltip") : t("settings:workspace.hideTooltip")}>
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-border-subtle-dim text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:opacity-50"
                          disabled={!!switching}
                          onClick={() => void handleToggleHidden(c.slot, !c.hidden)}
                          aria-label={c.hidden ? t("settings:workspace.show") : t("settings:workspace.hide")}
                        >
                          {c.hidden ? <Eye size={ICON.xs} aria-hidden /> : <EyeOff size={ICON.xs} aria-hidden />}
                        </button>
                      </Tooltip>
                    ) : null}
                    {!isSystem ? (
                      <Tooltip content={t("settings:workspace.renameTooltip")}>
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-border-subtle-dim text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:opacity-50"
                          disabled={!!switching}
                          onClick={() => {
                            setRenameSlot(c.slot);
                            setRenameValue(c.name);
                          }}
                          aria-label={t("settings:workspace.rename")}
                        >
                          <Pencil size={ICON.xs} aria-hidden />
                        </button>
                      </Tooltip>
                    ) : null}
                  </div>
                </div>
                {renameSlot === c.slot ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border-subtle-dim pt-2.5">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="min-w-[10rem] flex-1 text-3xs"
                      placeholder={t("settings:workspace.renamePlaceholder")}
                      autoFocus
                    />
                    <Button size="sm" disabled={!!switching} onClick={() => void handleRename(c.slot)}>
                      {t("settings:workspace.confirmRename")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRenameSlot(null);
                        setRenameValue("");
                      }}
                    >
                      {t("common:action.cancel")}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
          {categories.length === 0 ? (
            <li className="rounded-[var(--radius-md)] border border-dashed border-border-subtle-dim px-3 py-4 text-center text-3xs text-text-tertiary">
              {settings.workspaceRoot ? t("settings:workspace.noCategories") : t("settings:workspace.pleaseOpenWorkspace")}
            </li>
          ) : null}
        </ul>
      </SettingsSection>

      {error ? (
        <div
          className="mb-3 flex items-start gap-1.5 rounded-[var(--radius-md)] border border-error/20 bg-status-error-bg px-2.5 py-2 text-3xs text-error"
          role="alert"
        >
          <AlertTriangle size={ICON.xs} className="mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <SettingsSection
        title={t("settings:workspace.switchWorkspaceTitle")}
        description={t("settings:workspace.switchWorkspaceDesc")}
        action={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-6 text-3xs" onClick={() => void handlePickNew()} disabled={!!switching}>
              {switching === "picking" ? (
                <Loader2 size={ICON.xs} className="animate-spin" />
              ) : (
                <Plus size={ICON.xs} />
              )}
              {t("common:action.select")}
            </Button>
            <Tooltip content={t("settings:workspace.closeWorkspaceTooltip")}>
              <Button
                variant="ghost"
                size="sm"
                className="h-6"
                onClick={() => void handleCloseWorkspace()}
                disabled={!!switching}
              >
                {switching === "closing" ? (
                  <Loader2 size={ICON.xs} className="animate-spin" />
                ) : (
                  <LogOut size={ICON.xs} />
                )}
              </Button>
            </Tooltip>
          </div>
        }
      >
        <Field label={t("settings:workspace.recentWorkspacesLabel")} description={t("settings:workspace.recentWorkspacesDesc")} compact>
        <ul className="m-0 list-none space-y-1 p-0">
          {recent.map((w) => {
            const active = w.rootPath === settings.workspaceRoot;
            return (
              <li key={w.rootPath}>
                <div
                  className={
                    "group flex w-full items-center gap-1 rounded-[var(--radius-md)] border px-2 py-2 text-left text-3xs transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)] " +
                    (active
                      ? "border-accent-border-subtle bg-accent-bg-subtle text-accent-color shadow-xs"
                      : "border-border-subtle text-text-secondary hover:border-border-strong hover:bg-surface-muted")
                  }
                >
                  <button
                    type="button"
                    onClick={() => !switching && void handleSwitch(w.rootPath)}
                    disabled={!!switching}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 px-1 py-0.5 text-left disabled:opacity-60"
                  >
                    <span className="flex min-w-0 items-center gap-2 font-mono">
                      <FolderOpen size={ICON.xs} className="shrink-0 text-text-tertiary" />
                      <span className="truncate">{w.rootPath}</span>
                    </span>
                    {switching === w.rootPath ? (
                      <Loader2 size={ICON.xs} className="animate-spin text-accent-color" />
                    ) : active ? (
                      <span className="rounded-full bg-accent-color px-1.5 py-0.5 text-3xs font-medium text-primary-foreground">
                        {t("settings:workspace.currentWorkspace")}
                      </span>
                    ) : (
                      <ArrowRight size={ICON.xs} className="text-text-quaternary" />
                    )}
                  </button>
                  {!active ? (
                    <Tooltip content={t("settings:workspace.removeFromListTooltip")}>
                      <button
                        type="button"
                        className="rounded p-1 text-text-quaternary hover:bg-surface hover:text-error"
                        disabled={!!switching}
                        onClick={(ev) => void handleRemove(w.rootPath, ev)}
                        aria-label={t("settings:workspace.removeFromListTooltip")}
                      >
                        <X size={ICON.xs} />
                      </button>
                    </Tooltip>
                  ) : null}
                </div>
              </li>
            );
          })}
          {recent.length === 0 ? (
            <li className="px-2 py-1.5 text-3xs text-text-tertiary">{t("settings:workspace.noHistory")}</li>
          ) : null}
        </ul>
        </Field>
      </SettingsSection>
    </div>
  );
}
