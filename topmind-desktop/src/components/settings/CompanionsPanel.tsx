/**
 * Companion lifecycle UI — agent host skills, Clip extension (guided), Obsidian plugin.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  Download,
  Trash2,
  FolderOpen,
  Loader2,
  ExternalLink,
  Puzzle,
  Globe,
  Sparkles,
  BookOpen,
} from "lucide-react";
import { api, type CompanionStatusResult } from "../../services/api";
import type { AppSettings } from "../../types";
import { Button } from "../ui/Button";
import { SettingsSection, StatusDot } from "./fields";
import { ICON } from "../../lib/icons";
import { scheduleFlash } from "../../lib/flash-message";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../../lib/cn";

export function CompanionsPanel({
  settings: _settings,
}: {
  settings: AppSettings;
  onPatch?: (patch: Partial<AppSettings>) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const [status, setStatus] = useState<CompanionStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashOk = (msg: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setError(null);
    flashTimer.current = scheduleFlash(setActionMsg, msg, 4500);
  };

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const st = await api.sys.getCompanionStatus();
      setStatus(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [reload]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const agents = status?.agents || [];
  const browsers = status?.browsers || [];
  const obsidian = status?.obsidian;
  const clip = status?.clip;
  const bundledSkills = status?.bundled?.skillsVersion;

  return (
    <div>
      <SettingsSection
        title={t("settings:companions.title")}
        description={t("settings:companions.desc")}
        help={t("settings:companions.help")}
        action={
          <Button
            variant="ghost"
            size="sm"
            className="h-6"
            onClick={() => void reload()}
            disabled={loading || Boolean(busy)}
          >
            {loading ? (
              <Loader2 size={ICON.xs} className="animate-spin" />
            ) : (
              <RefreshCw size={ICON.xs} />
            )}
          </Button>
        }
      >
        {error ? (
          <div className="mb-2 rounded-[var(--radius-md)] border border-warning/30 bg-warning/5 px-2 py-1.5 text-3xs text-warning">
            {error}
          </div>
        ) : null}
        {actionMsg ? (
          <div className="mb-2 text-3xs text-success">{actionMsg}</div>
        ) : null}
        {bundledSkills ? (
          <div className="mb-2 text-3xs text-text-quaternary">
            {t("settings:companions.bundledSkills", { version: bundledSkills })}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={t("settings:companions.agentsTitle")}
        description={t("settings:companions.agentsDesc")}
      >
        <div className="space-y-1.5">
          {agents.length === 0 && !loading ? (
            <div className="text-3xs text-text-quaternary">{t("settings:companions.noAgents")}</div>
          ) : null}
          {agents.map((host) => {
            const canInstall = Boolean(host.skillsRoot);
            const isBusy = busy === `install:${host.id}` || busy === `upgrade:${host.id}` || busy === `uninstall:${host.id}`;
            return (
              <div
                key={host.id}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-2"
              >
                <Sparkles size={ICON.xs} className="shrink-0 text-text-quaternary" />
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
                      disabled={!canInstall || Boolean(busy)}
                      onClick={() =>
                        void run(`install:${host.id}`, async () => {
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
                          void run(`upgrade:${host.id}`, async () => {
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
                          void run(`uninstall:${host.id}`, async () => {
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
      </SettingsSection>

      <SettingsSection
        title={t("settings:companions.clipTitle")}
        description={t("settings:companions.clipDesc")}
        help={t("settings:companions.clipHelp")}
      >
        <div className="mb-2 flex flex-wrap gap-1.5">
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
            <Puzzle size={ICON.xs} className="text-text-quaternary" />
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
                void run("clip", async () => {
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
              onClick={() => void api.sys.openUrl("https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked")}
            >
              <ExternalLink size={ICON.micro} />
              {t("settings:companions.loadUnpackedDocs")}
            </Button>
          </div>
          {clip?.path ? (
            <Tooltip content={clip.path}>
              <div className="mt-1.5 truncate font-mono text-3xs text-text-quaternary">{clip.path}</div>
            </Tooltip>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("settings:companions.obsidianTitle")}
        description={t("settings:companions.obsidianDesc")}
        help={t("settings:companions.obsidianHelp")}
      >
        <div className="rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-2 text-3xs">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <BookOpen size={ICON.xs} className="text-text-quaternary" />
            <span className="font-medium text-text-secondary">Obsidian</span>
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
              <span className="text-text-quaternary">{t("settings:companions.pluginNotInstalled")}</span>
            )}
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
            <p className="mb-2 text-text-quaternary">{t("settings:companions.vaultNotReady")}</p>
          )}
          <div className="flex flex-wrap gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-3xs"
              disabled={Boolean(busy) || !obsidian?.vaultPluginsRoot}
              onClick={() =>
                void run("obsidian-install", async () => {
                  const r = await api.sys.installObsidianPlugin();
                  if (r.ok === false && r.guided) {
                    setError(r.error || t("settings:companions.vaultNotReady"));
                    return;
                  }
                  flashOk(
                    t("settings:companions.okObsidianInstalled", {
                      version: r.version || "?",
                    }),
                  );
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
                  void run("obsidian-uninstall", async () => {
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
            {obsidian?.pluginPath ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6"
                onClick={() => void api.sys.openPath(obsidian.pluginPath!)}
              >
                <FolderOpen size={ICON.micro} />
              </Button>
            ) : null}
          </div>
          {status?.bundled?.obsidianPluginVersion ? (
            <div className="mt-1.5 text-text-quaternary">
              {t("settings:companions.bundledPlugin", {
                version: status.bundled.obsidianPluginVersion,
              })}
            </div>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  );
}
