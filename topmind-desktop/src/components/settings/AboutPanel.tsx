import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, CheckCircle2, AlertTriangle, Zap, RefreshCw, Download, ExternalLink } from "lucide-react";
import { api } from "../../services/api";
import { registry } from "../../plugins/registry";
import { usePluginStore } from "../../stores/plugin-store";
import { Button } from "../ui/Button";
import { cn } from "../../lib/cn";
import type { AppSettings } from "../../types";
import { SettingsSection, HelpTip } from "./fields";
import { ICON } from "../../lib/icons";
import { PRODUCT } from "../../lib/product";
import type { SurfaceUpdateInfo } from "../../services/api";
import { Tooltip } from "../ui/tooltip";
import type { TFunction } from "i18next";

type UpdateCheckResult = Awaited<ReturnType<typeof api.sys.checkForUpdates>>;

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
): { text: string; tone: "ok" | "warn" | "muted" | "success" } {
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
    return { text: t("settings:about.updateAvailable", { version: s.latestVersion }), tone: "success" };
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
}: {
  surface: "desktop" | "skills" | "extension" | "obsidian";
  info: SurfaceUpdateInfo | undefined;
  t: TFunction;
}) {
  const status = formatSurfaceStatus(info, t);
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
      </span>
      {info?.updateAvailable && info.assets?.[0]?.url ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-3xs"
          onClick={() => void api.sys.openUpdateDownload(info.assets[0].url, surface)}
        >
          <Download size={ICON.nano} />
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

export function AboutPanel({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation(["settings", "common"]);
  const [pluginInfo, setPluginInfo] = useState<{
    plugins: number;
    slots: number;
  } | null>(null);
  const [doctorResult, setDoctorResult] = useState<{
    ok: boolean;
    error?: string;
    issues?: Array<{ severity?: string; message?: string; code?: string; path?: string }>;
  } | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [utrStatus, setUtrStatus] = useState<{ utrAvailable: boolean } | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);

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
    void api.tool
      .status()
      .then((s) => setUtrStatus(s))
      .catch(() => setUtrStatus({ utrAvailable: false }));
  }, []);

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

  const runDoctor = async () => {
    setDoctorLoading(true);
    try {
      // includeMcp=false: schema MCP scan is optional; avoids extra work on About open path
      setDoctorResult(await api.tool.doctor(false));
    } catch (e) {
      setDoctorResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setDoctorLoading(false);
    }
  };

  return (
    <div>
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
            <span className="text-sm font-semibold text-text-primary">{t("settings:about.topmindDesktop")}</span>
            <span className="font-mono text-3xs text-text-quaternary">v{__APP_VERSION__}</span>
          </div>
          <div className="truncate font-mono text-3xs text-text-quaternary">
            {settings.workspaceRoot || t("settings:about.noWorkspace")}
          </div>
        </div>
      </div>

      <SettingsSection
        title={t("settings:about.updateTitle")}
        description={t("settings:about.updateDesc")}
        help={t("settings:about.updateHelp")}
        action={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-6 text-3xs" onClick={() => void checkUpdates()} disabled={updateLoading}>
              {updateLoading ? <Loader2 size={ICON.micro} className="animate-spin" /> : <RefreshCw size={ICON.micro} />}
              {t("settings:about.checkButton")}
            </Button>
            <Tooltip content={t("settings:about.openReleasesTooltip")}>
              <Button variant="ghost" size="sm" className="h-6" onClick={() => void api.sys.openUrl(PRODUCT.releasesUrl)}>
                <ExternalLink size={ICON.micro} />
              </Button>
            </Tooltip>
          </div>
        }
      >
        {updateInfo && !updateLoading ? (
          updateInfo.ok === false ? (
            <div className="space-y-1.5">
              <div className="rounded-[var(--radius-md)] border border-warning/30 bg-warning/5 px-2 py-1.5 text-3xs text-warning">
                {updateInfo.error || t("settings:about.checkFailed")}
              </div>
              <div className="text-3xs text-text-quaternary">
                {t("settings:about.checkFailedHint")}
              </div>
              {(updateInfo.releasesUrl || updateInfo.releaseUrl) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-3xs"
                  onClick={() => void api.sys.openUrl(updateInfo.releasesUrl || updateInfo.releaseUrl || PRODUCT.releasesUrl)}
                >
                  <ExternalLink size={ICON.nano} />
                  {t("settings:about.openReleases")}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1">
              <SurfaceUpdateRow surface="desktop" info={updateInfo.desktop ?? updateInfo} t={t} />
              <SurfaceUpdateRow surface="skills" info={updateInfo.skills} t={t} />
              <SurfaceUpdateRow surface="extension" info={updateInfo.extension} t={t} />
              <SurfaceUpdateRow surface="obsidian" info={updateInfo.obsidian} t={t} />
            </div>
          )
        ) : (
          <div className="text-3xs text-text-quaternary">{t("settings:about.clickToCheck")}</div>
        )}
      </SettingsSection>

      <SettingsSection
        title={t("settings:about.healthTitle")}
        description={t("settings:about.healthDesc")}
        action={
          <Button variant="outline" size="sm" className="h-6 text-3xs" onClick={() => void runDoctor()} disabled={doctorLoading}>
            {doctorLoading ? <Loader2 size={ICON.micro} className="animate-spin" /> : <Zap size={ICON.micro} />}
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
              {doctorResult.ok ? <CheckCircle2 size={ICON.micro} /> : <AlertTriangle size={ICON.micro} />}
              {doctorResult.ok
                ? t("settings:about.doctorPassed")
                : t("settings:about.doctorErrors", { count: doctorResult.issues?.filter((i) => i.severity === "error").length ?? 0 })}
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
