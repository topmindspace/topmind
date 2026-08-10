/**
 * ManagePanel — 统一「管理与更新」页面（合并原 Companions + About）。
 *
 * 结构：
 *   1. 应用版本信息头
 *   2. 更新检查（全表面：Desktop / Skills / Clip / Obsidian）
 *   3. 模块管理（Agent Skills · Clip · Obsidian 插件）
 *   4. 健康诊断（UTR doctor）
 *   5. 页脚
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, CheckCircle2, AlertTriangle, Zap, RefreshCw, Download, ExternalLink,
  Sparkles, Puzzle, Globe, BookOpen, FolderOpen, Trash2, Terminal, Copy,
} from "lucide-react";
import { api, type CompanionStatusResult, type SurfaceUpdateInfo } from "../../services/api";
import { registry } from "../../plugins/registry";
import { usePluginStore } from "../../stores/plugin-store";
import type { AppSettings } from "../../types";
import { Button } from "../ui/Button";
import { SettingsSection, HelpTip, StatusDot, SwitchField } from "./fields";
import { ICON } from "../../lib/icons";
import { PRODUCT } from "../../lib/product";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../../lib/cn";
import { scheduleFlash } from "../../lib/flash-message";
import type { TFunction } from "i18next";

type UpdateCheckResult = Awaited<ReturnType<typeof api.sys.checkForUpdates>>;

// ── Update surface helpers ───────────────────────────────────────────────────

function surfaceLabel(surface: string, t: TFunction): string {
  if (surface === "desktop") return t("settings:about.surfaceDesktop");
  if (surface === "skills") return t("settings:about.surfaceSkills");
  if (surface === "extension") return t("settings:about.surfaceExtension");
  if (surface === "obsidian") return t("settings:about.surfaceObsidian");
  return surface;
}

function formatSurfaceStatus(
  s: SurfaceUpdateInfo | undefined | null,
  t: TFunction,
): { text: string; tone: "ok" | "warn" | "muted" | "success"; detail?: string } {
  if (!s) return { text: t("settings:about.notChecked"), tone: "muted" };
  if (s.reason === "error") return { text: s.error || t("settings:about.failed"), tone: "warn" };
  if (s.reason === "not-bundled") {
    if (s.surface === "obsidian") {
      return {
        text: s.latestVersion
          ? t("settings:about.obsidianOnlineVersion", { version: s.latestVersion })
          : t("settings:about.obsidianStandalone"),
        tone: "muted",
      };
    }
    return {
      text: s.latestVersion
        ? t("settings:about.extensionOnlineVersion", { version: s.latestVersion })
        : t("settings:about.extensionStandalone"),
      tone: "muted",
    };
  }
  if (s.reason === "no-release" || !s.latestVersion) {
    return { text: `v${s.currentVersion ?? "—"}`, tone: "muted" };
  }
  if (s.updateAvailable) {
    // Show installed version and bundled version when they differ
    const installed = s.currentVersion;
    const bundled = s.bundledVersion;
    let detail: string | undefined;
    if (bundled && installed && bundled !== installed) {
      detail = t("settings:about.installedVsBundled", { installed, bundled });
    } else if (bundled && !installed) {
      detail = t("settings:about.bundledVersion", { version: bundled });
    }
    return { text: t("settings:about.updateAvailable", { version: s.latestVersion }), tone: "success", detail };
  }
  if (s.reason === "local-ahead") {
    return { text: t("settings:about.localAhead", { version: s.currentVersion }), tone: "muted" };
  }
  return { text: t("settings:about.upToDate", { version: s.currentVersion }), tone: "ok" };
}

function SurfaceUpdateRow({
  surface,
  info,
  t,
  onInlineInstall,
  inlineInstalling,
}: {
  surface: "desktop" | "skills" | "extension" | "obsidian";
  info: SurfaceUpdateInfo | undefined;
  t: TFunction;
  onInlineInstall?: (surface: "skills" | "extension" | "obsidian", version: string, tag: string) => void;
  inlineInstalling?: string | null;
}) {
  const status = formatSurfaceStatus(info, t);
  const canInlineInstall = surface !== "desktop" && info?.updateAvailable && info.latestVersion && info.tagName;
  const isInstalling = inlineInstalling === surface;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2 py-1.5">
      <span className="w-14 shrink-0 text-3xs font-medium text-text-secondary">
        {surfaceLabel(surface, t)}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-3xs",
          status.tone === "success" && "text-success",
          status.tone === "warn" && "text-warning",
          status.tone === "ok" && "text-text-tertiary",
          status.tone === "muted" && "text-text-quaternary",
        )}
      >
        {status.text}
        {status.detail ? (
          <span className="ml-1 text-text-quaternary">· {status.detail}</span>
        ) : null}
      </span>
      {canInlineInstall && onInlineInstall && info.latestVersion && info.tagName ? (
        <Tooltip content={t("settings:about.inlineInstall")}>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-3xs"
            disabled={isInstalling}
            onClick={() => onInlineInstall(surface as "skills" | "extension" | "obsidian", info.latestVersion!, info.tagName!)}
          >
            {isInstalling ? (
              <Loader2 size={ICON.nano} className="animate-spin" />
            ) : (
              <Download size={ICON.nano} />
            )}
          </Button>
        </Tooltip>
      ) : null}
      {info?.updateAvailable && info.assets?.[0]?.url ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-3xs"
          onClick={() => void api.sys.openUpdateDownload(info.assets[0].url, surface)}
        >
          <ExternalLink size={ICON.nano} />
        </Button>
      ) : null}
      {info?.releaseUrl ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-3xs"
          onClick={() => void api.sys.openUrl(info.releaseUrl!)}
        >
          <ExternalLink size={ICON.nano} />
        </Button>
      ) : null}
    </div>
  );
}

// ── Command row helper ──────────────────────────────────────────────────────

function CmdRow({ label, cmd }: { label: string; cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable */
    }
  };
  return (
    <div className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2 py-1.5">
      <span className="w-24 shrink-0 text-3xs text-text-quaternary">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-3xs text-text-secondary">
        {cmd}
      </code>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-1.5"
        onClick={() => void copy()}
      >
        {copied ? (
          <CheckCircle2 size={ICON.nano} className="text-success" />
        ) : (
          <Copy size={ICON.nano} />
        )}
      </Button>
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export function ManagePanel({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (p: Partial<AppSettings>) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const [pluginInfo, setPluginInfo] = useState<{ plugins: number; slots: number } | null>(null);
  const [doctorResult, setDoctorResult] = useState<{
    ok: boolean;
    error?: string;
    issues?: Array<{ severity?: string; message?: string; code?: string; path?: string }>;
  } | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [utrStatus, setUtrStatus] = useState<{ utrAvailable: boolean } | null>(null);
  const [sysInfo, setSysInfo] = useState<Awaited<ReturnType<typeof api.sys.getSystemInfo>> | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [inlineInstalling, setInlineInstalling] = useState<string | null>(null);

  // Companion state
  const [compStatus, setCompStatus] = useState<CompanionStatusResult | null>(null);
  const [compLoading, setCompLoading] = useState(true);
  const [compError, setCompError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashOk = useCallback((msg: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setCompError(null);
    flashTimer.current = scheduleFlash(setActionMsg, msg, 4500);
  }, []);

  const reloadCompanions = useCallback(async () => {
    setCompLoading(true);
    setCompError(null);
    try {
      const st = await api.sys.getCompanionStatus();
      setCompStatus(st);
    } catch (e) {
      setCompError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompLoading(false);
    }
  }, []);

  useEffect(() => {
    const slots =
      registry.dataSources().length +
      registry.viewSlots().length +
      registry.actions().length +
      registry.sidebarSlots().length +
      registry.settingsSlots().length +
      registry.statusBarSlots().length +
      registry.contextMenuSlots().length +
      registry.overlaySlots().length;
    setPluginInfo({
      plugins: usePluginStore.getState().plugins.length,
      slots,
    });
    void reloadCompanions();
    void api.tool
      .status()
      .then((s) => setUtrStatus(s))
      .catch(() => setUtrStatus({ utrAvailable: false }));
    void api.sys
      .getSystemInfo()
      .then((s) => setSysInfo(s))
      .catch(() => {});
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [reloadCompanions]);

  const checkUpdates = async () => {
    setUpdateLoading(true);
    try {
      setUpdateInfo(await api.sys.checkForUpdates());
    } catch (e) {
      setUpdateInfo({
        ok: false,
        updateAvailable: false,
        currentVersion: __APP_VERSION__,
        latestVersion: null,
        tagName: null,
        releaseUrl: null,
        notes: null,
        publishedAt: null,
        assets: [],
        error: e instanceof Error ? e.message : String(e),
        reason: "error",
      });
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleInlineInstall = async (surface: "skills" | "extension" | "obsidian", version: string, tag: string) => {
    setInlineInstalling(surface);
    setCompError(null);
    try {
      const opts: { hostId?: string; vaultPath?: string } = {};
      if (surface === "skills") {
        const host = agents.find((a) => a.skillsRoot);
        if (host) opts.hostId = host.id;
      } else if (surface === "obsidian") {
        // Pass vault path so installObsidianPlugin knows where to install.
        // vaultPluginsRoot is {vault}/.obsidian/plugins — derive vault root.
        if (obsidian?.vaultPluginsRoot) {
          const pluginsRoot = obsidian.vaultPluginsRoot;
          // Remove trailing /plugins and /.obsidian to get vault root
          opts.vaultPath = pluginsRoot
            .replace(/\/plugins\/?$/, "")
            .replace(/\/\.obsidian\/?$/, "");
        }
      }
      await api.sys.downloadAndInstallCompanion(surface, version, tag, opts);
      flashOk(t("settings:about.inlineInstallOk", { surface: surfaceLabel(surface, t), version }));
      // Reload companion status after install to reflect new installed version
      await reloadCompanions();
      // Re-check updates to clear the badge (installed == latest now)
      await checkUpdates();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCompError(`${surfaceLabel(surface, t)}: ${msg}`);
    } finally {
      setInlineInstalling(null);
    }
  };

  const runDoctor = async () => {
    setDoctorLoading(true);
    try {
      setDoctorResult(await api.tool.doctor(false));
    } catch (e) {
      setDoctorResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setDoctorLoading(false);
    }
  };

  const runCompanion = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setCompError(null);
    try {
      await fn();
      await reloadCompanions();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCompError(msg);
      // Reload companion status to refresh UI state, but preserve the error
      // message (reloadCompanions would clear it at the start).
      try {
        const st = await api.sys.getCompanionStatus();
        setCompStatus(st);
      } catch {
        /* ignore — error is already set */
      }
    } finally {
      setBusy(null);
    }
  };

  // ── Batch install / upgrade all agent hosts ─────────────────────────────
  const installAllSkills = async () => {
    setBusy("install-all");
    setCompError(null);
    let ok = 0;
    let failed = 0;
    let lastVersion = "?";
    const errors: string[] = [];
    for (const host of agents) {
      if (!host.skillsRoot) continue;
      try {
        const r = await api.sys.installCompanionSkills(host.id);
        ok++;
        lastVersion = r.version || lastVersion;
      } catch (e) {
        failed++;
        errors.push(`${host.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await reloadCompanions();
    setBusy(null);
    if (failed === 0) {
      flashOk(t("settings:companions.okInstalledAll", { count: ok, version: lastVersion }));
    } else {
      setCompError(errors.join("; "));
      flashOk(
        t("settings:companions.okInstalledAllPartial", {
          ok,
          total: ok + failed,
          failed,
        }),
      );
    }
  };

  const upgradeAllSkills = async () => {
    setBusy("upgrade-all");
    setCompError(null);
    let ok = 0;
    let failed = 0;
    let lastVersion = "?";
    const errors: string[] = [];
    for (const host of agents) {
      if (!host.installed) continue;
      try {
        const r = await api.sys.upgradeCompanionSkills(host.id);
        ok++;
        lastVersion = r.version || lastVersion;
      } catch (e) {
        failed++;
        errors.push(`${host.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await reloadCompanions();
    setBusy(null);
    if (failed === 0) {
      flashOk(t("settings:companions.okUpgradedAll", { count: ok, version: lastVersion }));
    } else {
      setCompError(errors.join("; "));
      flashOk(
        t("settings:companions.okUpgradedAllPartial", {
          ok,
          total: ok + failed,
          failed,
        }),
      );
    }
  };

  const agents = compStatus?.agents || [];
  const browsers = compStatus?.browsers || [];
  const obsidian = compStatus?.obsidian;
  const clip = compStatus?.clip;
  const bundledSkills = compStatus?.bundled?.skillsVersion;
  const autoCheck = settings.ui?.autoCheckUpdates !== false;

  return (
    <div>
      {/* ── App version header ─────────────────────────────────────────── */}
      <div className="mb-3.5 flex items-center gap-3 rounded-[var(--radius-xl)] border border-border-subtle bg-surface/70 px-3.5 py-3">
        <img
          src="./icon-256.png"
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-[var(--radius-md)] shadow-sm"
          draggable={false}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-text-primary">
              {t("settings:about.topmindDesktop")}
            </span>
            <span className="font-mono text-3xs text-text-quaternary">v{__APP_VERSION__}</span>
          </div>
          <div className="truncate font-mono text-3xs text-text-quaternary">
            {settings.workspaceRoot || t("settings:about.noWorkspace")}
          </div>
        </div>
      </div>

      {/* ── Updates ────────────────────────────────────────────────────── */}
      <SettingsSection
        title={t("settings:about.updateTitle")}
        description={t("settings:about.updateDesc")}
        help={t("settings:about.updateHelp")}
        action={
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-3xs"
              onClick={() => void checkUpdates()}
              disabled={updateLoading}
            >
              {updateLoading ? (
                <Loader2 size={ICON.micro} className="animate-spin" />
              ) : (
                <RefreshCw size={ICON.micro} />
              )}
              {t("settings:about.checkButton")}
            </Button>
            <Tooltip content={t("settings:about.openReleasesTooltip")}>
              <Button
                variant="ghost"
                size="sm"
                className="h-6"
                onClick={() => void api.sys.openUrl(PRODUCT.releasesUrl)}
              >
                <ExternalLink size={ICON.micro} />
              </Button>
            </Tooltip>
          </div>
        }
      >
        <SwitchField
          label={t("settings:manage.autoCheckUpdates")}
          description={t("settings:manage.autoCheckUpdatesDesc")}
          checked={autoCheck}
          onChange={(autoCheckUpdates) => update({ ui: { ...settings.ui, autoCheckUpdates } })}
          className="mb-2"
        />
        {updateInfo && !updateLoading ? (
          updateInfo.ok === false ? (
            <div className="space-y-1.5">
              <div className="rounded-[var(--radius-md)] border border-warning/30 bg-warning/5 px-2 py-1.5 text-3xs text-warning">
                {updateInfo.error || t("settings:about.checkFailed")}
              </div>
              <div className="text-3xs text-text-quaternary">{t("settings:about.checkFailedHint")}</div>
              {(updateInfo.releasesUrl || updateInfo.releaseUrl) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-3xs"
                  onClick={() =>
                    void api.sys.openUrl(
                      updateInfo.releasesUrl || updateInfo.releaseUrl || PRODUCT.releasesUrl,
                    )
                  }
                >
                  <ExternalLink size={ICON.nano} />
                  {t("settings:about.openReleases")}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1">
              <SurfaceUpdateRow surface="desktop" info={updateInfo.desktop ?? updateInfo} t={t} />
              <SurfaceUpdateRow surface="skills" info={updateInfo.skills} t={t} onInlineInstall={handleInlineInstall} inlineInstalling={inlineInstalling} />
              <SurfaceUpdateRow surface="extension" info={updateInfo.extension} t={t} onInlineInstall={handleInlineInstall} inlineInstalling={inlineInstalling} />
              <SurfaceUpdateRow surface="obsidian" info={updateInfo.obsidian} t={t} onInlineInstall={handleInlineInstall} inlineInstalling={inlineInstalling} />
            </div>
          )
        ) : (
          <div className="text-3xs text-text-quaternary">{t("settings:about.clickToCheck")}</div>
        )}
      </SettingsSection>

      {/* ── Environment & install commands ─────────────────────────────── */}
      {sysInfo ? (
        <SettingsSection
          title={t("settings:env.title")}
          description={t("settings:env.desc")}
        >
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-muted/40 px-2 py-0.5 text-3xs text-text-secondary">
              <Terminal size={ICON.nano} />
              {sysInfo.platformLabel} · {sysInfo.archLabel}
            </span>
            {sysInfo.platform === "darwin" ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-3xs",
                  sysInfo.brewAvailable
                    ? "border-border-subtle bg-surface-muted/40 text-text-secondary"
                    : "border-border-subtle-dim text-text-quaternary",
                )}
              >
                {sysInfo.brewAvailable
                  ? t("settings:env.brewAvailable")
                  : t("settings:env.brewUnavailable")}
              </span>
            ) : null}
            {sysInfo.nodeVersion ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border-subtle-dim px-2 py-0.5 text-3xs text-text-quaternary">
                Node {sysInfo.nodeVersion}
              </span>
            ) : null}
          </div>

          {/* Install commands */}
          <div className="space-y-1.5">
            {sysInfo.platform === "darwin" && sysInfo.brewAvailable ? (
              <CmdRow
                label={t("settings:env.brewInstallLabel")}
                cmd="brew install topmindspace/tap/topmind"
              />
            ) : null}
            {sysInfo.platform === "darwin" && sysInfo.brewAvailable ? (
              <CmdRow
                label={t("settings:env.brewUpgradeLabel")}
                cmd="brew upgrade topmind"
              />
            ) : null}
            <CmdRow
              label={t("settings:env.skillsInstallLabel")}
              cmd="npx skills add topmindspace/topmind -g -y"
            />
            <CmdRow
              label={t("settings:env.skillsUpgradeLabel")}
              cmd="npx skills update -g -y"
            />
            {sysInfo.platform === "darwin" ? (
              <>
                <CmdRow
                  label={t("settings:env.quarantineLabel")}
                  cmd="sudo xattr -rd com.apple.quarantine /Applications/Topmind.app"
                />
                <div className="text-3xs text-text-quaternary">
                  {t("settings:env.quarantineDesc")}
                </div>
              </>
            ) : null}
          </div>
        </SettingsSection>
      ) : null}

      {/* ── Module management ──────────────────────────────────────────── */}
      <SettingsSection
        title={t("settings:manage.modulesTitle")}
        description={t("settings:manage.modulesDesc")}
        help={t("settings:companions.help")}
        action={
          <Button
            variant="ghost"
            size="sm"
            className="h-6"
            onClick={() => void reloadCompanions()}
            disabled={compLoading || Boolean(busy)}
          >
            {compLoading ? (
              <Loader2 size={ICON.xs} className="animate-spin" />
            ) : (
              <RefreshCw size={ICON.xs} />
            )}
          </Button>
        }
      >
        {compError ? (
          <div className="mb-2 rounded-[var(--radius-md)] border border-warning/30 bg-warning/5 px-2 py-1.5 text-3xs text-warning">
            {compError}
          </div>
        ) : null}
        {actionMsg ? <div className="mb-2 text-3xs text-success">{actionMsg}</div> : null}
        {bundledSkills ? (
          <div className="mb-2 text-3xs text-text-quaternary">
            {t("settings:companions.bundledSkills", { version: bundledSkills })}
          </div>
        ) : null}

        {/* Agent host skills */}
        <div className="mb-3 space-y-1.5">
          <div className="mb-1 flex items-center gap-1 text-3xs font-medium text-text-secondary">
            <Sparkles size={ICON.nano} className="text-text-quaternary" />
            {t("settings:companions.agentsTitle")}
            {agents.length > 0 ? (
              <div className="ml-auto flex gap-1">
                {agents.some((h) => h.present && h.skillsRoot && !h.installed) ? (
                  <Tooltip content={t("settings:companions.installAllTooltip")}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-3xs"
                      disabled={Boolean(busy)}
                      onClick={() => void installAllSkills()}
                    >
                      {busy === "install-all" ? (
                        <Loader2 size={ICON.micro} className="animate-spin" />
                      ) : (
                        <Download size={ICON.micro} />
                      )}
                      {t("settings:companions.installAll")}
                    </Button>
                  </Tooltip>
                ) : null}
                {agents.some((h) => h.installed) ? (
                  <Tooltip content={t("settings:companions.upgradeAllTooltip")}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-3xs"
                      disabled={Boolean(busy)}
                      onClick={() => void upgradeAllSkills()}
                    >
                      {busy === "upgrade-all" ? (
                        <Loader2 size={ICON.micro} className="animate-spin" />
                      ) : (
                        <RefreshCw size={ICON.micro} />
                      )}
                      {t("settings:companions.upgradeAll")}
                    </Button>
                  </Tooltip>
                ) : null}
              </div>
            ) : null}
          </div>
          {agents.length === 0 && !compLoading ? (
            <div className="text-3xs text-text-quaternary">{t("settings:companions.noAgents")}</div>
          ) : null}
          {agents.map((host) => {
            const isBusy =
              busy === `install:${host.id}` ||
              busy === `upgrade:${host.id}` ||
              busy === `uninstall:${host.id}`;
            return (
              <div
                key={host.id}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-3xs font-medium text-text-secondary">{host.name}</span>
                    <StatusDot
                      ok={host.present}
                      label={
                        host.present
                          ? t("settings:companions.hostPresent")
                          : t("settings:companions.hostAbsent")
                      }
                    />
                    {host.installed ? (
                      <span className="font-mono text-3xs text-text-tertiary">
                        v{host.installedVersion || "?"}
                      </span>
                    ) : (
                      <span className="text-3xs text-text-quaternary">
                        {t("settings:companions.skillsNotInstalled")}
                      </span>
                    )}
                  </div>
                  {host.skillsRoot ? (
                    <Tooltip content={host.skillsRoot}>
                      <div className="mt-0.5 truncate font-mono text-3xs text-text-quaternary">
                        {host.skillsRoot}
                      </div>
                    </Tooltip>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {!host.installed ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-3xs"
                      disabled={!host.skillsRoot || Boolean(busy)}
                      onClick={() =>
                        void runCompanion(`install:${host.id}`, async () => {
                          const r = await api.sys.installCompanionSkills(host.id);
                          flashOk(
                            t("settings:companions.okInstalled", {
                              host: host.name,
                              version: r.version || "?",
                            }),
                          );
                        })
                      }
                    >
                      {isBusy && busy === `install:${host.id}` ? (
                        <Loader2 size={ICON.micro} className="animate-spin" />
                      ) : (
                        <Download size={ICON.micro} />
                      )}
                      {t("settings:companions.install")}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-3xs"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void runCompanion(`upgrade:${host.id}`, async () => {
                            const r = await api.sys.upgradeCompanionSkills(host.id);
                            flashOk(
                              t("settings:companions.okUpgraded", {
                                host: host.name,
                                version: r.version || "?",
                              }),
                            );
                          })
                        }
                      >
                        {busy === `upgrade:${host.id}` ? (
                          <Loader2 size={ICON.micro} className="animate-spin" />
                        ) : (
                          <RefreshCw size={ICON.micro} />
                        )}
                        {t("settings:companions.upgrade")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-3xs"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void runCompanion(`uninstall:${host.id}`, async () => {
                            await api.sys.uninstallCompanionSkills(host.id);
                            flashOk(t("settings:companions.okUninstalled", { host: host.name }));
                          })
                        }
                      >
                        {busy === `uninstall:${host.id}` ? (
                          <Loader2 size={ICON.micro} className="animate-spin" />
                        ) : (
                          <Trash2 size={ICON.micro} />
                        )}
                        {t("settings:companions.uninstall")}
                      </Button>
                    </>
                  )}
                  {host.skillsRoot ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6"
                      onClick={() => void api.sys.openPath(host.skillsRoot!)}
                    >
                      <FolderOpen size={ICON.micro} />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Clip extension */}
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-1 text-3xs font-medium text-text-secondary">
            <Puzzle size={ICON.nano} className="text-text-quaternary" />
            {t("settings:companions.clipTitle")}
          </div>
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {browsers.map((b) => (
              <span
                key={b.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-3xs",
                  b.present
                    ? "border-border-subtle bg-surface-muted/40 text-text-secondary"
                    : "border-border-subtle-dim text-text-quaternary",
                )}
              >
                <Globe size={ICON.nano} />
                {b.name}
                {b.present ? "" : ` · ${t("settings:companions.notFound")}`}
              </span>
            ))}
          </div>
          <div className="rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-2 text-3xs">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-text-secondary">
              {clip?.prepared
                ? t("settings:companions.clipPrepared", { version: clip.version || "?" })
                : t("settings:companions.clipNotPrepared")}
            </div>
            <p className="mb-2 text-text-tertiary">{t("settings:companions.clipGuidedInstructions")}</p>
            <div className="flex flex-wrap gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-3xs"
                disabled={Boolean(busy)}
                onClick={() =>
                  void runCompanion("clip", async () => {
                    const r = await api.sys.prepareClipExtension();
                    flashOk(
                      t("settings:companions.okClipPrepared", { version: r.version || "?" }),
                    );
                  })
                }
              >
                {busy === "clip" ? (
                  <Loader2 size={ICON.micro} className="animate-spin" />
                ) : (
                  <Download size={ICON.micro} />
                )}
                {t("settings:companions.prepareExtension")}
              </Button>
              {clip?.prepared ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-3xs"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void runCompanion("clip-uninstall", async () => {
                      await api.sys.uninstallClipExtension();
                      flashOk(t("settings:companions.okClipUninstalled"));
                    })
                  }
                >
                  {busy === "clip-uninstall" ? (
                    <Loader2 size={ICON.micro} className="animate-spin" />
                  ) : (
                    <Trash2 size={ICON.micro} />
                  )}
                  {t("settings:companions.uninstall")}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-3xs"
                onClick={() => void api.sys.openClipExtensionFolder()}
              >
                <FolderOpen size={ICON.micro} />
                {t("settings:companions.openFolder")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-3xs"
                onClick={() =>
                  void api.sys.openUrl(
                    "https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked",
                  )
                }
              >
                <ExternalLink size={ICON.micro} />
                {t("settings:companions.loadUnpackedDocs")}
              </Button>
            </div>
            {compStatus?.bundled?.extensionVersion ? (
              <div className="mt-1.5 text-text-quaternary">
                {t("settings:companions.bundledExtension", {
                  version: compStatus.bundled.extensionVersion,
                })}
              </div>
            ) : null}
            {clip?.path ? (
              <Tooltip content={clip.path}>
                <div className="mt-1.5 truncate font-mono text-3xs text-text-quaternary">
                  {clip.path}
                </div>
              </Tooltip>
            ) : null}
          </div>
        </div>

        {/* Obsidian plugin */}
        <div>
          <div className="mb-1 flex items-center gap-1 text-3xs font-medium text-text-secondary">
            <BookOpen size={ICON.nano} className="text-text-quaternary" />
            {t("settings:companions.obsidianTitle")}
          </div>
          <div className="rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-2 text-3xs">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <StatusDot
                ok={Boolean(obsidian?.appPresent)}
                label={
                  obsidian?.appPresent
                    ? t("settings:companions.appPresent")
                    : t("settings:companions.appAbsent")
                }
              />
              {obsidian?.pluginInstalled ? (
                <span className="font-mono text-text-tertiary">
                  {obsidian.pluginId} v{obsidian.pluginVersion || "?"}
                </span>
              ) : (
                <span className="text-text-quaternary">
                  {t("settings:companions.pluginNotInstalled")}
                </span>
              )}
              {obsidian?.appPresent && obsidian?.appPath ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 text-3xs"
                  onClick={() => void api.sys.openPath(obsidian.appPath!)}
                >
                  <ExternalLink size={ICON.nano} />
                  {t("settings:companions.openObsidianApp")}
                </Button>
              ) : null}
            </div>
            {obsidian?.vaultPluginsRoot ? (
              <div className="mb-2 text-text-tertiary">
                {t("settings:companions.vaultReady")}
                <Tooltip content={obsidian.vaultPluginsRoot}>
                  <div className="truncate font-mono text-3xs text-text-quaternary">
                    {obsidian.vaultPluginsRoot}
                  </div>
                </Tooltip>
              </div>
            ) : (
              <div className="mb-2">
                <p className="text-text-quaternary">{t("settings:companions.vaultNotReady")}</p>
                <p className="mt-1 text-text-quaternary">
                  {t("settings:companions.vaultNotReadyHint")}
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-3xs"
                disabled={Boolean(busy) || !obsidian?.vaultPluginsRoot}
                onClick={() =>
                  void runCompanion("obsidian-install", async () => {
                    const r = await api.sys.installObsidianPlugin();
                    if (r.ok === false) {
                      // Always throw — runCompanion catch sets compError and
                      // skips reloadCompanions (which would clear the error).
                      throw new Error(
                        t("settings:companions.obsidianInstallFailed", {
                          error: r.error || t("settings:companions.vaultNotReady"),
                        }),
                      );
                    }
                    flashOk(
                      t("settings:companions.okObsidianInstalled", {
                        version: r.version || "?",
                      }),
                    );
                    // Show reload hint as a secondary flash after a short delay
                    setTimeout(() => {
                      flashOk(t("settings:companions.obsidianReloadHint"));
                    }, 5000);
                  })
                }
              >
                {busy === "obsidian-install" ? (
                  <Loader2 size={ICON.micro} className="animate-spin" />
                ) : (
                  <Download size={ICON.micro} />
                )}
                {t("settings:companions.installToVault")}
              </Button>
              {obsidian?.pluginInstalled ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-3xs"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void runCompanion("obsidian-uninstall", async () => {
                      await api.sys.uninstallObsidianPlugin();
                      flashOk(t("settings:companions.okObsidianUninstalled"));
                    })
                  }
                >
                  {busy === "obsidian-uninstall" ? (
                    <Loader2 size={ICON.micro} className="animate-spin" />
                  ) : (
                    <Trash2 size={ICON.micro} />
                  )}
                  {t("settings:companions.uninstall")}
                </Button>
              ) : null}
              {/* Open vault plugins folder whenever vault is ready — even before plugin is installed */}
              {obsidian?.vaultPluginsRoot ? (
                <Tooltip content={t("settings:companions.openPluginsFolder")}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-3xs"
                    onClick={() =>
                      void api.sys.openPath(
                        obsidian.pluginPath || obsidian.vaultPluginsRoot!,
                      )
                    }
                  >
                    <FolderOpen size={ICON.micro} />
                    {t("settings:companions.openPluginsFolder")}
                  </Button>
                </Tooltip>
              ) : null}
            </div>
            {obsidian?.pluginInstalled ? (
              <div className="mt-1.5 text-text-quaternary">
                {t("settings:companions.obsidianReloadHint")}
              </div>
            ) : null}
            {compStatus?.bundled?.obsidianPluginVersion ? (
              <div className="mt-1.5 text-text-quaternary">
                {t("settings:companions.bundledPlugin", {
                  version: compStatus.bundled.obsidianPluginVersion,
                })}
              </div>
            ) : null}
          </div>
        </div>
      </SettingsSection>

      {/* ── Health diagnostics ────────────────────────────────────────── */}
      <SettingsSection
        title={t("settings:about.healthTitle")}
        description={t("settings:about.healthDesc")}
        action={
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-3xs"
            onClick={() => void runDoctor()}
            disabled={doctorLoading}
          >
            {doctorLoading ? (
              <Loader2 size={ICON.micro} className="animate-spin" />
            ) : (
              <Zap size={ICON.micro} />
            )}
            {t("settings:about.diagnoseButton")}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-3xs text-text-tertiary">
          <span>
            UTR{" "}
            {utrStatus == null
              ? "…"
              : utrStatus.utrAvailable
                ? t("settings:about.utrBundled")
                : t("settings:about.utrNotReady")}
          </span>
          {pluginInfo ? (
            <span className="text-text-quaternary">
              {t("settings:about.pluginsAndSlots", { plugins: pluginInfo.plugins, slots: pluginInfo.slots })}
            </span>
          ) : null}
          {doctorResult && !doctorLoading ? (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                doctorResult.ok ? "text-success" : "text-error",
              )}
            >
              {doctorResult.ok ? (
                <CheckCircle2 size={ICON.micro} />
              ) : (
                <AlertTriangle size={ICON.micro} />
              )}
              {doctorResult.ok
                ? t("settings:about.doctorPassed")
                : doctorResult.error
                  ? t("settings:about.doctorError", { error: doctorResult.error })
                  : t("settings:about.doctorErrors", {
                      count: doctorResult.issues?.filter((i) => i.severity === "error").length ?? 0,
                    })}
            </span>
          ) : null}
        </div>
        {doctorResult?.issues && doctorResult.issues.length > 0 ? (
          <div className="v4-content-scroll mt-2 max-h-[min(360px,42vh)] overflow-auto rounded-[var(--radius-md)] border border-border-subtle bg-surface p-2.5">
            {doctorResult.issues.map((issue, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-1.5 border-b border-border-subtle-dim/60 py-1.5 text-3xs last:border-0",
                  issue.severity === "error" ? "text-error" : "text-warning",
                )}
              >
                <span className="min-w-0 flex-1 break-words leading-relaxed">
                  {issue.message || issue.code}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </SettingsSection>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-0.5 text-3xs text-text-quaternary">
        <button
          type="button"
          className="text-accent-color hover:underline"
          onClick={() => void api.sys.openUrl(PRODUCT.repoUrl)}
        >
          {PRODUCT.repoSlug}
        </button>
        <HelpTip content={t("settings:about.footerHelp")} />
      </div>
    </div>
  );
}
