import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiAlertLine,
  RiFileTextLine,
  RiCoinsLine,
  RiExternalLinkLine,
  RiGithubLine,
  RiLoader4Line,
  RiRefreshLine,
  RiToolsLine,
} from "@remixicon/react";
import { useAiStore } from "../../stores/ai-store";
import { emitLocal } from "../../plugins/host";
import { api } from "../../services/api";
import { Select, type SelectOption } from "../ui/select";
import { Input } from "../ui/Input";
import type { AppSettings, ModelInfo, ProviderInfo } from "../../types";
import { Field, SwitchField, SettingsSection, StatusDot } from "./fields";
import { Tooltip } from "../ui/tooltip";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/kit";

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
  keyField: keyof AppSettings["ai"]["manual"] | null;
  baseUrlField: keyof AppSettings["ai"]["manual"] | null;
  helpUrl?: string;
  keyPlaceholder?: string;
  defaultBaseUrl?: string;
  region: "international" | "domestic" | "local";
}

const PROVIDERS: ProviderMeta[] = [
  { id: "openai", label: "OpenAI", keyField: "openAiKey", baseUrlField: null, helpUrl: "https://platform.openai.com/api-keys", keyPlaceholder: "sk-…", defaultBaseUrl: "https://api.openai.com/v1", region: "international" },
  { id: "anthropic", label: "Anthropic", keyField: "anthropicKey", baseUrlField: null, helpUrl: "https://console.anthropic.com/settings/keys", keyPlaceholder: "sk-ant-…", defaultBaseUrl: "https://api.anthropic.com/v1", region: "international" },
  { id: "google", label: "Google Gemini", keyField: "googleKey", baseUrlField: null, helpUrl: "https://aistudio.google.com/apikey", keyPlaceholder: "AI…", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", region: "international" },
  { id: "xai", label: "xAI / Grok", keyField: "xaiKey", baseUrlField: null, helpUrl: "https://console.x.ai", keyPlaceholder: "xai-…", defaultBaseUrl: "https://api.x.ai/v1", region: "international" },
  { id: "groq", label: "Groq", keyField: "groqKey", baseUrlField: null, helpUrl: "https://console.groq.com/keys", keyPlaceholder: "gsk_…", defaultBaseUrl: "https://api.groq.com/openai/v1", region: "international" },
  { id: "mistral", label: "Mistral", keyField: "mistralKey", baseUrlField: null, helpUrl: "https://console.mistral.ai/api-keys", keyPlaceholder: "…", defaultBaseUrl: "https://api.mistral.ai/v1", region: "international" },
  { id: "openrouter", label: "OpenRouter", keyField: "openrouterKey", baseUrlField: null, helpUrl: "https://openrouter.ai/keys", keyPlaceholder: "sk-or-…", defaultBaseUrl: "https://openrouter.ai/api/v1", region: "international" },
  { id: "deepseek", label: "DeepSeek", keyField: "deepseekKey", baseUrlField: null, helpUrl: "https://platform.deepseek.com/api_keys", keyPlaceholder: "sk-…", defaultBaseUrl: "https://api.deepseek.com/v1", region: "domestic" },
  { id: "moonshot", label: "Moonshot / Kimi", keyField: "moonshotKey", baseUrlField: null, helpUrl: "https://platform.moonshot.cn/console/api-keys", keyPlaceholder: "sk-…", defaultBaseUrl: "https://api.moonshot.cn/v1", region: "domestic" },
  { id: "zhipu", label: "Zhipu GLM", keyField: "zhipuKey", baseUrlField: null, helpUrl: "https://open.bigmodel.cn/console/apikey", keyPlaceholder: "…", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4", region: "domestic" },
  { id: "minimax", label: "MiniMax", keyField: "minimaxKey", baseUrlField: null, helpUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key", keyPlaceholder: "…", defaultBaseUrl: "https://api.minimaxi.com/v1", region: "domestic" },
  { id: "qwen", label: "Qwen / 通义千问", keyField: "qwenKey", baseUrlField: null, helpUrl: "https://bailian.console.aliyun.com/?apiKey=1", keyPlaceholder: "sk-…", defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", region: "domestic" },
  { id: "doubao", label: "Doubao / 豆包", keyField: "doubaoKey", baseUrlField: null, helpUrl: "https://console.volcengine.com/ark", keyPlaceholder: "…", defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3", region: "domestic" },
  { id: "siliconflow", label: "SiliconFlow / 硅基流动", keyField: "siliconflowKey", baseUrlField: null, helpUrl: "https://cloud.siliconflow.cn/account/ak", keyPlaceholder: "sk-…", defaultBaseUrl: "https://api.siliconflow.cn/v1", region: "domestic" },
  { id: "baidu", label: "Baidu / 文心", keyField: "baiduKey", baseUrlField: null, helpUrl: "https://console.bce.baidu.com/ai/#/ai/qianfan/online/list", keyPlaceholder: "…", defaultBaseUrl: "https://qianfan.baidubce.com/v2", region: "domestic" },
  { id: "hunyuan", label: "Tencent Hunyuan / 混元", keyField: "hunyuanKey", baseUrlField: null, helpUrl: "https://console.cloud.tencent.com/hunyuan/api-key", keyPlaceholder: "…", defaultBaseUrl: "https://api.hunyuan.cloud.tencent.com/v1", region: "domestic" },
  { id: "ollama", label: "Ollama", keyField: null, baseUrlField: "ollamaBaseUrl", defaultBaseUrl: "http://127.0.0.1:11434/v1", region: "local" },
  { id: "custom", label: "Custom (OpenAI-compatible)", keyField: "customKey", baseUrlField: "customBaseUrl", defaultBaseUrl: "", keyPlaceholder: "…", region: "local" },
];

function isProviderConfigured(meta: ProviderMeta, m: AppSettings["ai"]["manual"]): boolean {
  if (meta.keyField) return Boolean(m[meta.keyField]);
  if (meta.baseUrlField) return Boolean(m[meta.baseUrlField]);
  return false;
}

function effectiveBaseUrl(meta: ProviderMeta, m: AppSettings["ai"]["manual"]): string {
  if (meta.baseUrlField) return String(m[meta.baseUrlField] || meta.defaultBaseUrl || "");
  const o = String((m.baseUrlOverrides || {})[meta.id] || "").trim();
  return o || meta.defaultBaseUrl || "";
}

function formatContext(limit?: number): string {
  if (!limit || limit <= 0) return "";
  if (limit >= 1_000_000) return `${(limit / 1_000_000).toFixed(1)}M`;
  if (limit >= 1000) return `${Math.round(limit / 1000)}K`;
  return String(limit);
}

function formatCost(input?: number, output?: number): string {
  if (input === undefined && output === undefined) return "";
  const fmt = (v?: number) => (v !== undefined ? `$${v.toFixed(2)}` : "—");
  return `${fmt(input)} / ${fmt(output)}`;
}

function ModelBadges({ model }: { model: ModelInfo }) {
  const { t } = useTranslation(["settings"]);
  return (
    <span className="inline-flex items-center gap-1">
      {model.toolCall ? (
        <Tooltip content={t("settings:ai.badgeToolCall")}>
          <span className="inline-flex items-center rounded bg-accent-bg-subtle px-1 text-4xs text-accent-color">
            <RiToolsLine size={ICON.micro} aria-hidden />
          </span>
        </Tooltip>
      ) : null}
      {model.reasoning ? (
        <Tooltip content={t("settings:ai.badgeReasoning")}>
          <span className="inline-flex items-center rounded bg-status-info-bg/40 px-1 text-4xs text-status-info">
            <RiFileTextLine size={ICON.micro} aria-hidden />
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
          <span className="inline-flex items-center rounded bg-status-warning-bg/30 px-1 text-4xs text-warning">
            <RiCoinsLine size={ICON.micro} aria-hidden />
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

function sourceLabel(source: ProviderInfo["source"] | undefined, t: (k: string) => string): string {
  if (source === "official") return t("settings:ai.sourceOfficial");
  if (source === "community") return t("settings:ai.sourceCommunity");
  return t("settings:ai.sourceCurated");
}

/**
 * Flat provider options — standard listbox, no search, no empty group labels.
 * Markers: ★ current · ✓ configured.
 */
function buildProviderOptions(
  m: AppSettings["ai"]["manual"],
  pref: string,
): SelectOption[] {
  return PROVIDERS.map((p) => {
    const marks: string[] = [];
    if (pref === p.id) marks.push("★");
    if (isProviderConfigured(p, m)) marks.push("✓");
    const suffix = marks.length ? `  ${marks.join(" ")}` : "";
    return { value: p.id, label: `${p.label}${suffix}` };
  });
}

// ── Main Panel ────────────────────────────────────────────────────────────
/**
 * AI settings — ONE form (no duplicate "active" + "configure" pickers):
 *   [Provider ▾] [Model ▾]  + credentials for that provider  + Agent
 * Selecting provider = sourcePreference; selecting model = defaultModel.
 * Provider list is a plain listbox (18 items). Search only on long model lists.
 */
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

  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState("");

  const secretLost = useMemo(() => {
    const lost = (settings.ai as { _secretHealth?: { lost?: string[] } })._secretHealth?.lost;
    return new Set(Array.isArray(lost) ? lost : []);
  }, [settings.ai]);

  const patchAi = (partial: Partial<AppSettings["ai"]>) => {
    update({ ai: partial } as unknown as Partial<AppSettings>);
  };
  const patchManual = (key: keyof AppSettings["ai"]["manual"], value: string | null) => {
    update({ ai: { manual: { [key]: value } } } as unknown as Partial<AppSettings>);
  };

  const providerOptions = useMemo(() => buildProviderOptions(m, pref), [m, pref]);

  // Single edit target = preferred provider (or first configured / openai).
  const activeMeta = useMemo(() => {
    const id = pref || PROVIDERS.find((p) => isProviderConfigured(p, m))?.id || "openai";
    return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
  }, [pref, m]);
  const activeCatalog = catalog.find((c) => c.id === activeMeta.id);
  const configured = isProviderConfigured(activeMeta, m);

  const modelOptions = useMemo(() => {
    const list = activeCatalog?.models ?? [];
    const cur = settings.ai.defaultModel;
    const base =
      cur && !list.some((mm) => mm.id === cur)
        ? [{ id: cur, label: cur }, ...list]
        : list;
    return base.map((mm) => ({ value: mm.id, label: mm.label || mm.id }));
  }, [activeCatalog, settings.ai.defaultModel]);
  const selectedModelInfo = activeCatalog?.models.find(
    (mm) => mm.id === settings.ai.defaultModel,
  );

  useEffect(() => {
    setBaseUrlDraft(String((m.baseUrlOverrides || {})[activeMeta.id] || ""));
    setBaseUrlError(null);
    setCustomModel("");
  }, [activeMeta.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    void loadModelCatalog({ forceLive: false, silent: true });
  }, [loadModelCatalog]);

  useEffect(() => {
    if (prevSaving.current && !saving) {
      void loadModelCatalog({ forceLive: false, silent: true });
      void refreshRuntimeStatus();
    }
    prevSaving.current = saving;
  }, [saving, loadModelCatalog, refreshRuntimeStatus]);

  const prevPref = useRef(pref);
  useEffect(() => {
    if (prevPref.current === pref) return;
    prevPref.current = pref;
    void loadModelCatalog({ forceLive: false, silent: true });
  }, [pref, loadModelCatalog]);

  const configuredCount = useMemo(
    () => PROVIDERS.filter((p) => isProviderConfigured(p, m)).length,
    [m],
  );

  const liveCount = catalog.filter((c) => c.live).length;
  const communityCount = catalog.filter((c) => c.source === "community" && !c.live).length;
  const statusLabel =
    configuredCount === 0
      ? t("settings:ai.notConfigured")
      : refreshing
        ? t("settings:ai.syncing")
        : liveCount > 0
          ? t("settings:ai.syncedCount", { count: catalog.length })
          : communityCount > 0
            ? t("settings:ai.communityCount", { count: catalog.length })
            : t("settings:ai.presetCount", { count: catalog.length || "?" });

  const commitBaseUrl = () => {
    const raw = baseUrlDraft.trim().replace(/\/+$/, "");
    if (!raw) {
      update({
        ai: {
          manual: {
            baseUrlOverrides: { ...(m.baseUrlOverrides || {}), [activeMeta.id]: "" },
          },
        },
      } as unknown as Partial<AppSettings>);
      setBaseUrlError(null);
      return;
    }
    try {
      const parsed = new URL(raw);
      const isLocalHttp =
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
      if (parsed.protocol !== "https:" && !isLocalHttp) {
        setBaseUrlError(t("settings:ai.baseUrlInvalid"));
        return;
      }
    } catch {
      setBaseUrlError(t("settings:ai.baseUrlInvalid"));
      return;
    }
    setBaseUrlError(null);
    update({
      ai: {
        manual: {
          baseUrlOverrides: { ...(m.baseUrlOverrides || {}), [activeMeta.id]: raw },
        },
      },
    } as unknown as Partial<AppSettings>);
  };

  const keyVal = activeMeta.keyField ? String(m[activeMeta.keyField] || "") : "";

  return (
    <div>
      {refreshError ? (
        <div className="mb-2 rounded-[var(--radius-md)] border border-error/20 bg-status-error-bg px-2.5 py-1.5 text-3xs text-error">
          {refreshError}
        </div>
      ) : null}

      {secretLost.size > 0 ? (
        <div className="mb-2 flex items-start gap-1.5 rounded-[var(--radius-md)] border border-warning/30 bg-status-warning-bg/40 px-2.5 py-1.5 text-3xs text-warning">
          <RiAlertLine size={ICON.micro} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {t("settings:ai.secretLostWarning", { keys: Array.from(secretLost).join(", ") })}
          </span>
        </div>
      ) : null}

      {/* ── Provider & model (the only picker) + credentials ─────────── */}
      <SettingsSection
        title={t("settings:ai.titleProviderModel")}
        description={t("settings:ai.descProviderModel")}
        action={
          <Tooltip content={t("settings:ai.refreshModelsDevTooltip")}>
            <button
              type="button"
              onClick={() => fetchLive({ forceModelsDev: true, silent: false })}
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
        }
      >
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("settings:ai.providerLabel")} compact className="min-w-[10rem] flex-1">
            <Select
              value={activeMeta.id}
              options={providerOptions}
              onChange={(e) => {
                // Switching vendor resets model — ids are not portable.
                patchAi({ sourcePreference: e.target.value, defaultModel: null });
              }}
              aria-label={t("settings:ai.providerLabel")}
            />
          </Field>
          <Field label={t("settings:ai.modelLabel")} compact className="min-w-[10rem] flex-1">
            <Select
              value={settings.ai.defaultModel || ""}
              searchable
              placeholder={t("settings:ai.modelDefault")}
              options={modelOptions}
              onChange={(e) => patchAi({ defaultModel: e.target.value || null })}
              aria-label={t("settings:ai.modelLabel")}
            />
          </Field>
          <Tooltip content={t("settings:ai.refreshTooltip")}>
            <button
              type="button"
              onClick={() => fetchLive({ silent: false, forceLive: true })}
              disabled={refreshing}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-border-subtle-dim text-text-secondary transition-colors hover:bg-surface-muted disabled:opacity-40"
              aria-label={t("settings:ai.refreshLabel")}
            >
              {refreshing ? (
                <RiLoader4Line size={ICON.xs} className="animate-spin" aria-hidden />
              ) : (
                <RiRefreshLine size={ICON.xs} aria-hidden />
              )}
            </button>
          </Tooltip>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-4xs text-text-quaternary">
          <StatusDot ok={configuredCount > 0} label={statusLabel} />
          {lastFetchedAt ? (
            <span>
              {t("settings:ai.syncedAt", { time: new Date(lastFetchedAt).toLocaleTimeString() })}
            </span>
          ) : null}
          {activeCatalog?.source ? (
            <span>
              {sourceLabel(activeCatalog.source, t)}
              {activeCatalog.live ? ` · ${t("common:status.live")}` : ""}
            </span>
          ) : null}
        </div>

        {/* Credentials for the selected provider */}
        <div className="mt-2 border-t border-border-subtle-dim/50 pt-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-4xs text-text-quaternary">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                configured ? "bg-success" : "bg-text-quaternary/40",
              )}
              aria-hidden
            />
            <span className="break-all font-mono">
              {effectiveBaseUrl(activeMeta, m) || t("settings:ai.baseUrlEmpty")}
            </span>
            {activeMeta.helpUrl ? (
              <button
                type="button"
                onClick={() => void api.sys.openUrl(activeMeta.helpUrl!)}
                className="inline-flex items-center gap-0.5 text-accent-color transition-colors hover:underline"
              >
                {t("common:action.getKey")} <RiExternalLinkLine size={ICON.micro} aria-hidden />
              </button>
            ) : null}
          </div>

          {activeMeta.keyField ? (
            <Field label="API Key" compact>
              <div className="flex items-center gap-1">
                <Input
                  type="password"
                  value={keyVal}
                  onChange={(e) => patchManual(activeMeta.keyField!, e.target.value)}
                  placeholder={activeMeta.keyPlaceholder || "…"}
                  autoComplete="off"
                  className="flex-1"
                />
                {configured ? (
                  <button
                    type="button"
                    onClick={() => patchManual(activeMeta.keyField!, null)}
                    className="inline-flex h-8 shrink-0 items-center rounded-[var(--radius-md)] px-2 text-4xs text-text-quaternary transition-colors hover:bg-surface-muted hover:text-error"
                  >
                    {t("common:action.clearKey")}
                  </button>
                ) : null}
              </div>
            </Field>
          ) : null}

          <Field
            label={
              activeMeta.baseUrlField
                ? activeMeta.id === "ollama"
                  ? t("settings:ai.endpointUrl")
                  : t("settings:ai.baseUrl")
                : t("settings:ai.baseUrlOverride")
            }
            description={
              !activeMeta.baseUrlField && activeMeta.defaultBaseUrl
                ? t("settings:ai.baseUrlDefault", { url: activeMeta.defaultBaseUrl })
                : undefined
            }
            compact
          >
            <Input
              type="url"
              value={baseUrlDraft}
              onChange={(e) => setBaseUrlDraft(e.target.value)}
              onBlur={commitBaseUrl}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitBaseUrl();
                }
              }}
              placeholder={activeMeta.defaultBaseUrl || "https://…"}
              aria-invalid={Boolean(baseUrlError) || undefined}
            />
            {baseUrlError ? <p className="mt-1 text-4xs text-error">{baseUrlError}</p> : null}
          </Field>

          <Field label={t("settings:ai.customModelId")} compact>
            <div className="flex items-center gap-1">
              <Input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder={settings.ai.defaultModel || "model-id"}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customModel.trim()) {
                    e.preventDefault();
                    patchAi({ defaultModel: customModel.trim() });
                    setCustomModel("");
                  }
                }}
              />
              <button
                type="button"
                disabled={!customModel.trim()}
                onClick={() => {
                  if (!customModel.trim()) return;
                  patchAi({ defaultModel: customModel.trim() });
                  setCustomModel("");
                }}
                className="inline-flex h-8 shrink-0 items-center rounded-[var(--radius-md)] border border-border-subtle-dim px-2 text-4xs text-text-secondary transition-colors hover:bg-surface-muted disabled:opacity-40"
              >
                {t("settings:ai.useCustomModel")}
              </button>
            </div>
          </Field>

          {selectedModelInfo ? (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="font-mono text-4xs text-text-quaternary">
                {selectedModelInfo.id}
              </span>
              <ModelBadges model={selectedModelInfo} />
            </div>
          ) : null}

          {activeMeta.id === "ollama" ? (
            <p className="mt-1 text-4xs leading-snug text-text-quaternary">
              {t("settings:ai.ollamaHint")}
            </p>
          ) : null}
        </div>
      </SettingsSection>

      {/* ── Agent ─────────────────────────────────────────────────────── */}
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
                : [...AGENT_STEP_OPTIONS, { value: String(maxSteps), label: String(maxSteps) }].sort(
                    (a, b) => Number(a.value) - Number(b.value),
                  )
            }
          />
        </Field>
      </SettingsSection>
    </div>
  );
}
