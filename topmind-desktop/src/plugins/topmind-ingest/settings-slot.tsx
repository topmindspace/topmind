import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import type { PluginContext, SettingsSlot } from "../types";
import type { AppSettings, IngestSettings } from "../../types";
import { api } from "../../services/api";
import { Button } from "../../components/ui/Button";
import {
  SettingsSection,
  SwitchField,
} from "../../components/settings/fields";
import { ICON } from "../../lib/icons";

export function createIngestSettingsSlot(_ctx: PluginContext): SettingsSlot {
  return {
    kind: "settings",
    id: "topmind-ingest.settings",
    label: "Knowledge Ingest",
    labelKey: "ingest:title",
    icon: "file-input",
    order: 120,
    render: (props) => (
      <IngestSettingsPanel settings={props.settings as AppSettings} update={props.update} />
    ),
  };
}

type ToolInfo = {
  available: boolean;
  version: string | null;
  path?: string;
  viaModule?: boolean;
  source?: string;
  install?: {
    commands: string[];
    docsUrl: string;
    label: string;
    preferredIndex?: number;
    hint?: string;
  };
};

function IngestSettingsPanel({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (p: Partial<AppSettings>) => void;
}) {
  const { t } = useTranslation("ingest");
  const ing: IngestSettings = {
    enabled: true,
    keepOriginal: false,
    maxFileBytes: 80_000_000,
    maxFolderFiles: 200,
    concurrency: 1,
    defaultDest: "inbox",
    preferExternalConverters: true,
    autoConvert: true,
    confirmBeforeConvert: false,
    skipConfirmForSingleMd: true,
    openQueueOnEnqueue: false,
    ...(settings.ingest || {}),
  };

  const maxFileMb = Math.max(1, Math.round((ing.maxFileBytes || 80_000_000) / 1e6));

  const [pandoc, setPandoc] = useState<ToolInfo | null>(null);
  const [markitdown, setMarkitdown] = useState<ToolInfo | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [probing, setProbing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const patch = (partial: Partial<IngestSettings>) =>
    update({ ingest: { ...ing, ...partial } } as Partial<AppSettings>);

  /** force=false reads disk cache; missing cache triggers one probe (first use). */
  const refreshTools = async (force = false) => {
    setProbing(true);
    try {
      const st = await api.ingest.toolsStatus(force);
      setPandoc(st.pandoc);
      setMarkitdown(st.markitdown);
      setCheckedAt(st.checkedAt || null);
      setFromCache(Boolean(st.fromCache));
    } catch {
      setPandoc(null);
      setMarkitdown(null);
      setCheckedAt(null);
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    // No force: use cache or first-time auto probe only
    void refreshTools(false);
  }, []);

  const copyCmd = async (tool: "pandoc" | "markitdown", index?: number) => {
    const r = await api.ingest.copyInstallCommand(tool, index);
    if (r.command) setHint(t("settingsSlot.copied", { command: r.command }));
  };

  return (
    <div className="space-y-4">
      <SettingsSection title={t("settingsSlot.pipelineTitle")} description={t("settingsSlot.pipelineDesc")}>
        <SwitchField
          label={t("settingsSlot.enableUi")}
          description={t("settingsSlot.enableUiDesc")}
          checked={ing.enabled !== false}
          onChange={(v) => patch({ enabled: v })}
        />
        <SwitchField
          label={t("settingsSlot.autoMd")}
          description={t("settingsSlot.autoMdDesc")}
          checked={ing.autoConvert !== false}
          onChange={(v) => patch({ autoConvert: v })}
        />
        <SwitchField
          label={t("settingsSlot.confirmBefore")}
          description={t("settingsSlot.confirmBeforeDesc")}
          checked={ing.confirmBeforeConvert === true}
          onChange={(v) => patch({ confirmBeforeConvert: v })}
        />
        <SwitchField
          label={t("settingsSlot.openQueue")}
          description={t("settingsSlot.openQueueDesc")}
          checked={ing.openQueueOnEnqueue === true}
          onChange={(v) => patch({ openQueueOnEnqueue: v })}
        />
        <SwitchField
          label={t("settingsSlot.keepOriginal")}
          description={t("settingsSlot.keepOriginalDesc")}
          checked={ing.keepOriginal === true}
          onChange={(v) => patch({ keepOriginal: v })}
        />
        <SwitchField
          label={t("settingsSlot.preferExternal")}
          description={t("settingsSlot.preferExternalDesc")}
          checked={ing.preferExternalConverters !== false}
          onChange={(v) => patch({ preferExternalConverters: v })}
        />
        <div className="mt-2">
          <label className="mb-1 block text-3xs font-medium tracking-tight text-text-secondary" htmlFor="ingest-max-mb">
            {t("settingsSlot.maxFileLabel")}
          </label>
          <select
            id="ingest-max-mb"
            className="w-full max-w-[12rem] rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2 py-1.5 text-3xs text-text-primary outline-none focus-visible:border-accent-color focus-visible:ring-2 focus-visible:ring-ring/35"
            value={String(
              [25, 50, 80, 100, 150, 200].includes(maxFileMb) ? maxFileMb : 80,
            )}
            onChange={(e) => {
              const mb = Number(e.target.value) || 80;
              patch({ maxFileBytes: Math.min(mb, 200) * 1_000_000 });
            }}
          >
            <option value="25">25 MB</option>
            <option value="50">50 MB</option>
            <option value="80">{t("settingsSlot.maxFile80Default")}</option>
            <option value="100">100 MB</option>
            <option value="150">150 MB</option>
            <option value="200">{t("settingsSlot.maxFile200Max")}</option>
          </select>
          <p className="mt-1 text-3xs leading-snug text-text-quaternary">
            {t("settingsSlot.maxFileHint")}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("settingsSlot.enhanceTitle")}
        description={t("settingsSlot.enhanceDesc")}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-3xs font-medium text-text-secondary">{t("settingsSlot.localTools")}</span>
            {checkedAt ? (
              <p className="text-3xs text-text-quaternary">
                {fromCache ? t("settingsSlot.cachePrefix") : t("settingsSlot.freshPrefix")}
                {new Date(checkedAt).toLocaleString()}
              </p>
            ) : (
              <p className="text-3xs text-text-quaternary">{t("settingsSlot.notYetChecked")}</p>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-7 text-3xs" onClick={() => void refreshTools(true)} disabled={probing}>
            {probing ? <Loader2 size={ICON.xs} className="animate-spin" aria-hidden /> : <RefreshCw size={ICON.xs} aria-hidden />}
            {t("settingsSlot.recheck")}
          </Button>
        </div>
        <div className="space-y-2">
          <ToolRow
            name="markitdown"
            subtitle={t("settingsSlot.markitdownSubtitle")}
            info={markitdown}
            onCopy={(i) => void copyCmd("markitdown", i)}
            onDocs={() => void api.ingest.openInstallHelp("markitdown")}
          />
          <ToolRow
            name="pandoc"
            subtitle={t("settingsSlot.pandocSubtitle")}
            info={pandoc}
            onCopy={(i) => void copyCmd("pandoc", i)}
            onDocs={() => void api.ingest.openInstallHelp("pandoc")}
          />
        </div>
        {hint ? (
          <p className="mt-2 text-3xs text-text-tertiary" role="status">
            {hint}
          </p>
        ) : null}
        <p className="mt-2 text-3xs leading-relaxed text-text-quaternary">
          {t("settingsSlot.installHint")}
        </p>
      </SettingsSection>
    </div>
  );
}

function ToolRow({
  name,
  subtitle,
  info,
  onCopy,
  onDocs,
}: {
  name: string;
  subtitle?: string;
  info: ToolInfo | null;
  onCopy: (index?: number) => void;
  onDocs: () => void;
}) {
  const { t } = useTranslation("ingest");
  const ok = info?.available;
  const commands = info?.install?.commands || [];
  const preferred =
    typeof info?.install?.preferredIndex === "number" ? info.install.preferredIndex : 0;
  const installHint = info?.install?.hint;

  return (
    <div className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-elevated px-2.5 py-2 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            ok
              ? "h-2 w-2 shrink-0 rounded-full bg-success"
              : "h-2 w-2 shrink-0 rounded-full bg-text-quaternary/40"
          }
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="text-3xs font-medium text-text-primary">
            {name}
            {subtitle ? (
              <span className="ml-1.5 font-normal text-text-quaternary">· {subtitle}</span>
            ) : null}
          </div>
          <div className="truncate font-mono text-3xs text-text-quaternary" title={ok ? info?.path || "" : ""}>
            {ok
              ? t("settingsSlot.installed", { version: info?.version || "", module: info?.viaModule ? " · module" : "", path: info?.path ? ` · ${info.path}` : "" })
              : info?.install?.label
                ? t("settingsSlot.notDetectedInstall", { label: info.install.label })
                : t("settingsSlot.notDetected")}
          </div>
        </div>
        {ok ? (
          <span className="rounded-full bg-status-success-bg px-1.5 py-0.5 text-3xs font-medium text-success">
            {t("settingsSlot.ready")}
          </span>
        ) : (
          <Button size="sm" variant="ghost" className="h-7 text-3xs" onClick={onDocs}>
            <ExternalLink size={ICON.xs} aria-hidden /> {t("settingsSlot.docs")}
          </Button>
        )}
      </div>
      {!ok && commands.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-border-subtle-dim pt-2">
          {commands.map((cmd, i) => (
            <li key={cmd} className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded bg-surface-muted/80 px-1.5 py-0.5 font-mono text-3xs text-text-secondary" title={cmd}>
                {cmd}
              </code>
              <Button
                size="sm"
                variant={i === preferred ? "default" : "outline"}
                className="h-7 shrink-0 text-3xs"
                onClick={() => onCopy(i)}
              >
                <Copy size={ICON.xs} aria-hidden />
                {i === preferred ? t("settingsSlot.copyPreferred") : t("settingsSlot.copy")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {!ok && installHint ? (
        <p className="mt-1.5 text-3xs leading-relaxed text-text-quaternary">{installHint}</p>
      ) : null}
    </div>
  );
}
