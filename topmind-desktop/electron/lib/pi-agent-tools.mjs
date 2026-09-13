/**
 * Convert Desktop AI SDK tools into Pi `AgentTool`s.
 * Also registers fenced `read`/`write`/`edit` aliases so models that emit
 * Pi-native names still hit Kernel writeback — never unscoped FS, never bash.
 */
import { Type } from "@earendil-works/pi-ai";
import {
  mapPiToolNameToDesktop,
  normalizePiEditArgs,
  resolvePiToolPath,
  PI_BASH_ENABLED_BY_DEFAULT,
  PI_READ_DEFAULT_LIMIT,
} from "./pi-fenced-fs.mjs";

export { PI_BASH_ENABLED_BY_DEFAULT };

function extractJsonSchema(sdkTool) {
  const raw = sdkTool?.inputSchema || sdkTool?.parameters || {};
  if (raw && typeof raw === "object" && raw.jsonSchema && typeof raw.jsonSchema === "object") {
    return raw.jsonSchema;
  }
  if (raw && raw.type === "object") return raw;
  return { type: "object", properties: {} };
}

function stringifyToolResult(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function wrapExecute(sdkTool) {
  const exec = sdkTool?.execute;
  if (typeof exec !== "function") {
    return async () => ({
      content: [{ type: "text", text: "tool has no execute" }],
      details: { ok: false },
    });
  }
  return async (_toolCallId, params, signal) => {
    const result = await exec(params, { abortSignal: signal });
    return {
      content: [{ type: "text", text: stringifyToolResult(result) }],
      details: result,
    };
  };
}

/**
 * @param {Record<string, object>} sdkTools AI SDK tool map from buildDesktopAiTools
 * @param {{ workspaceRoot?: string }} [opts]
 * @returns {object[]} Pi AgentTool[]
 */
export function convertDesktopToolsToPi(sdkTools, opts = {}) {
  const tools = [];
  const map = sdkTools && typeof sdkTools === "object" ? sdkTools : {};
  for (const [name, sdkTool] of Object.entries(map)) {
    if (!sdkTool || typeof sdkTool !== "object") continue;
    const schema = extractJsonSchema(sdkTool);
    tools.push({
      name,
      label: name,
      description: String(sdkTool.description || name),
      parameters: Type.Unsafe(schema),
      execute: wrapExecute(sdkTool),
    });
  }

  const workspaceRoot = opts.workspaceRoot;
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  const alias = (piName, desktopName, describe, buildArgs) => {
    const inner = byName[desktopName];
    if (!inner || tools.some((t) => t.name === piName)) return;
    tools.push({
      name: piName,
      label: piName,
      description: describe,
      parameters: Type.Unsafe({
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative path" },
          relativePath: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          content: { type: "string" },
          offset: { type: "number" },
          limit: { type: "number" },
          pattern: { type: "string" },
          query: { type: "string" },
          scope: { type: "string" },
          regex: { type: "boolean" },
          maxResults: { type: "number" },
          includeArchive: { type: "boolean" },
        },
      }),
      execute: async (id, params, signal, onUpdate) => {
        const mapped = mapPiToolNameToDesktop(piName);
        if (!mapped) {
          throw new Error(`${piName} is not enabled`);
        }
        const args = buildArgs(params || {});
        if (piName === "grep") {
          const scopeArg = String(args.scope || "").trim();
          if (scopeArg) {
            const gated = resolvePiToolPath(workspaceRoot, scopeArg);
            if (!gated.ok) {
              throw new Error(`Path outside workspace (${gated.reason})`);
            }
            args.scope = gated.relativePath;
          }
        } else {
          const pathArg = args.relativePath || args.path || "";
          const gated = resolvePiToolPath(workspaceRoot, pathArg);
          if (!gated.ok) {
            throw new Error(`Path outside workspace (${gated.reason})`);
          }
          args.relativePath = gated.relativePath;
        }
        return inner.execute(id, args, signal, onUpdate);
      },
    });
  };

  alias(
    "read",
    "read_file",
    "Read a workspace file (fenced). Prefer workspace-relative paths. Default window matches Pi (2000 lines).",
    (p) => ({
      relativePath: p.path || p.relativePath,
      offset: p.offset,
      limit: p.limit == null ? PI_READ_DEFAULT_LIMIT : p.limit,
      around: p.around,
      heading: p.heading,
    }),
  );
  alias(
    "write",
    "save_file",
    "Create or overwrite a workspace Markdown file (fenced, Kernel writeback).",
    (p) => ({ relativePath: p.path || p.relativePath, content: p.content || "" }),
  );
  alias(
    "edit",
    "edit_file",
    "Exact unique-span edit inside the workspace (fenced, Kernel writeback).",
    (p) => {
      const n = normalizePiEditArgs(p);
      return { relativePath: n.path, oldText: n.oldText, newText: n.newText, replaceAll: n.replaceAll };
    },
  );
  alias(
    "grep",
    "search",
    "Search workspace Markdown/text (fenced grep, no shell). pattern/query; default skips Archive.",
    (p) => ({
      query: p.pattern || p.query || p.keyword || "",
      scope: p.path || p.scope || "",
      regex: p.regex === undefined ? true : Boolean(p.regex),
      maxResults: p.maxResults,
      includeArchive: Boolean(p.includeArchive),
    }),
  );

  return tools;
}

/**
 * Hard block for Pi-native bash even if a model invents the name.
 * @param {{ toolName?: string }} context
 */
export function beforePiToolCall(context) {
  const name = String(context?.toolName || context?.toolCall?.name || "");
  if (name === "bash" && PI_BASH_ENABLED_BY_DEFAULT === false) {
    return { block: true, reason: "bash is disabled; use fenced read/write/edit or named workspace tools" };
  }
  return undefined;
}
