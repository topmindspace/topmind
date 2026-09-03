import { useEffect, useRef, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiArrowDownSLine,
  RiBrainLine,
  RiCheckLine,
  RiCloseLine,
  RiCoinsLine,
  RiExternalLinkLine,
  RiGithubLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSearchLine,
  RiServerLine,
  RiToolsLine,
} from "@remixicon/react";
import { useAiStore } from "../../stores/ai-store";
import { emitLocal } from "../../plugins/host";
import { api } from "../../services/api";
import { Select } from "../ui/select";
import { Input } from "../ui/Input";
import type { AppSettings, ModelInfo, ProviderInfo } from "../../types";
import { Field, SwitchField, SettingsSection, StatusDot } from "./fields";
import { Tooltip } from "../ui/tooltip";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";

import {
  AGENT_STEP_OPTION_VALUES,
  fallbackMaxAgentSteps,
} from "../../lib/agent-steps";

const AGENT_STEP_OPTIONS = AGENT_STEP_OPTION_VALUES.map((n) => ({
  value: String(n),
  label: String(n),
}));

// ── Provider Registry ────────────────────────────────────────────────────
// Single source of truth for provider metadata used by the settings UI.
// Each entry maps to a key field in AppSettings.ai.manual.

interface ProviderMeta {
  id: string;
  label: string;
  /** Settings field name for the API key (null = no key needed, e.g. Ollama) */
  keyField: keyof AppSettings["ai"]["manual"] | null;
  /** Settings field name for a custom base URL (null = no base URL field) */
  baseUrlField: keyof AppSettings["ai"]["manual"] | null;
  /** URL to get an API key */
  helpUrl?: string;
  /** Placeholder for the key input */
  keyPlaceholder?: string;
  /** Default base URL (shown as placeholder) */
  defaultBaseUrl?: string;
  /** Provider category for grouping */
  region: "international" | "domestic" | "local";
}

const PROVIDERS: ProviderMeta[] = [
  // International
  { id: "openai", label: "OpenAI", keyField: "openAiKey", baseUrlField: null, helpUrl: "https://platform.openai.com/api-keys", keyPlaceholder: "sk-…", region: "international" },
  { id: "anthropic", label: "Anthropic", keyField: "anthropicKey", baseUrlField: null, helpUrl: "https://console.anthropic.com/settings/keys", keyPlaceholder: "sk-ant-…", region: "international" },
  { id: "google", label: "Google", keyField: "googleKey", baseUrlField: null, helpUrl: "https://aistudio.google.com/apikey", keyPlaceholder: "AI…", region: "international" },
  { id: "xai", label: "xAI / Grok", keyField: "xaiKey", baseUrlField: null, helpUrl: "https://console.x.ai", keyPlaceholder: "xai-…", region: "international" },
  // Domestic
  { id: "deepseek", label: "DeepSeek", keyField: "deepseekKey", baseUrlField: null, helpUrl: "https://platform.deepseek.com/api_keys", keyPlaceholder: "sk-…", region: "domestic" },
  { id: "moonshot", label: "Moonshot / Kimi", keyField: "moonshotKey", baseUrlField: null, helpUrl: "https://platform.moonshot.cn/console/api-keys", keyPlaceholder: "sk-…", region: "domestic" },
  { id: "zhipu", label: "Zhipu GLM", keyField: "zhipuKey", baseUrlField: null, helpUrl: "https://open.bigmodel.cn/console/apikey", keyPlaceholder: "…", region: "domestic" },
  { id: "minimax", label: "MiniMax", keyField: "minimaxKey", baseUrlField: null, helpUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key", keyPlaceholder: "…", region: "domestic" },
  // Local
  { id: "ollama", label: "Ollama", keyField: null, baseUrlField: "ollamaBaseUrl", defaultBaseUrl: "http://127.0.0.1:11434/v1", region: "local" },
  { id: "custom", label: "Custom (OpenAI-compatible)", keyField: "customKey", baseUrlField: "customBaseUrl", defaultBaseUrl: "", keyPlaceholder: "…", region: "local" },
];

function isProviderConfigured(meta: ProviderMeta, m: AppSettings["ai"]["manual"]): boolean {
  if (meta.keyField) return Boolean(m[meta.keyField]);
  // No key field (Ollama) — always "configured" (local endpoint)
  if (meta.baseUrlField) return Boolean(m[meta.baseUrlField]);
  return false;
}

function formatContext(limit?: number): string {
  if (!limit || limit <= 0) return "";
  if (limit >= 1_000_000) return `${(limit / 1_000_000).toFixed(1)}M`;
  if (limit >= 1000) return `${Math.round(limit / 1000)}K`;
  return String(limit);
}

function formatCost(input?: number, output?: number): string {
  if (input === undefined && output === undefined) return "";
  const fmt = (v?: number) => v !== undefined ? `$${v.toFixed(2)}` : "—";
  return `${fmt(input)} / ${fmt(output)}`;
}

// ── Model Metadata Badges ────────────────────────────────────────────────

function ModelBadges({ model }: { model: ModelInfo }) {
  const { t } = useTranslation(["settings"]);
  return (
    <span className="inline-flex items-center gap-1">
      {model.toolCall ? (
        <Tooltip content={t("settings:ai.badgeToolCall")}>
          <span className="inline-flex items-center rounded bg-accent-bg-subtle px-1 text-4xs text-accent-color/70">
            <RiToolsLine size={ICON.micro} aria-hidden />
          </span>
        </Tooltip>
      ) : null}
      {model.reasoning ? (
        <Tooltip content={t("settings:ai.badgeReasoning")}>
          <span className="inline-flex items-center rounded bg-status-info-bg/40 px-1 text-4xs text-info/70">
            <RiBrainLine size={ICON.micro} aria-hidden />
          </span>
        </Tooltip>
      ) : null}
      {model.contextLimit ? (
        <Tooltip content={t("settings:ai.badgeContext", { count: formatContext(model.contextLimit) })}>
          <span className="inline-flex items-center rounded bg-surface-muted px-1 text-4xs text-text-quaternary">
            {formatContext(model.contextLimit)}
          </span>
        </Tooltip>
      ) : null}
      {model.costInput !== undefined || model.costOutput !== undefined ? (
        <Tooltip content={t("settings:ai.badgeCost", { cost: formatCost(model.costInput, model.costOutput) })}>
          <span className="inline-flex items-center rounded bg-status-warning-bg/30 px-1 text-4xs text-warning/70">
            <RiCoinsLine size={ICON.micro} aria-hidden />
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

// ── Provider Card ────────────────────────────────────────────────────────

function ProviderCard({
  meta,
  settings,
  update,
  catalog,
  expanded,
  onToggle,
  onRefresh,
  refreshing,
}: {
  meta: ProviderMeta;
  settings: AppSettings;
  update: (p: Partial<AppSettings>) => void;
  catalog: ProviderInfo | undefined;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const m = settings.ai.manual;
  const configured = isProviderConfigured(meta, m);
  const models = catalog?.models ?? [];
  const isLive = catalog?.live === true;
  const selectedModel = settings.ai.sourcePreference === meta.id ? settings.ai.defaultModel : null;
  const displayModels =
    selectedModel && !models.some((mm) => mm.id === selectedModel)
      ? [...models, { id: selectedModel, label: selectedModel }]
      : models;
  const modelCount = displayModels.length;

  const patchManual = (key: keyof AppSettings["ai"]["manual"], value: string | null) => {
    update({ ai: { manual: { [key]: value } } } as Partial<AppSettings>);
  };

  const handleSetDefault = (modelId: string | null) => {
    update({
      ai: {
        sourcePreference: modelId ? meta.id : "",
        defaultModel: modelId,
      },
    } as Partial<AppSettings>);
  };

  const keyVal = meta.keyField ? String(m[meta.keyField] || "") : "";
  const baseUrlVal = meta.baseUrlField ? String(m[meta.baseUrlField] || "") : "";

  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border transition-colors",
        expanded
          ? "border-accent-color/30 bg-surface-muted/20"
          : configured
            ? "border-success/15 bg-status-success-bg/10"
            : "border-border-subtle-dim bg-surface-muted/10",
      )}
    >
      {/* Card Header — clickable */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-surface-muted/40 v4-focus-ring"
        aria-expanded={expanded}
      >
        {/* Status dot */}
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            configured ? "bg-success" : "bg-text-quaternary/40",
          )}
          aria-hidden
        />
        {/* Provider name */}
        <span className="min-w-0 flex-1 truncate text-3xs font-medium text-text-secondary">
          {meta.label}
        </span>
        {/* Model count */}
        {modelCount > 0 ? (
          <span className="shrink-0 text-4xs tabular-nums text-text-quaternary">
            {modelCount}
          </span>
        ) : null}
        {/* Live indicator */}
        {isLive ? (
          <span className="shrink-0 rounded-full bg-status-success-bg px-1 text-4xs font-medium text-success">
            {t("common:status.live")}
          </span>
        ) : configured ? (
          <span className="shrink-0 text-4xs text-success/70">
            <RiCheckLine size={ICON.micro} aria-hidden className="inline" />
          </span>
        ) : null}
        {/* Default badge */}
        {settings.ai.sourcePreference === meta.id ? (
          <span className="shrink-0 rounded-full bg-accent-bg-subtle px-1 text-4xs font-medium text-accent-color">
            {t("settings:ai.defaultBadge")}
          </span>
        ) : null}
        {/* Expand chevron */}
        <RiArrowDownSLine
          size={ICON.micro}
          className={cn(
            "shrink-0 text-text-quaternary transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {/* Expanded Panel */}
      {expanded ? (
        <div className="border-t border-border-subtle-dim/50 px-2.5 py-2 space-y-2">
          {/* API Key input (if applicable) */}
          {meta.keyField ? (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="text-4xs font-medium tracking-tight text-text-tertiary">
                  API Key
                </label>
                <div className="flex items-center gap-1">
                  {configured ? (
                    <button
                      type="button"
                      onClick={() => patchManual(meta.keyField!, null)}
                      className="rounded px-1 text-4xs text-text-quaternary transition-colors hover:text-error"
                    >
                      {t("common:action.clearKey")}
                    </button>
                  ) : null}
                  {meta.helpUrl ? (
                    <button
                      type="button"
                      onClick={() => void api.sys.openUrl(meta.helpUrl!)}
                      className="inline-flex items-center gap-0.5 rounded px-1 text-4xs font-medium text-accent-color transition-colors hover:bg-accent-bg-subtle"
                    >
                      {t("common:action.getKey")} <RiExternalLinkLine size={ICON.micro} aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>
              <Input
                type="password"
                value={keyVal}
                onChange={(e) => patchManual(meta.keyField!, e.target.value)}
                placeholder={meta.keyPlaceholder || "…"}
                autoComplete="off"
              />
            </div>
          ) : null}

          {/* Base URL input (if applicable) */}
          {meta.baseUrlField ? (
            <div>
              <label className="mb-1 block text-4xs font-medium tracking-tight text-text-tertiary">
                {meta.id === "ollama" ? t("settings:ai.endpointUrl") : t("settings:ai.baseUrl")}
              </label>
              <Input
                type="url"
                value={baseUrlVal}
                onChange={(e) => patchManual(meta.baseUrlField!, e.target.value)}
                placeholder={meta.defaultBaseUrl || "https://…"}
              />
            </div>
          ) : null}

          {/* Model list + refresh */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-4xs font-medium tracking-tight text-text-tertiary">
              {t("settings:ai.models")}
              {modelCount > 0 ? (
                <span className="ml-1 text-text-quaternary">({modelCount})</span>
              ) : null}
            </span>
            <div className="flex items-center gap-1">
              <Tooltip content={t("settings:ai.refreshTooltip")}>
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshing}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-text-quaternary transition-colors hover:bg-surface-muted hover:text-text-secondary disabled:opacity-40"
                  aria-label={t("settings:ai.refreshLabel")}
                >
                  {refreshing ? (
                    <RiLoader4Line size={ICON.micro} className="animate-spin" aria-hidden />
                  ) : (
                    <RiRefreshLine size={ICON.micro} aria-hidden />
                  )}
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Model list */}
          {modelCount > 0 ? (
            <div className="max-h-40 overflow-auto rounded-[var(--radius-sm)] border border-border-subtle-dim/50">
              {displayModels.slice(0, 50).map((model) => {
                const isSelected = selectedModel === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => handleSetDefault(isSelected ? null : model.id)}
                    className={cn(
                      "flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors",
                      isSelected
                        ? "bg-accent-bg-subtle/50"
                        : "hover:bg-surface-muted/50",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-4xs text-text-secondary">
                      {model.label}
                    </span>
                    <ModelBadges model={model} />
                    {isSelected ? (
                      <RiCheckLine size={ICON.micro} className="shrink-0 text-accent-color" aria-hidden />
                    ) : null}
                  </button>
                );
              })}
              {modelCount > 50 ? (
                <div className="px-2 py-1 text-center text-4xs text-text-quaternary">
                  +{modelCount - 50} more…
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-4xs text-text-quaternary">
              {meta.keyField && !configured
                ? t("settings:ai.configureToSeeModels")
                : t("settings:ai.noModelsAvailable")}
            </p>
          )}

          {/* Ollama hint */}
          {meta.id === "ollama" ? (
            <p className="text-4xs leading-snug text-text-quaternary">
              {t("settings:ai.ollamaHint")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────

export function AiProviderPanel({
  settings,
  update,
  saving,
}: {
  settings: AppSettings;
  update: (p: Partial<AppSettings>) => void;
  saving: boolean;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const m = settings.ai.manual;
  const prevSaving = useRef(false);
  const catalog = useAiStore((s) => s.modelCatalog);
  const lastFetchedAt = useAiStore((s) => s.modelCatalogFetchedAt);
  const refreshing = useAiStore((s) => s.modelCatalogLoading);
  const refreshError = useAiStore((s) => s.modelCatalogError);
  const loadModelCatalog = useAiStore((s) => s.loadModelCatalog);
  const refreshRuntimeStatus = useAiStore((s) => s.refreshRuntimeStatus);
  const agentEnabled = useAiStore((s) => s.agentEnabled);
  const setAgentEnabled = useAiStore((s) => s.setAgentEnabled);
  const maxSteps = fallbackMaxAgentSteps(settings.ai.maxAgentSteps);
  const skillsOn = settings.ai.skillsEnabled !== false;
  const pref = settings.ai.sourcePreference || "";

  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const patchAi = (partial: Partial<AppSettings["ai"]>) => {
    update({ ai: partial } as Partial<AppSettings>);
  };

  /** Refresh models — force live for configured providers, or models.dev for all. */
  const fetchLive = (opts?: { silent?: boolean; forceLive?: boolean; forceModelsDev?: boolean }) => {
    void (async () => {
      await loadModelCatalog({
        forceLive: opts?.forceLive ?? true,
        forceModelsDev: opts?.forceModelsDev,
        silent: opts?.silent ?? true,
      });
      emitLocal("ai:settings-changed", null);
      void refreshRuntimeStatus();
    })();
  };

  // Auto-load catalog on mount (cache-first, silent)
  useEffect(() => {
    void loadModelCatalog({ forceLive: false, silent: true });
  }, [loadModelCatalog]);

  // Saving completed → refresh catalog so new key takes effect
  useEffect(() => {
    if (prevSaving.current && !saving) {
      void loadModelCatalog({ forceLive: false, silent: true });
      void refreshRuntimeStatus();
    }
    prevSaving.current = saving;
  }, [saving, loadModelCatalog, refreshRuntimeStatus]);

  // Provider selection changed → soft refresh
  const prevPref = useRef(pref);
  useEffect(() => {
    if (prevPref.current === pref) return;
    prevPref.current = pref;
    void loadModelCatalog({ forceLive: false, silent: true });
  }, [pref, loadModelCatalog]);

  const configuredProviders = useMemo(
    () => PROVIDERS.filter((p) => isProviderConfigured(p, m)),
    [m],
  );

  // Group by region
  const groups = useMemo(() => {
    const g: Record<string, ProviderMeta[]> = {
      international: [],
      domestic: [],
      local: [],
    };
    for (const p of PROVIDERS) {
      g[p.region].push(p);
    }
    return g;
  }, []);

  const liveCount = catalog.filter((c) => c.live).length;
  const communityCount = catalog.filter((c) => c.source === "community" && !c.live).length;
  const statusLabel = configuredProviders.length === 0
    ? t("settings:ai.notConfigured")
    : refreshing
      ? t("settings:ai.syncing")
      : liveCount > 0
        ? t("settings:ai.syncedCount", { count: catalog.length })
        : communityCount > 0
          ? t("settings:ai.communityCount", { count: catalog.length })
          : t("settings:ai.presetCount", { count: catalog.length || "?" });

  const handleRefreshProvider = () => {
    // Live fetch picks up all configured providers (including Ollama/custom)
    fetchLive({ silent: false, forceLive: true });
  };

  const handleRefreshModelsDev = () => {
    void loadModelCatalog({ forceModelsDev: true, silent: false }).then(() => {
      emitLocal("ai:settings-changed", null);
      void refreshRuntimeStatus();
    });
  };

  // Quick select: already-configured providers as compact chips
  const quickSelectProviders = useMemo(
    () => configuredProviders.map((p) => {
      const cat = catalog.find((c) => c.id === p.id);
      const selectedModel = pref === p.id ? settings.ai.defaultModel : null;
      const modelLabel = selectedModel
        ? cat?.models.find((mm) => mm.id === selectedModel)?.label || selectedModel
        : null;
      return { meta: p, modelLabel, modelCount: cat?.models.length ?? 0, isLive: cat?.live === true };
    }),
    [configuredProviders, catalog, pref, settings.ai.defaultModel],
  );

  return (
    <div>
      {/* Status Bar */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <StatusDot ok={configuredProviders.length > 0} label={statusLabel} />
        <div className="flex items-center gap-2">
          {lastFetchedAt ? (
            <span className="text-4xs text-text-quaternary">
              {t("settings:ai.syncedAt", { time: new Date(lastFetchedAt).toLocaleTimeString() })}
            </span>
          ) : null}
          <Tooltip content={t("settings:ai.refreshModelsDevTooltip")}>
            <button
              type="button"
              onClick={handleRefreshModelsDev}
              disabled={refreshing}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-[var(--radius-md)] border border-border-subtle-dim px-1.5 text-4xs text-text-tertiary transition-colors",
                "hover:bg-surface-muted hover:text-text-secondary disabled:opacity-40",
              )}
            >
              <RiGithubLine size={ICON.micro} aria-hidden />
              {t("settings:ai.refreshModelsDevLabel")}
            </button>
          </Tooltip>
        </div>
      </div>
      {refreshError ? (
        <div className="mb-2 rounded-[var(--radius-md)] border border-error/20 bg-status-error-bg px-2.5 py-1.5 text-3xs text-error">
          {refreshError}
        </div>
      ) : null}

      {/* Quick Select — configured providers as chips */}
      {quickSelectProviders.length > 0 ? (
        <SettingsSection
          title={t("settings:ai.titleQuickSelect")}
          description={t("settings:ai.descQuickSelect")}
        >
          <div className="flex flex-wrap gap-1.5">
            {quickSelectProviders.map(({ meta, modelLabel, modelCount, isLive }) => {
              const isActive = pref === meta.id;
              return (
                <button
                  key={meta.id}
                  type="button"
                  onClick={() => {
                    if (isActive) {
                      patchAi({ sourcePreference: "", defaultModel: null });
                    } else {
                      patchAi({ sourcePreference: meta.id, defaultModel: null });
                    }
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border px-2 py-1 text-3xs transition-colors",
                    isActive
                      ? "border-accent-color/40 bg-accent-bg-subtle/50 text-accent-color"
                      : "border-border-subtle-dim bg-surface-muted/30 text-text-tertiary hover:bg-surface-muted hover:text-text-secondary",
                  )}
                >
                  <span
                    className={cn("h-1 w-1 rounded-full", isLive ? "bg-success" : "bg-text-quaternary")}
                    aria-hidden
                  />
                  <span className="font-medium">{meta.label}</span>
                  {modelLabel ? (
                    <span className="text-text-quaternary">· {modelLabel}</span>
                  ) : modelCount > 0 ? (
                    <span className="text-text-quaternary">· {modelCount}</span>
                  ) : null}
                  {isActive ? (
                    <RiCheckLine size={ICON.micro} className="text-accent-color" aria-hidden />
                  ) : null}
                </button>
              );
            })}
          </div>
        </SettingsSection>
      ) : null}

      {/* Provider List — expandable cards grouped by region */}
      <SettingsSection
        title={t("settings:ai.titleProviders")}
        description={t("settings:ai.descProviders")}
        action={
          <Tooltip content={t("settings:ai.refreshTooltip")}>
            <button
              type="button"
              onClick={() => fetchLive({ silent: false, forceLive: true })}
              disabled={refreshing}
              className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] border border-border-subtle-dim text-text-secondary transition-colors hover:bg-surface-muted disabled:opacity-40"
              aria-label={t("settings:ai.refreshLabel")}
            >
              {refreshing ? (
                <RiLoader4Line size={ICON.xs} className="animate-spin" aria-hidden />
              ) : (
                <RiRefreshLine size={ICON.xs} aria-hidden />
              )}
            </button>
          </Tooltip>
        }
      >
        {/* International */}
        <div className="mb-1 text-4xs font-semibold tracking-wide text-text-quaternary">
          {t("settings:ai.international")}
        </div>
        <div className="mb-2 space-y-1">
          {groups.international.map((meta) => (
            <ProviderCard
              key={meta.id}
              meta={meta}
              settings={settings}
              update={update}
              catalog={catalog.find((c) => c.id === meta.id)}
              expanded={expandedProvider === meta.id}
              onToggle={() => setExpandedProvider(expandedProvider === meta.id ? null : meta.id)}
              onRefresh={handleRefreshProvider}
              refreshing={refreshing}
            />
          ))}
        </div>

        {/* Domestic */}
        <div className="mb-1 text-4xs font-semibold tracking-wide text-text-quaternary">
          {t("settings:ai.domestic")}
        </div>
        <div className="mb-2 space-y-1">
          {groups.domestic.map((meta) => (
            <ProviderCard
              key={meta.id}
              meta={meta}
              settings={settings}
              update={update}
              catalog={catalog.find((c) => c.id === meta.id)}
              expanded={expandedProvider === meta.id}
              onToggle={() => setExpandedProvider(expandedProvider === meta.id ? null : meta.id)}
              onRefresh={handleRefreshProvider}
              refreshing={refreshing}
            />
          ))}
        </div>

        {/* Local */}
        <div className="mb-1 flex items-center gap-1 text-4xs font-semibold tracking-wide text-text-quaternary">
          <RiServerLine size={ICON.micro} aria-hidden />
          {t("settings:ai.localCompatible")}
        </div>
        <div className="space-y-1">
          {groups.local.map((meta) => (
            <ProviderCard
              key={meta.id}
              meta={meta}
              settings={settings}
              update={update}
              catalog={catalog.find((c) => c.id === meta.id)}
              expanded={expandedProvider === meta.id}
              onToggle={() => setExpandedProvider(expandedProvider === meta.id ? null : meta.id)}
              onRefresh={handleRefreshProvider}
              refreshing={refreshing}
            />
          ))}
        </div>
      </SettingsSection>

      {/* Agent Settings */}
      <SettingsSection
        title={t("settings:ai.titleAgent")}
        description={t("settings:ai.descTools")}
      >
        <SwitchField
          label={t("settings:ai.enableToolsLabel")}
          description={t("settings:ai.enableToolsDesc")}
          checked={agentEnabled}
          onChange={(on) => {
            setAgentEnabled(on);
            patchAi({ agentEnabled: on });
          }}
        />
        <SwitchField
          label={t("settings:ai.skillFirst")}
          description={t("settings:ai.routingDesc")}
          checked={skillsOn}
          onChange={(on) => patchAi({ skillsEnabled: on })}
          disabled={!agentEnabled}
        />
        <Field
          label={t("settings:ai.maxStepsLabel")}
          description={t("settings:ai.maxStepsDesc")}
          compact
          className="mt-1"
        >
          <Select
            value={String(maxSteps)}
            disabled={!agentEnabled}
            onChange={(e) => patchAi({ maxAgentSteps: Number(e.target.value) })}
            options={
              AGENT_STEP_OPTIONS.some((o) => o.value === String(maxSteps))
                ? AGENT_STEP_OPTIONS
                : [...AGENT_STEP_OPTIONS, { value: String(maxSteps), label: String(maxSteps) }]
                    .sort((a, b) => Number(a.value) - Number(b.value))
            }
          />
        </Field>
      </SettingsSection>
    </div>
  );
}
