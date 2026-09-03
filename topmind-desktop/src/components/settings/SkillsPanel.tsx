import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiAlertLine,
  RiBookOpenLine,
  RiBox3Line,
  RiCheckboxCircleLine,
  RiDeleteBin6Line,
  RiDownload2Line,
  RiFolderAddLine,
  RiFolderOpenLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSparklingLine,
  RiTimeLine,
} from "@remixicon/react";
import { api, type SkillsExtraReceipt, type SkillsPackSummary } from "../../services/api";
import type { AppSettings } from "../../types";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";
import { SettingsSection, SwitchField, StatusDot } from "./fields";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";
import { scheduleFlash } from "../../lib/flash-message";
import { cn } from "../../lib/cn";

type SkillRow = {
  id: string;
  description: string;
  actionCategory?: string;
  entrypoint?: boolean;
  source?: string;
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function SkillsPanel({
  settings,
  onPatch,
}: {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [packVersion, setPackVersion] = useState<string | null>(null);
  const [hasShared, setHasShared] = useState(true);
  const [catalog, setCatalog] = useState<SkillRow[]>([]);
  const [extraRoots, setExtraRoots] = useState<string[]>([]);
  const [skillsRoot, setSkillsRoot] = useState<string | null>(null);
  const [managedExtraRoot, setManagedExtraRoot] = useState<string | null>(null);
  const [extraReceipt, setExtraReceipt] = useState<SkillsExtraReceipt | null>(null);
  const [extraSummaries, setExtraSummaries] = useState<SkillsPackSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<{
    path: string;
    summary: SkillsPackSummary | null;
  } | null>(null);
  const [pendingAdd, setPendingAdd] = useState<{
    path: string;
    summary: SkillsPackSummary | null;
  } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const skillsEnabled = settings.ai.skillsEnabled !== false;
  const enabledIds = settings.ai.enabledSkillIds;
  const settingsExtra = settings.ai.extraSkillsRoots || [];

  const flashOk = (msg: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setError(null);
    flashTimer.current = scheduleFlash(setActionMsg, msg, 4500);
  };

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const st = await api.sys.getSkillsStatus();
      setPackVersion(st.packVersion);
      setHasShared(st.hasShared);
      setCatalog(st.catalog || []);
      setExtraRoots(st.extraRoots || []);
      setSkillsRoot(st.skillsRoot || null);
      setManagedExtraRoot(st.managedExtraRoot || null);
      setExtraReceipt(st.extraReceipt || null);
      setExtraSummaries(st.extraSummaries || []);
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
  }, [reload, settingsExtra.join("|")]);

  const setSkillsEnabled = (on: boolean) => {
    onPatch({ ai: { skillsEnabled: on } } as Partial<AppSettings>);
  };

  const setExtraRootsPersist = (roots: string[]) => {
    onPatch({ ai: { extraSkillsRoots: roots } } as Partial<AppSettings>);
  };

  const isSkillOn = (id: string) => {
    if (!enabledIds || enabledIds.length === 0) return true;
    return enabledIds.includes(id);
  };

  const toggleSkill = (id: string) => {
    const allIds = catalog.map((c) => c.id);
    let next: string[] | null;
    if (!enabledIds || enabledIds.length === 0) {
      next = allIds.filter((x) => x !== id);
    } else if (enabledIds.includes(id)) {
      next = enabledIds.filter((x) => x !== id);
    } else {
      next = [...enabledIds, id];
    }
    if (next && next.length === allIds.length) next = null;
    if (next && next.length === 0) next = [id];
    onPatch({ ai: { enabledSkillIds: next } } as Partial<AppSettings>);
  };

  const beginAddRoot = async () => {
    setBusy("add");
    setError(null);
    try {
      const { path } = await api.sys.pickSkillsFolder();
      if (!path) return;
      const probe = await api.sys.probeSkillsPack(path);
      if (!probe.ok) {
        setError(t("settings:skills.errNotPack"));
        return;
      }
      if (settingsExtra.includes(probe.path)) {
        flashOk(t("settings:skills.errAlreadyExists"));
        return;
      }
      setPendingAdd({ path: probe.path, summary: probe.summary || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmAddRoot = () => {
    if (!pendingAdd) return;
    const next = [...settingsExtra, pendingAdd.path];
    setExtraRootsPersist(next);
    setPendingAdd(null);
    flashOk(t("settings:skills.okAdded"));
  };

  const beginInstallToManaged = async () => {
    setBusy("install");
    setError(null);
    try {
      const { path } = await api.sys.pickSkillsFolder();
      if (!path) return;
      const probe = await api.sys.probeSkillsPack(path);
      if (!probe.ok) {
        setError(t("settings:skills.errNotPackShort"));
        return;
      }
      setPendingInstall({ path: probe.path, summary: probe.summary || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmInstall = async () => {
    if (!pendingInstall) return;
    setBusy("installing");
    setError(null);
    try {
      const r = await api.sys.installSkillsPackLocal(pendingInstall.path);
      const next = [...settingsExtra];
      if (!next.includes(r.dest)) next.push(r.dest);
      setExtraRootsPersist(next);
      setPendingInstall(null);
      const ver = r.version ? ` v${r.version}` : "";
      flashOk(t("settings:skills.okInstalled", { count: r.installed.filter((x) => !x.includes(".")).length, ver }));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveRoot = (root: string) => {
    setExtraRootsPersist(settingsExtra.filter((r) => r !== root));
    flashOk(t("settings:skills.okRemoved"));
  };

  const enabledCount = catalog.filter((s) => isSkillOn(s.id)).length;
  const extCount = catalog.filter((s) => s.source === "external").length;
  const receipt = extraReceipt;

  return (
    <div>
      <SettingsSection
        title={t("settings:skills.mode")}
        description={t("settings:skills.modeDesc")}
        action={
          <StatusDot
            ok={skillsEnabled && hasShared}
            label={
              skillsEnabled
                ? t("settings:skills.statusOn", { ver: packVersion || "?", enabled: enabledCount, total: catalog.length })
                : t("settings:skills.statusOff")
            }
          />
        }
      >
        <SwitchField
          label={t("settings:skills.skillFirst")}
          description={t("settings:skills.skillFirstDesc")}
          checked={skillsEnabled}
          onChange={setSkillsEnabled}
        />
        <div className="mt-1.5 grid gap-1 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface px-2.5 py-2 text-3xs text-text-tertiary">
          <div className="flex items-center gap-1.5">
            <RiBox3Line size={ICON.xs} className="text-text-quaternary" />
            <span>
              {t("settings:skills.bundledPack")} <span className="font-mono text-text-secondary">v{packVersion || "—"}</span>
              {hasShared ? (
                <span className="ml-1.5 text-success">{t("settings:skills.sharedOk")}</span>
              ) : (
                <span className="ml-1.5 text-warning">{t("settings:skills.sharedMissing")}</span>
              )}
            </span>
          </div>
          {skillsRoot ? (
            <Tooltip content={skillsRoot}>
              <div className="truncate font-mono text-3xs text-text-quaternary">{skillsRoot}</div>
            </Tooltip>
          ) : null}
          <div className="text-3xs text-text-quaternary">
            {t("settings:skills.manifest", { count: catalog.length, ext: extCount, roots: extraRoots.length })}
          </div>
        </div>
        <div className="mt-1 flex justify-end">
          <Button variant="ghost" size="sm" className="h-6" onClick={() => void reload()} disabled={loading}>
            {loading ? <RiLoader4Line size={ICON.xs} className="animate-spin" /> : <RiRefreshLine size={ICON.xs} />}
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("settings:skills.extraDirs")}
        description={t("settings:skills.extraDirsDesc")}
        help={t("settings:skills.extraDirsHelp")}
        action={
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-3xs"
              disabled={Boolean(busy)}
              onClick={() => void beginAddRoot()}
            >
              <RiFolderAddLine size={ICON.micro} /> {t("settings:skills.addDir")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-3xs"
              disabled={Boolean(busy)}
              onClick={() => void beginInstallToManaged()}
            >
              <RiDownload2Line size={ICON.micro} /> {t("settings:skills.installLocal")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-3xs"
              onClick={() => void api.sys.openSkillsExtraDir()}
            >
              <RiFolderOpenLine size={ICON.micro} />
            </Button>
          </div>
        }
      >
        {managedExtraRoot ? (
          <div className="mb-1.5 text-3xs text-text-quaternary">{t("settings:skills.managedDir", { path: managedExtraRoot })}</div>
        ) : null}

        {/* Install receipt / version */}
        {receipt || (extraSummaries.length > 0 && managedExtraRoot) ? (
          <div className="mb-2 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-2 text-3xs">
            <div className="mb-1 flex items-center gap-1 font-medium text-text-secondary">
              <RiTimeLine size={ICON.xs} className="text-text-quaternary" />
              {t("settings:skills.installReceipt")}
            </div>
            {receipt ? (
              <div className="space-y-0.5 text-text-tertiary">
                <div>
                  {t("settings:skills.receiptTime", { time: formatWhen(receipt.installedAt) })}
                  {receipt.version ? (
                    <span className="ml-1.5 font-mono text-text-secondary">v{receipt.version}</span>
                  ) : null}
                </div>
                {receipt.source ? (
                  <Tooltip content={receipt.source}>
                    <div className="truncate font-mono text-3xs text-text-quaternary">{t("settings:skills.receiptSource", { source: receipt.source })}</div>
                  </Tooltip>
                ) : null}
                {receipt.entries?.length ? (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {receipt.entries.slice(0, 12).map((e) => (
                      <span key={e} className="rounded bg-surface-muted px-1.5 py-px font-mono text-3xs">
                        {e}
                      </span>
                    ))}
                    {receipt.entries.length > 12 ? (
                      <span className="text-3xs text-text-quaternary">+{receipt.entries.length - 12}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-text-quaternary">{t("settings:skills.noReceipt")}</div>
            )}
          </div>
        ) : null}

        {/* Per-root summaries */}
        {extraSummaries.length > 0 ? (
          <div className="mb-2 space-y-1">
            {extraSummaries.map((s) => (
              <div
                key={s.path}
                className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface-muted/20 px-2 py-1.5 text-3xs"
              >
                <RiBox3Line size={ICON.xs} className="mt-0.5 shrink-0 text-text-quaternary" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-text-secondary">{s.name || "skills"}</span>
                    {s.version ? (
                      <span className="font-mono text-3xs text-text-quaternary">v{s.version}</span>
                    ) : null}
                    <span className="text-3xs text-text-quaternary">{s.skillCount} skills</span>
                    {s.hasShared ? (
                      <span className="text-3xs text-success">shared</span>
                    ) : (
                      <span className="text-3xs text-warning">no shared</span>
                    )}
                  </div>
                  <div className="truncate font-mono text-3xs text-text-quaternary" title={s.path}>
                    {s.path}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {settingsExtra.length ? (
          <ul className="m-0 list-none space-y-1 p-0">
            {settingsExtra.map((root) => {
              const sum = extraSummaries.find((s) => s.path === root);
              return (
                <li
                  key={root}
                  className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2 py-1.5 text-3xs"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-text-secondary" title={root}>
                      {root}
                    </span>
                    {sum ? (
                      <span className="text-3xs text-text-quaternary">
                        {sum.version ? `v${sum.version} · ` : ""}
                        {sum.skillCount} skills
                        {sum.hasShared ? "" : ` · ${t("settings:skills.noShared")}`}
                      </span>
                    ) : null}
                  </span>
                  <Tooltip content={t("settings:skills.removeFromList")}>
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-text-quaternary hover:text-error"
                      onClick={() => handleRemoveRoot(root)}
                      aria-label={t("settings:skills.removeFromList")}
                    >
                      <RiDeleteBin6Line size={ICON.micro} />
                    </button>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-[var(--radius-md)] border border-dashed border-border-subtle px-3 py-2 text-3xs text-text-quaternary">
            {t("settings:skills.noExtraDirs")}
          </div>
        )}
        {actionMsg ? (
          <div className="mt-1.5 flex items-center gap-1 text-3xs text-success">
            <RiCheckboxCircleLine size={ICON.xs} />
            {actionMsg}
          </div>
        ) : null}
      </SettingsSection>

      {error ? (
        <div className="mb-2 flex items-start gap-1.5 text-xs text-error">
          <RiAlertLine size={ICON.xs} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <SettingsSection
        title={t("settings:skills.catalog")}
        description={t("settings:skills.catalogDesc")}
      >
        {loading && catalog.length === 0 ? (
          <div className="flex items-center gap-2 text-3xs text-text-tertiary">
            <RiLoader4Line size={ICON.xs} className="animate-spin" /> {t("settings:skills.loadingSkills")}
          </div>
        ) : (
          <ul className="m-0 list-none space-y-1.5 p-0">
            {catalog.map((s) => (
              <li key={s.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-md)] border px-2.5 py-2 text-3xs transition-colors",
                    isSkillOn(s.id)
                      ? "border-border-subtle-dim bg-surface hover:border-border-subtle"
                      : "border-border-subtle-dim/60 bg-surface-muted/20 opacity-65",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={isSkillOn(s.id)}
                    disabled={!skillsEnabled}
                    onChange={() => toggleSkill(s.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium text-text-primary">
                      {s.entrypoint ? (
                        <RiSparklingLine size={ICON.xs} className="text-accent-color" />
                      ) : (
                        <RiBookOpenLine size={ICON.xs} className="text-text-quaternary" />
                      )}
                      <span className="font-mono text-3xs">{s.id.replace(/^topmind-?/, "") || s.id}</span>
                      {s.actionCategory ? (
                        <span className="rounded bg-surface-muted px-1.5 py-px text-3xs text-text-tertiary">
                          {s.actionCategory}
                        </span>
                      ) : null}
                      {s.source === "external" ? (
                        <span className="rounded bg-warning/15 px-1.5 py-px text-3xs text-warning">ext</span>
                      ) : null}
                    </span>
                    <span className="mt-1 block leading-relaxed text-text-tertiary">
                      {s.description}
                    </span>
                  </span>
                </label>
              </li>
            ))}
            {catalog.length === 0 && !loading ? (
              <li className="text-3xs text-text-tertiary">
                {t("settings:skills.noSkills")}
              </li>
            ) : null}
          </ul>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={Boolean(pendingAdd)}
        title={t("settings:skills.addConfirmTitle")}
        description={t("settings:skills.addConfirmDesc")}
        confirmText={t("settings:skills.addConfirmBtn")}
        cancelText={t("common:action.cancel")}
        onCancel={() => setPendingAdd(null)}
        onConfirm={confirmAddRoot}
      >
        {pendingAdd?.summary ? (
          <div className="rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-2 text-3xs text-text-tertiary">
            <div className="font-medium text-text-secondary">
              {pendingAdd.summary.name || "skills"}
              {pendingAdd.summary.version ? (
                <span className="ml-1.5 font-mono text-text-quaternary">v{pendingAdd.summary.version}</span>
              ) : null}
            </div>
            <div>
              {pendingAdd.summary.skillCount} skills
              {pendingAdd.summary.hasShared ? " · shared OK" : ` · ${t("settings:skills.noShared")}`}
            </div>
            <div className="mt-0.5 truncate font-mono text-3xs text-text-quaternary">{pendingAdd.path}</div>
          </div>
        ) : pendingAdd ? (
          <div className="font-mono text-3xs text-text-quaternary">{pendingAdd.path}</div>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(pendingInstall)}
        title={t("settings:skills.installConfirmTitle")}
        description={t("settings:skills.installConfirmDesc")}
        confirmText={t("settings:skills.installConfirmBtn")}
        cancelText={t("common:action.cancel")}
        onCancel={() => setPendingInstall(null)}
        onConfirm={() => void confirmInstall()}
      >
        {pendingInstall?.summary ? (
          <div className="rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-2 text-3xs text-text-tertiary">
            <div className="font-medium text-text-secondary">
              {pendingInstall.summary.name || "skills"}
              {pendingInstall.summary.version ? (
                <span className="ml-1.5 font-mono text-text-quaternary">
                  v{pendingInstall.summary.version}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5">
              {pendingInstall.summary.skillCount} skills
              {pendingInstall.summary.hasShared ? " · shared OK" : ` · ${t("settings:skills.noSharedSuggest")}`}
            </div>
            {pendingInstall.summary.skillIds?.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {pendingInstall.summary.skillIds.slice(0, 10).map((id) => (
                  <span key={id} className="rounded bg-surface-muted px-1.5 py-px font-mono text-3xs">
                    {id}
                  </span>
                ))}
                {pendingInstall.summary.skillIds.length > 10 ? (
                  <span className="text-3xs text-text-quaternary">
                    +{pendingInstall.summary.skillIds.length - 10}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="mt-1 truncate font-mono text-3xs text-text-quaternary">{pendingInstall.path}</div>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
