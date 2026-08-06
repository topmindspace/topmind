/**
 * v4 AI Model Resolution — multi-provider via Vercel AI SDK v7.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { t as ei18n } from "./lib/electron-i18n.mjs";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function resolveModel(s, req) {
  const m = s?.ai?.manual || {};
  const pref = s?.ai?.sourcePreference || "";
  const defaultModel = s?.ai?.defaultModel || null;
  const providers = [
    { source: "openai", k: m.openAiKey, mk: () => createOpenAI({ apiKey: m.openAiKey }), d: "gpt-4o-mini" },
    { source: "anthropic", k: m.anthropicKey, mk: () => createAnthropic({ apiKey: m.anthropicKey }), d: "claude-sonnet-4-20250514" },
    { source: "google", k: m.googleKey, mk: () => createGoogleGenerativeAI({ apiKey: m.googleKey }), d: "gemini-2.0-flash" },
    { source: "deepseek", k: m.deepseekKey, mk: () => createOpenAICompatible({ name: "deepseek", apiKey: m.deepseekKey, baseURL: "https://api.deepseek.com/v1" }), d: "deepseek-chat" },
    { source: "moonshot", k: m.moonshotKey, mk: () => createOpenAICompatible({ name: "moonshot", apiKey: m.moonshotKey, baseURL: "https://api.moonshot.cn/v1" }), d: "moonshot-v1-8k" },
    { source: "zhipu", k: m.zhipuKey, mk: () => createOpenAICompatible({ name: "zhipu", apiKey: m.zhipuKey, baseURL: "https://open.bigmodel.cn/api/paas/v4" }), d: "glm-4-flash" },
    { source: "minimax", k: m.minimaxKey, mk: () => createOpenAICompatible({ name: "minimax", apiKey: m.minimaxKey, baseURL: "https://api.minimax.chat/v1" }), d: "MiniMax-Text-01" },
    { source: "xai", k: m.xaiKey, mk: () => createOpenAICompatible({ name: "xai", apiKey: m.xaiKey, baseURL: "https://api.x.ai/v1" }), d: "grok-3-mini" },
  ];
  // Ollama — local endpoint, no key required (uses placeholder "ollama")
  const ollamaUrl = m.ollamaBaseUrl || "http://127.0.0.1:11434/v1";
  providers.push({ source: "ollama", k: 1, mk: () => createOpenAICompatible({ name: "ollama", apiKey: "ollama", baseURL: ollamaUrl }), d: "qwen2.5:7b" });
  if (m.customBaseUrl && m.customKey)
    providers.push({ source: "custom", k: 1, mk: () => createOpenAICompatible({ name: "custom", apiKey: m.customKey, baseURL: m.customBaseUrl }), d: "default" });

  // Parse "provider/modelId" format from per-call override (AiPanel selector).
  // This ensures the model is always routed to the correct provider's SDK,
  // even when the user's preferred provider differs from the selected model's
  // provider. Legacy bare model IDs (no slash) fall through to the old path.
  let reqProvider = null;
  let reqModelId = null;
  if (req) {
    const slashIdx = req.indexOf("/");
    if (slashIdx > 0) {
      reqProvider = req.slice(0, slashIdx);
      reqModelId = req.slice(slashIdx + 1);
    } else {
      reqModelId = req;
    }
  }

  // When a specific provider is requested via "provider/modelId", use it
  // directly — the model belongs to that provider, not the preferred one.
  if (reqProvider) {
    const p = providers.find((pp) => pp.source === reqProvider && pp.k);
    if (p) {
      try {
        return { model: p.mk()(reqModelId), modelId: reqModelId };
      } catch {}
    }
  }

  // Honor the user's preferred provider (only when it has a key) by trying it
  // first; the rest follow in default order. Falls back to default order when
  // no preference is set — fully backward compatible.
  const ordered = pref
    ? [...providers.filter((p) => p.source === pref && p.k), ...providers.filter((p) => p.source !== pref)]
    : providers;

  for (const p of ordered) {
    if (!p.k) continue;
    try {
      const provider = p.mk();
      // Explicit per-call model wins. Otherwise the configured defaultModel
      // applies only to its own (preferred) provider, so a model id is never
      // sent to a provider it doesn't belong to; every other provider uses its
      // own default.
      let modelId;
      if (reqModelId) modelId = reqModelId;
      else if (defaultModel && pref && p.source === pref) modelId = defaultModel;
      else modelId = p.d;
      return { model: provider(modelId), modelId };
    } catch {}
  }
  return null;
}

export function getRuntimeStatus(s) {
  const m = s?.ai?.manual || {};
  const ps = [];
  if (m.openAiKey) ps.push({ source: "openai", label: "OpenAI" });
  if (m.anthropicKey) ps.push({ source: "anthropic", label: "Anthropic" });
  if (m.googleKey) ps.push({ source: "google", label: "Google" });
  if (m.deepseekKey) ps.push({ source: "deepseek", label: "DeepSeek" });
  if (m.moonshotKey) ps.push({ source: "moonshot", label: "Moonshot/Kimi" });
  if (m.zhipuKey) ps.push({ source: "zhipu", label: "Zhipu/GLM" });
  if (m.minimaxKey) ps.push({ source: "minimax", label: "MiniMax" });
  if (m.xaiKey) ps.push({ source: "xai", label: "xAI/Grok" });
  // Ollama — shown as available when the user has set the endpoint URL
  if (m.ollamaBaseUrl) ps.push({ source: "ollama", label: "Ollama" });
  if (m.customBaseUrl && m.customKey) ps.push({ source: "custom", label: "Custom" });
  return { ready: ps.length > 0, message: ps.length > 0 ? "" : ei18n("ai.noProvider"), providers: ps };
}
