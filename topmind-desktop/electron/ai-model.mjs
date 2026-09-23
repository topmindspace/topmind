/**
 * v4 AI Model Resolution — multi-provider via Vercel AI SDK v7.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { t as ei18n } from "./lib/electron-i18n.mjs";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { resolveEffectiveBaseUrl } from "./lib/model-catalog.mjs";

/**
 * Look up a model's context window from the live/catalog cache.
 * @param {object} settings
 * @param {string} provider
 * @param {string} modelId
 * @returns {number} 0 when unknown
 */
export function lookupContextLimit(settings, provider, modelId) {
  const catalog = settings?.ai?.modelCache?.catalog;
  if (!Array.isArray(catalog) || !provider || !modelId) return 0;
  const entry = catalog.find((c) => c && c.id === provider);
  if (!entry || !Array.isArray(entry.models)) return 0;
  const hit = entry.models.find((m) => m && m.id === modelId);
  return Number(hit?.contextLimit) > 0 ? Number(hit.contextLimit) : 0;
}

export function resolveModel(s, req) {
  const m = s?.ai?.manual || {};
  const pref = s?.ai?.sourcePreference || "";
  const defaultModel = s?.ai?.defaultModel || null;
  const base = (id) => resolveEffectiveBaseUrl(m, id);
  const providers = [
    { source: "openai", k: m.openAiKey, mk: () => createOpenAI({ apiKey: m.openAiKey, baseURL: base("openai") || undefined }), d: "gpt-4o-mini" },
    { source: "anthropic", k: m.anthropicKey, mk: () => createAnthropic({ apiKey: m.anthropicKey, baseURL: base("anthropic") || undefined }), d: "claude-sonnet-5" },
    { source: "google", k: m.googleKey, mk: () => createGoogleGenerativeAI({ apiKey: m.googleKey, baseURL: base("google") || undefined }), d: "gemini-3.6-flash" },
    { source: "xai", k: m.xaiKey, mk: () => createOpenAICompatible({ name: "xai", apiKey: m.xaiKey, baseURL: base("xai") }), d: "grok-3-mini" },
    { source: "groq", k: m.groqKey, mk: () => createOpenAICompatible({ name: "groq", apiKey: m.groqKey, baseURL: base("groq") }), d: "llama-3.3-70b-versatile" },
    { source: "mistral", k: m.mistralKey, mk: () => createOpenAICompatible({ name: "mistral", apiKey: m.mistralKey, baseURL: base("mistral") }), d: "mistral-small-latest" },
    { source: "openrouter", k: m.openrouterKey, mk: () => createOpenAICompatible({ name: "openrouter", apiKey: m.openrouterKey, baseURL: base("openrouter") }), d: "openai/gpt-4o-mini" },
    { source: "deepseek", k: m.deepseekKey, mk: () => createOpenAICompatible({ name: "deepseek", apiKey: m.deepseekKey, baseURL: base("deepseek") }), d: "deepseek-chat" },
    { source: "moonshot", k: m.moonshotKey, mk: () => createOpenAICompatible({ name: "moonshot", apiKey: m.moonshotKey, baseURL: base("moonshot") }), d: "kimi-k2.5" },
    { source: "zhipu", k: m.zhipuKey, mk: () => createOpenAICompatible({ name: "zhipu", apiKey: m.zhipuKey, baseURL: base("zhipu") }), d: "glm-4.7-flash" },
    { source: "minimax", k: m.minimaxKey, mk: () => createOpenAICompatible({ name: "minimax", apiKey: m.minimaxKey, baseURL: base("minimax") }), d: "MiniMax-M2.5" },
    { source: "qwen", k: m.qwenKey, mk: () => createOpenAICompatible({ name: "qwen", apiKey: m.qwenKey, baseURL: base("qwen") }), d: "qwen-plus" },
    { source: "doubao", k: m.doubaoKey, mk: () => createOpenAICompatible({ name: "doubao", apiKey: m.doubaoKey, baseURL: base("doubao") }), d: "doubao-1-5-pro-32k" },
    { source: "siliconflow", k: m.siliconflowKey, mk: () => createOpenAICompatible({ name: "siliconflow", apiKey: m.siliconflowKey, baseURL: base("siliconflow") }), d: "deepseek-ai/DeepSeek-V3" },
    { source: "baidu", k: m.baiduKey, mk: () => createOpenAICompatible({ name: "baidu", apiKey: m.baiduKey, baseURL: base("baidu") }), d: "ernie-4.5-turbo-128k" },
    { source: "hunyuan", k: m.hunyuanKey, mk: () => createOpenAICompatible({ name: "hunyuan", apiKey: m.hunyuanKey, baseURL: base("hunyuan") }), d: "hunyuan-turbos-latest" },
  ];
  // Ollama — local endpoint. Only consider ready when user configured ollamaBaseUrl or preferred ollama.
  const ollamaConfigured = Boolean(m.ollamaBaseUrl || pref === "ollama");
  providers.push({
    source: "ollama",
    k: ollamaConfigured ? 1 : 0,
    mk: () => createOpenAICompatible({ name: "ollama", apiKey: "ollama", baseURL: base("ollama") }),
    d: "qwen2.5:7b",
  });
  if (m.customBaseUrl && m.customKey)
    providers.push({ source: "custom", k: 1, mk: () => createOpenAICompatible({ name: "custom", apiKey: m.customKey, baseURL: base("custom") }), d: "default" });

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
        const contextWindow = lookupContextLimit(s, reqProvider, reqModelId);
        return { model: p.mk()(reqModelId), modelId: reqModelId, provider: reqProvider, contextWindow: contextWindow || undefined };
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
      // Explicit per-call model wins when it belongs to this provider or is bare.
      // If reqProvider belonged to a different unavailable provider, use this provider's default.
      let modelId;
      if (reqModelId && (!reqProvider || reqProvider === p.source)) {
        modelId = reqModelId;
      } else if (defaultModel && pref && p.source === pref) {
        modelId = defaultModel;
      } else {
        modelId = p.d;
      }
      const contextWindow = lookupContextLimit(s, p.source, modelId);
      return { model: provider(modelId), modelId, provider: p.source, contextWindow: contextWindow || undefined };
    } catch {}
  }
  return null;
}

/** Last successful agent loop id (`pi-agent-core` | `ai-sdk`). */
let lastAgentLoop = "pi-agent-core";

export function noteAgentLoop(loop) {
  if (loop === "pi-agent-core" || loop === "ai-sdk") lastAgentLoop = loop;
}

export function getRuntimeStatus(s) {
  const m = s?.ai?.manual || {};
  const ps = [];
  const push = (source, label) => ps.push({ source, label });
  if (m.openAiKey) push("openai", "OpenAI");
  if (m.anthropicKey) push("anthropic", "Anthropic");
  if (m.googleKey) push("google", "Google");
  if (m.xaiKey) push("xai", "xAI/Grok");
  if (m.groqKey) push("groq", "Groq");
  if (m.mistralKey) push("mistral", "Mistral");
  if (m.openrouterKey) push("openrouter", "OpenRouter");
  if (m.deepseekKey) push("deepseek", "DeepSeek");
  if (m.moonshotKey) push("moonshot", "Moonshot/Kimi");
  if (m.zhipuKey) push("zhipu", "Zhipu/GLM");
  if (m.minimaxKey) push("minimax", "MiniMax");
  if (m.qwenKey) push("qwen", "Qwen/DashScope");
  if (m.doubaoKey) push("doubao", "Doubao/Volcengine");
  if (m.siliconflowKey) push("siliconflow", "SiliconFlow");
  if (m.baiduKey) push("baidu", "Baidu/ERNIE");
  if (m.hunyuanKey) push("hunyuan", "Hunyuan");
  // Ollama — shown as available when the user has set the endpoint URL
  if (m.ollamaBaseUrl) push("ollama", "Ollama");
  if (m.customBaseUrl && m.customKey) push("custom", "Custom");
  const secretLost = Array.isArray(s?._secretHealth?.lost) ? s._secretHealth.lost : [];
  return {
    ready: ps.length > 0,
    message: ps.length > 0 ? "" : ei18n("ai.noProvider"),
    providers: ps,
    loop: lastAgentLoop,
    /** Keys that still have ciphertext but no longer decrypt (re-sign / lost key file). */
    secretLost,
  };
}
