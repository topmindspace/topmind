/**
 * Weread Settings — compact, help-via-tooltip, aligned with global settings IA.
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Zap, RefreshCw, ExternalLink } from "lucide-react";
import { api } from "../../services/api";
import type { PluginContext, SettingsSlot } from "../types";
import type { AppSettings } from "../../types";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/select";
import {
  Field,
  KeyField,
  SettingsSection,
  SwitchField,
  StatusDot,
} from "../../components/settings/fields";
import { useViewStore } from "../../stores/view-store";
import { ICON } from "../../lib/icons";
import { intlLocale } from "../../locales";

export function createWereadSettingsSlot(_ctx: PluginContext): SettingsSlot {
  return {
    kind: "settings",
    id: "topmind-weread.settings",
    label: "Weread",
    labelKey: "weread:name",
    icon: "book-open",
    order: 200,
    render: (props) => <WereadPanel settings={props.settings as AppSettings} update={props.update} />,
  };
}

function WereadPanel({ settings, update }: { settings: AppSettings; update: (p: Partial<AppSettings>) => void }) {
  const { t } = useTranslation("weread");
  const w = settings.weread;
  const select = useViewStore((s) => s.select);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [resolvedCategory, setResolvedCategory] = useState<string>("");

  useEffect(() => {
    void api.ws.categories().then((r) => {
      const names = (r.categories || [])
        .map((c) => c.name || c.directory || "")
        .filter((n): n is string => Boolean(n));
      setCategories(names);
    }).catch(() => setCategories([]));
    void api.weread.status().then((s) => {
      if (s.syncCategory) setResolvedCategory(s.syncCategory);
    }).catch(() => {});
  }, [w.syncCategory]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.weread.sync();
      const bits = [
        t("settings.updatedBooks", { count: result.synced }),
        result.totalThoughts ? t("settings.thoughtsCount", { count: result.totalThoughts }) : null,
        result.skippedNoChange ? t("settings.noChangeCount", { count: result.skippedNoChange }) : null,
        result.remaining ? t("settings.remainingCount", { count: result.remaining }) : null,
        result.syncCategory ? `→ ${result.syncCategory}/` : null,
      ].filter(Boolean);
      setSyncResult(bits.join(" · "));
      if (result.syncCategory) setResolvedCategory(result.syncCategory);
    } catch (e) {
      setSyncResult(t("settings.failed", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSyncing(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.weread.testConnection();
      setTestResult({
        ok: true,
        msg: t("settings.connectOk") + (res.skillVersion ? ` · ${res.skillVersion}` : ""),
      });
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const patchWeread = (partial: Partial<AppSettings["weread"]> & { apiKey?: string | null }) =>
    update({ weread: partial } as Partial<AppSettings>);

  const categoryOptions = [
    {
      value: "auto",
      label: resolvedCategory ? t("settings.autoTo", { category: resolvedCategory }) : t("settings.auto"),
    },
    ...categories.map((c) => ({ value: c, label: c })),
  ];

  const selectValue =
    !w.syncCategory ||
    w.syncCategory === "auto" ||
    w.syncCategory === "30 阅读" ||
    w.syncCategory === "30-阅读"
      ? "auto"
      : categories.includes(w.syncCategory)
        ? w.syncCategory
        : "auto";

  const ready = Boolean(w.apiKey) && w.enabled;

  return (
    <div>
      <SettingsSection
        title={t("settings.connectTitle")}
        description={t("settings.connectDesc")}
        help={t("settings.connectHelp")}
        action={
          <StatusDot
            ok={ready}
            label={
              !w.enabled
                ? t("settings.disabled")
                : w.apiKey
                  ? w.lastSyncAt
                    ? t("settings.connectedDate", { date: new Date(w.lastSyncAt).toLocaleDateString(intlLocale()) })
                    : t("settings.connected")
                  : t("settings.notConfigured")
            }
          />
        }
      >
        <SwitchField
          label={t("settings.enable")}
          description={t("settings.enableDesc")}
          checked={w.enabled}
          onChange={() => patchWeread({ enabled: !w.enabled })}
        />
        <KeyField
          label="API Key"
          helpUrl="https://weread.qq.com/r/weread-skills"
          configured={Boolean(w.apiKey)}
          onClear={() => patchWeread({ apiKey: null as unknown as string })}
          description={t("settings.apiKeyDesc")}
        >
          <Input
            type="password"
            value={w.apiKey}
            onChange={(e) => patchWeread({ apiKey: e.target.value })}
            placeholder="wrk-…"
            autoComplete="off"
            disabled={!w.enabled}
          />
        </KeyField>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-3xs"
            onClick={() => void handleTest()}
            disabled={testing || !w.apiKey || !w.enabled}
          >
            {testing ? <Loader2 size={ICON.xs} className="animate-spin" /> : <Zap size={ICON.xs} />}
            {t("settings.test")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-3xs"
            onClick={() => void handleSync()}
            disabled={syncing || !w.apiKey || !w.enabled}
          >
            {syncing ? <Loader2 size={ICON.xs} className="animate-spin" /> : <RefreshCw size={ICON.xs} />}
            {t("settings.sync")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-3xs"
            disabled={!w.enabled}
            onClick={() => select({ kind: "connector", id: "weread" })}
          >
            <ExternalLink size={ICON.xs} /> {t("settings.center")}
          </Button>
        </div>
        {testResult ? (
          <div className={`mt-2 text-3xs ${testResult.ok ? "text-success" : "text-error"}`}>
            {testResult.msg}
          </div>
        ) : null}
        {syncResult ? (
          <div className={`mt-1 text-3xs ${syncResult.startsWith(t("settings.failed", { msg: "" }).slice(0, 2)) ? "text-error" : "text-success"}`}>
            {syncResult}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={t("settings.prefsTitle")}
        description={t("settings.prefsDesc")}
      >
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
          <Field label={t("settings.targetCategory")} description={t("settings.targetCategoryHint")} compact>
            <Select
              value={selectValue}
              disabled={!w.enabled}
              onChange={(e) => patchWeread({ syncCategory: e.target.value })}
              options={categoryOptions}
            />
          </Field>
          <Field label={t("settings.thoughtsReviews")} description={t("settings.thoughtsReviewsDesc")} compact>
            <Select
              value={w.includeThoughts === false ? "false" : "true"}
              disabled={!w.enabled}
              onChange={(e) => patchWeread({ includeThoughts: e.target.value === "true" })}
              options={[
                { value: "true", label: t("settings.includeThoughts") },
                { value: "false", label: t("settings.highlightsOnly") },
              ]}
            />
          </Field>
          <Field label={t("settings.budget")} description={t("settings.budgetDesc")} compact className="sm:col-span-2">
            <Select
              value={String(w.syncBudgetMinutes ?? 4)}
              disabled={!w.enabled}
              onChange={(e) => patchWeread({ syncBudgetMinutes: Number(e.target.value) || 4 })}
              options={[
{ value: "2", label: t("settings:weread.minutesCount", { count: 2 }) },
      { value: "4", label: t("settings:weread.minutesCount", { count: 4 }) },
      { value: "8", label: t("settings:weread.minutesCount", { count: 8 }) },
      { value: "12", label: t("settings:weread.minutesCount", { count: 12 }) },
              ]}
            />
          </Field>
        </div>
      </SettingsSection>
    </div>
  );
}
