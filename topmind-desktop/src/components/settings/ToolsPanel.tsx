/**
 * UTR Tools console — run cataloged contract tools against the active workspace.
 * Shares engineRoot + userWorkspaceRoot with ToolService (same as CLI pathContext).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Play, Eye, Terminal, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { api } from "../../services/api";
import { Button } from "../ui/Button";
import { Select } from "../ui/select";
import { SettingsSection } from "./fields";
import { ICON } from "../../lib/icons";
import type { AppSettings } from "../../types";

type ToolKind = {
  kind: string;
  skill?: string;
  description?: string;
  commands?: Record<
    string,
    {
      description?: string;
      exposure?: string;
      risk?: string;
      fields?: Record<string, { type?: string; required?: boolean; description?: string }>;
    }
  >;
};

type CatalogEntry = ToolKind & {
  commandList?: { name: string; description?: string; exposure?: string; risk?: string }[];
};

function normalizeCatalog(raw: unknown): CatalogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const t = item as ToolKind & {
      commands?: Array<{ name: string; description?: string; exposure?: string }> | Record<string, unknown>;
    };
    let commandList: CatalogEntry["commandList"] = [];
    if (Array.isArray(t.commands)) {
      commandList = t.commands.map((c) => ({
        name: String((c as { name?: string }).name || ""),
        description: (c as { description?: string }).description,
        exposure: (c as { exposure?: string }).exposure,
      }));
    } else if (t.commands && typeof t.commands === "object") {
      commandList = Object.entries(t.commands as Record<string, { description?: string; exposure?: string; risk?: string }>).map(
        ([name, cmd]) => ({
          name,
          description: cmd?.description,
          exposure: cmd?.exposure,
          risk: cmd?.risk,
        }),
      );
    }
    return { ...t, commandList: commandList.filter((c) => c.name) };
  });
}

export function ToolsPanel({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation(["settings", "common"]);
  const [status, setStatus] = useState<{
    utrAvailable: boolean;
    engineRoot?: string | null;
    userWorkspaceRoot?: string | null;
    utrRoot?: string | null;
    catalog?: unknown;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<string>("");
  const [command, setCommand] = useState<string>("");
  const [inputJson, setInputJson] = useState<string>("{}");
  const [busy, setBusy] = useState<"preview" | "run" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, rawCat] = await Promise.all([api.tool.status(), api.tool.catalog()]);
      setStatus(st);
      const cat = normalizeCatalog(rawCat);
      if (cat.length > 0) {
        setKind((prev) => (cat.some((c) => c.kind === prev) ? prev : cat[0].kind));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const catalog = useMemo(() => normalizeCatalog(status?.catalog), [status?.catalog]);
  const activeKind = useMemo(() => catalog.find((c) => c.kind === kind), [catalog, kind]);
  const commands = useMemo(() => activeKind?.commandList || [], [activeKind]);

  useEffect(() => {
    if (commands.length > 0) {
      setCommand((prev) => (commands.some((c) => c.name === prev) ? prev : commands[0].name));
    } else {
      setCommand("");
    }
  }, [commands]);

  const parseInput = (): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(inputJson || "{}");
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
      setError(t("settings:tools.jsonErrorObject"));
      return null;
    } catch (e) {
      setError(t("settings:tools.jsonParseFail", { error: e instanceof Error ? e.message : String(e) }));
      return null;
    }
  };

  const runPreview = async () => {
    if (!kind || !command) return;
    const input = parseInput();
    if (!input) return;
    setBusy("preview");
    setError(null);
    setResult(null);
    try {
      const res = await api.tool.preview({ kind, command, input });
      setResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runTool = async () => {
    if (!kind || !command) return;
    const input = parseInput();
    if (!input) return;
    setBusy("run");
    setError(null);
    setResult(null);
    try {
      const res = await api.tool.run({ kind, command, input, reviewed: false });
      setResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <SettingsSection
        title={t("settings:tools.titleUtr")}
        description={t("settings:tools.descUtr")}
        help={t("settings:tools.helpUtr")}
        action={
          <Button
            variant="ghost"
            size="sm"
            className="h-6"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label={t("settings:tools.refreshLabel")}
          >
            {loading ? <Loader2 size={ICON.micro} className="animate-spin" aria-hidden /> : <RefreshCw size={ICON.micro} aria-hidden />}
          </Button>
        }
      >
        {status ? (
          <div className="space-y-1.5 rounded-[var(--radius-lg)] border border-border-subtle-dim bg-surface px-2.5 py-2 font-mono text-3xs text-text-tertiary shadow-[inset_0_1px_0_0_var(--color-border-subtle-dim)]">
            <div className="flex items-center gap-1.5">
              {status.utrAvailable ? (
                <CheckCircle2 size={ICON.nano} className="text-success" aria-hidden />
              ) : (
                <AlertCircle size={ICON.nano} className="text-warning" aria-hidden />
              )}
              <span className="font-sans text-text-secondary">
                {status.utrAvailable ? t("settings:tools.ready") : t("settings:tools.unavailable")}
              </span>
            </div>
            <div className="truncate">engine: {status.engineRoot || "—"}</div>
            <div className="truncate">workspace: {status.userWorkspaceRoot || settings.workspaceRoot || "—"}</div>
            <div className="truncate">utr: {status.utrRoot || "—"}</div>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-1.5 text-3xs text-text-quaternary" role="status">
            <Loader2 size={ICON.micro} className="animate-spin" aria-hidden /> {t("settings:tools.detecting")}
          </div>
        ) : null}
      </SettingsSection>

      {!status?.utrAvailable && !loading ? (
        <div className="rounded-[var(--radius-md)] border border-warning/25 bg-status-warning-bg/50 px-3 py-2 text-3xs text-warning" role="status">
          {t("settings:tools.notFoundHelp")}
        </div>
      ) : null}

      <SettingsSection title={t("settings:tools.titleExecute")} description={t("settings:tools.descExecute")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-3xs font-medium text-text-secondary">Kind</span>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              disabled={!catalog.length}
              options={catalog.map((c) => ({ value: c.kind, label: c.kind }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-3xs font-medium text-text-secondary">Command</span>
            <Select
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              disabled={!commands.length}
              options={commands.map((c) => ({
                value: c.name,
                label: c.exposure ? `${c.name} (${c.exposure})` : c.name,
              }))}
            />
          </label>
        </div>
        {commands.find((c) => c.name === command)?.description ? (
          <p className="mt-1.5 text-3xs leading-relaxed text-text-quaternary">
            {commands.find((c) => c.name === command)?.description}
          </p>
        ) : null}
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-3xs font-medium text-text-secondary">Input JSON</span>
          <textarea
            className="min-h-[88px] w-full resize-y rounded-[var(--radius-md)] border border-border-subtle bg-input px-2 py-1.5 font-mono text-3xs leading-relaxed text-text-primary outline-none focus-visible:border-accent-color focus-visible:ring-2 focus-visible:ring-ring/35"
            value={inputJson}
            onChange={(e) => setInputJson(e.target.value)}
            spellCheck={false}
            aria-label={t("settings:tools.inputLabel")}
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="h-7 text-3xs" onClick={() => void runPreview()} disabled={!!busy || !kind || !command}>
            {busy === "preview" ? <Loader2 size={ICON.micro} className="animate-spin" aria-hidden /> : <Eye size={ICON.micro} aria-hidden />}
            {t("settings:tools.previewBtn")}
          </Button>
          <Button variant="default" size="sm" className="h-7 text-3xs" onClick={() => void runTool()} disabled={!!busy || !kind || !command}>
            {busy === "run" ? <Loader2 size={ICON.micro} className="animate-spin" aria-hidden /> : <Play size={ICON.micro} aria-hidden />}
            {t("settings:tools.runBtn")}
          </Button>
        </div>
      </SettingsSection>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-error/20 bg-status-error-bg px-2.5 py-2 text-3xs text-error" role="alert">
          {error}
        </div>
      ) : null}

      {result ? (
        <SettingsSection title={t("settings:tools.titleResult")} description={t("settings:tools.descResult")}>
          <pre className="max-h-64 overflow-auto rounded-[var(--radius-lg)] border border-border-subtle-dim bg-surface-inset px-2.5 py-2 font-mono text-3xs leading-relaxed text-text-secondary">
            {result}
          </pre>
        </SettingsSection>
      ) : null}

      <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface-muted/30 px-2.5 py-2 text-3xs text-text-quaternary">
        <Terminal size={ICON.nano} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          {t("settings:tools.warnExecute")}{" "}
          {t("settings:tools.noticeUtr")}
        </span>
      </div>
    </div>
  );
}
