import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Puzzle,
  CheckCircle2,
  AlertTriangle,
  FolderOpen,
  RefreshCw,
  FolderPlus,
  FileArchive,
  Trash2,
  Sparkles,
  Shield,
} from "lucide-react";
import { useViewStore } from "../../stores/view-store";
import { useRegistry } from "../../plugins/registry";
import { usePluginStore } from "../../stores/plugin-store";
import {
  reloadExternalPlugins,
  setExternalPluginEnabled,
} from "../../plugins/host";
import { Tooltip } from "../ui/tooltip";
import { ICON } from "../../lib/icons";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";
import { api, type ExternalPluginInfo, type PluginInstallPreview } from "../../services/api";
import type { AppSettings } from "../../types";
import { SettingsSection, StatusDot } from "./fields";
import { PluginInstallPreviewBody } from "./PluginInstallPreviewBody";
import { scheduleFlash } from "../../lib/flash-message";
import { cn } from "../../lib/cn";

type PendingInstall =
  | { kind: "folder"; path: string; preview: PluginInstallPreview }
  | { kind: "zip"; path: string; preview: PluginInstallPreview };

export function PluginsPanel({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (p: Partial<AppSettings>) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const plugins = usePluginStore((s) => s.plugins);
  const settingsSlots = useRegistry((s) => s.settingsSlots);
  const dataSources = useRegistry((s) => s.dataSources);
  const viewSlots = useRegistry((s) => s.viewSlots);
  const actions = useRegistry((s) => s.actions);
  const sidebarSlots = useRegistry((s) => s.sidebarSlots);
  const statusBarSlots = useRegistry((s) => s.statusBarSlots);
  const [external, setExternal] = useState<{ root: string; plugins: ExternalPluginInfo[] } | null>(null);
  const [extLoading, setExtLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingInstall | null>(null);
  const [uninstallId, setUninstallId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashOk = (msg: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setActionError(null);
    flashTimer.current = scheduleFlash(setActionOk, msg);
  };

  const refreshExternal = async () => {
    setExtLoading(true);
    try {
      const r = await api.sys.listExternalPlugins();
      setExternal({ root: r.root, plugins: r.plugins });
    } catch {
      setExternal(null);
    } finally {
      setExtLoading(false);
    }
  };

  useEffect(() => {
    void refreshExternal();
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const slotCount = (pluginId: string): number =>
    [
      ...dataSources,
      ...viewSlots,
      ...actions,
      ...sidebarSlots,
      ...settingsSlots,
      ...statusBarSlots,
    ].filter((s) => s.pluginId === pluginId).length;

  const pluginCards = plugins
    .map((p) => {
      const isBuiltin = Boolean(p.manifest.builtin);
      const settingsKey = p.manifest.settingsKey;
      const pluginSettings = settingsKey
        ? (settings as unknown as Record<string, Record<string, unknown>>)[settingsKey]
        : null;
      const isExternal = !isBuiltin && !settingsKey;
      const externalOn =
        settings.plugins?.externalEnabled?.[p.id] !== false &&
        p.status !== "disabled";
      const enabled = isBuiltin
        ? true
        : settingsKey
          ? Boolean(pluginSettings?.enabled)
          : externalOn && p.status === "active";
      let configured = false;
      if (settingsKey === "weread") configured = Boolean(settings.weread.apiKey);
      else if (settingsKey === "x")
        configured = Boolean(settings.x.bearerToken || settings.x.mcpEndpoint);
      const settingsSlot = settingsSlots.find((s) => s.pluginId === p.id);
      const disc = external?.plugins?.find((e) => e.id === p.id);
      return {
        plugin: p,
        isBuiltin,
        isExternal,
        enabled,
        configured,
        settingsSlot,
        slots: slotCount(p.id),
        permissions: disc?.manifest?.permissions || [],
      };
    })
    .sort((a, b) => {
      if (a.isBuiltin !== b.isBuiltin) return a.isBuiltin ? -1 : 1;
      if (a.isExternal !== b.isExternal) return a.isExternal ? 1 : -1;
      return a.plugin.manifest.name.localeCompare(b.plugin.manifest.name);
    });

  const running = pluginCards.filter((c) => c.enabled || c.plugin.status === "active").length;

  const toggleExternal = (id: string, nextEnabled: boolean) => {
    const prev = settings.plugins?.externalEnabled || {};
    update({
      plugins: {
        externalEnabled: { ...prev, [id]: nextEnabled },
      },
    });
    const wsRoot = settings.workspaceRoot;
    if (wsRoot) {
      void setExternalPluginEnabled(id, nextEnabled, wsRoot);
    }
  };

  const afterInstall = async (msg: string) => {
    flashOk(msg);
    const wsRoot = settings.workspaceRoot;
    if (wsRoot) await reloadExternalPlugins(wsRoot, { cacheBust: true });
    await refreshExternal();
  };

  const handleReload = async () => {
    setBusy("reload");
    setActionError(null);
    try {
      const wsRoot = settings.workspaceRoot;
      if (wsRoot) await reloadExternalPlugins(wsRoot, { cacheBust: true });
      await refreshExternal();
      flashOk(t("settings:plugins.toastReloaded"));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const beginInstallFolder = async () => {
    setBusy("folder");
    setActionError(null);
    try {
      const { path } = await api.sys.pickPluginFolder();
      if (!path) return;
      const preview = await api.sys.previewExternalPluginFromFolder(path);
      setPending({ kind: "folder", path, preview });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const beginInstallZip = async () => {
    setBusy("zip");
    setActionError(null);
    try {
      const { path } = await api.sys.pickPluginZip();
      if (!path) return;
      const preview = await api.sys.previewExternalPluginFromZip(path);
      setPending({ kind: "zip", path, preview });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmInstall = async () => {
    if (!pending) return;
    setBusy("install");
    setActionError(null);
    try {
      const r =
        pending.kind === "folder"
          ? await api.sys.installExternalPluginFromFolder(pending.path, true)
          : await api.sys.installExternalPluginFromZip(pending.path, true);
      // Ensure enabled after install
      const prev = settings.plugins?.externalEnabled || {};
      if (prev[r.id] === false) {
        update({ plugins: { externalEnabled: { ...prev, [r.id]: true } } });
      }
      setPending(null);
      await afterInstall(
        pending.preview.replaces
          ? t("settings:plugins.toastUpdated", { id: r.id, version: r.version || pending.preview.manifest.version })
          : t("settings:plugins.toastInstalled", { id: r.id, version: r.version || pending.preview.manifest.version }),
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleScaffold = async () => {
    setBusy("scaffold");
    setActionError(null);
    try {
      const r = await api.sys.scaffoldExamplePlugin();
      await afterInstall(t("settings:plugins.toastGeneratedSample", { id: r.id }));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmUninstall = async () => {
    const id = uninstallId;
    if (!id) return;
    setBusy(`rm:${id}`);
    setActionError(null);
    try {
      await api.sys.uninstallExternalPlugin(id, false);
      const prev = settings.plugins?.externalEnabled || {};
      if (id in prev) {
        const next = { ...prev };
        delete next[id];
        update({ plugins: { externalEnabled: next } });
      }
      const wsRoot = settings.workspaceRoot;
      if (wsRoot) {
        await setExternalPluginEnabled(id, false, wsRoot);
        await reloadExternalPlugins(wsRoot, { cacheBust: true });
      }
      await refreshExternal();
      setUninstallId(null);
      flashOk(t("settings:plugins.toastUninstalled", { id }));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t("settings:plugins.titleLoaded")}
        description={t("settings:plugins.descLoaded")}
        help={t("settings:plugins.helpLoaded")}
        action={<StatusDot ok={running > 0} label={t("settings:plugins.statusRunning", { count: running, total: pluginCards.length })} />}
      >
        <div className="space-y-1">
          {pluginCards.map(
            ({
              plugin: p,
              isBuiltin,
              isExternal,
              enabled,
              configured,
              settingsSlot,
              slots,
              permissions,
            }) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-border-subtle-dim bg-surface px-2.5 py-2 shadow-[inset_0_1px_0_0_var(--color-border-subtle-dim)] transition-colors hover:border-border-subtle"
              >
                <div className="v4-icon-chip flex h-8 w-8 shrink-0 rounded-[var(--radius-md)] text-text-tertiary">
                  <Puzzle size={ICON.sm} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-3xs font-medium text-text-primary">{p.manifest.nameKey ? t(p.manifest.nameKey) : p.manifest.name}</span>
                    <span className="text-3xs tabular-nums text-text-quaternary">v{p.manifest.version}</span>
                    {isBuiltin ? (
                      <span className="rounded-full bg-accent-bg-subtle px-1.5 py-0.5 text-3xs font-medium text-accent-color">
                        {t("settings:plugins.builtIn")}
                      </span>
                    ) : isExternal ? (
                      <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-3xs text-text-tertiary">
                        {t("settings:plugins.thirdParty")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-3xs text-text-tertiary">
                        {t("settings:plugins.connector")}
                      </span>
                    )}
                    {p.status === "error" ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-status-error-bg px-1.5 py-0.5 text-3xs text-error">
                        <AlertTriangle size={ICON.nano} /> {t("settings:plugins.error")}
                      </span>
                    ) : enabled || p.status === "active" ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-status-success-bg px-1.5 py-0.5 text-3xs text-success">
                        <CheckCircle2 size={ICON.nano} /> {t("settings:plugins.on")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-3xs text-text-quaternary">
                        {t("settings:plugins.off")}
                      </span>
                    )}
                    {enabled && !isBuiltin && !isExternal && !configured ? (
                      <span className="inline-flex items-center gap-0.5 text-3xs text-warning">
                        <AlertTriangle size={ICON.nano} /> {t("settings:plugins.pendingConfig")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-3xs leading-relaxed text-text-tertiary">
                    {p.manifest.descriptionKey ? t(p.manifest.descriptionKey) : p.manifest.description}
                    {slots > 0 ? t("settings:plugins.slotsCount", { count: slots }) : ""}
                  </div>
                  {isExternal && permissions.length > 0 ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Shield size={ICON.nano} className="text-text-quaternary" />
                      {permissions.slice(0, 4).map((perm) => (
                        <span key={perm} className="rounded bg-surface-muted px-1 py-px font-mono text-3xs text-text-quaternary">
                          {perm}
                        </span>
                      ))}
                      {permissions.length > 4 ? (
                        <span className="text-3xs text-text-quaternary">+{permissions.length - 4}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {p.error ? <div className="mt-0.5 text-3xs text-error">{p.error}</div> : null}
                </div>
                {settingsSlot ? (
                  <Tooltip content={t("settings:plugins.configTooltip")}>
                    <button
                      type="button"
                      onClick={() =>
                        useViewStore.getState().openOverlay("settings", { topicId: settingsSlot.id })
                      }
                      className="shrink-0 rounded-[var(--radius-md)] border border-border-subtle px-2 py-1 text-3xs text-text-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                    >
                      {t("settings:plugins.configBtn")}
                    </button>
                  </Tooltip>
                ) : null}
                {isExternal ? (
                  <Tooltip content={t("settings:plugins.uninstallTooltip")}>
                    <button
                      type="button"
                      disabled={busy === `rm:${p.id}`}
                      onClick={() => setUninstallId(p.id)}
                      aria-label={t("settings:plugins.uninstallTooltip")}
                      className="shrink-0 rounded-[var(--radius-sm)] p-1 text-text-quaternary transition-colors hover:bg-surface-muted hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                    >
                      <Trash2 size={ICON.micro} />
                    </button>
                  </Tooltip>
                ) : null}
                {!isBuiltin ? (
                  <Tooltip content={enabled || p.status === "active" ? t("settings:plugins.disable") : t("settings:plugins.enable")}>
                    <button
                      type="button"
                      onClick={() => {
                        if (p.manifest.settingsKey) {
                          const key = p.manifest.settingsKey;
                          const current =
                            (settings as unknown as Record<string, Record<string, unknown>>)[key] || {};
                          const nextOn = !Boolean(current.enabled);
                          update({ [key]: { ...current, enabled: nextOn } } as Partial<AppSettings>);
                          return;
                        }
                        const nextOn = !(
                          p.status === "active" &&
                          settings.plugins?.externalEnabled?.[p.id] !== false
                        );
                        toggleExternal(p.id, nextOn);
                      }}
                      className="v4-switch shrink-0"
                      data-checked={
                        p.manifest.settingsKey
                          ? enabled
                          : p.status === "active" &&
                            settings.plugins?.externalEnabled?.[p.id] !== false
                      }
                    />
                  </Tooltip>
                ) : null}
              </div>
            ),
          )}
          {pluginCards.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-subtle px-3 py-5 text-center text-3xs text-text-quaternary">
              {t("settings:plugins.emptyPlugins")}
            </div>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("settings:plugins.titleInstall")}
        description={external?.root ? t("settings:plugins.descInstallDir", { dir: external.root }) : t("settings:plugins.descInstallDefault")}
        help={t("settings:plugins.helpInstall")}
        action={
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6"
              onClick={() => void refreshExternal()}
              disabled={Boolean(busy) || extLoading}
            >
              <RefreshCw size={ICON.micro} className={cn((extLoading || busy === "reload") && "animate-spin")} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-3xs"
              disabled={Boolean(busy) || !settings.workspaceRoot}
              onClick={() => void handleReload()}
            >
              {t("settings:plugins.reload")}
            </Button>
            <Button variant="outline" size="sm" className="h-6 text-3xs" onClick={() => void api.sys.openPluginsDir()}>
              <FolderOpen size={ICON.micro} /> {t("settings:plugins.openFolder")}
            </Button>
          </div>
        }
      >
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-3xs"
            disabled={Boolean(busy)}
            onClick={() => void beginInstallFolder()}
          >
            <FolderPlus size={ICON.micro} /> {t("settings:plugins.installFromFolder")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-3xs"
            disabled={Boolean(busy)}
            onClick={() => void beginInstallZip()}
          >
            <FileArchive size={ICON.micro} /> {t("settings:plugins.installFromZip")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-3xs"
            disabled={Boolean(busy)}
            onClick={() => void handleScaffold()}
          >
            <Sparkles size={ICON.micro} /> {t("settings:plugins.generateSample")}
          </Button>
        </div>

        {actionError ? (
          <div className="mb-2 flex items-start gap-1.5 text-3xs text-error">
            <AlertTriangle size={ICON.xs} className="mt-0.5 shrink-0" />
            <span>{actionError}</span>
          </div>
        ) : null}
        {actionOk ? (
          <div className="mb-2 flex items-center gap-1 text-3xs text-success">
            <CheckCircle2 size={ICON.xs} />
            {actionOk}
          </div>
        ) : null}

        {external?.plugins?.length ? (
          <div className="space-y-1">
            {external.plugins.map((p) => {
              const settingsOn = settings.plugins?.externalEnabled?.[p.id] !== false;
              const runtime = plugins.find((x) => x.id === p.id);
              const active = runtime?.status === "active";
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-1.5 text-3xs"
                >
                  <span className="min-w-0 flex-1 font-medium text-text-secondary">
                    {p.manifest?.name || p.id}
                  </span>
                  <span className="text-text-quaternary tabular-nums">v{p.manifest?.version || "—"}</span>
                  <span
                    className={
                      p.status === "ready"
                        ? active
                          ? "text-success"
                          : "text-text-tertiary"
                        : p.status === "invalid"
                          ? "text-error"
                          : "text-warning"
                    }
                  >
                    {p.status === "ready" ? (active ? "active" : settingsOn ? "ready" : "off") : p.status}
                  </span>
                  {p.error ? (
                    <span className="min-w-0 max-w-[8rem] truncate text-text-quaternary" title={p.error}>
                      {p.error}
                    </span>
                  ) : null}
                  {p.status === "ready" ? (
                    <>
                      <button
                        type="button"
                        className="v4-switch shrink-0"
                        data-checked={settingsOn && active}
                        onClick={() => toggleExternal(p.id, !(settingsOn && active))}
                        aria-label={settingsOn && active ? t("settings:plugins.disable") : t("settings:plugins.enable")}
                      />
                      <Tooltip content={t("settings:plugins.uninstall")}>
                        <button
                          type="button"
                          className="shrink-0 rounded p-0.5 text-text-quaternary hover:text-error"
                          disabled={busy === `rm:${p.id}`}
                          onClick={() => setUninstallId(p.id)}
                        >
                          <Trash2 size={ICON.micro} />
                        </button>
                      </Tooltip>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[var(--radius-md)] border border-dashed border-border-subtle px-3 py-3 text-3xs text-text-quaternary">
            {t("settings:plugins.emptyThirdPartyHint")}
          </div>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.preview.replaces ? t("settings:plugins.updateModalTitle") : t("settings:plugins.installModalTitle")}
        description={
          pending
            ? t("settings:plugins.installModalConfirm", { name: pending.preview.manifest.name, risk: pending.preview.risk })
            : undefined
        }
        confirmText={pending?.preview.replaces ? t("settings:plugins.overwriteInstall") : t("settings:plugins.confirmInstall")}
        cancelText={t("settings:plugins.cancel")}
        destructive={pending?.preview.risk === "high"}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirmInstall()}
      >
        {pending ? (
          <PluginInstallPreviewBody
            preview={pending.preview}
            sourceKind={pending.kind}
          />
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(uninstallId)}
        title={t("settings:plugins.uninstallModalTitle")}
        description={
          uninstallId
            ? t("settings:plugins.uninstallModalConfirm", { id: uninstallId })
            : undefined
        }
        confirmText={t("settings:plugins.uninstall")}
        cancelText={t("settings:plugins.cancel")}
        destructive
        onCancel={() => setUninstallId(null)}
        onConfirm={() => void confirmUninstall()}
      />
    </div>
  );
}
