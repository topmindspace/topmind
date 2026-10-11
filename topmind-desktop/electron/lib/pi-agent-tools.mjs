/**
 * Convert Desktop AI SDK tools into Pi `AgentTool`s.
 * Also registers fenced FS aliases so models that emit Pi-native names still
 * hit Kernel writeback — never unscoped FS, never bash/shell/exec.
 */
import { Type } from "@earendil-works/pi-ai";
import {
  mapPiToolNameToDesktop,
  normalizePiEditArgs,
  resolvePiToolPath,
  isBlockedShellToolName,
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

/** Shared arg surface for fenced aliases (Pi + coding-agent field names). */
const ALIAS_ARG_SCHEMA = {
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
    // list / glob / stat / mkdir / mv / cp
    dir: { type: "string" },
    dest: { type: "string" },
    destination: { type: "string" },
    target: { type: "string" },
    newName: { type: "string" },
    new_name: { type: "string" },
    overwrite: { type: "boolean" },
    encoding: { type: "string" },
    includeSystem: { type: "boolean" },
    includeHidden: { type: "boolean" },
  },
};

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
    if (isBlockedShellToolName(name)) continue;
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

  const alias = (piName, desktopName, describe, buildArgs, argSchema = ALIAS_ARG_SCHEMA) => {
    const inner = byName[desktopName];
    if (!inner || tools.some((t) => t.name === piName)) return;
    tools.push({
      name: piName,
      label: piName,
      description: describe,
      parameters: Type.Unsafe(argSchema),
      execute: async (id, params, signal, onUpdate) => {
        const mapped = mapPiToolNameToDesktop(piName);
        if (!mapped) {
          throw new Error(`${piName} is not enabled`);
        }
        const args = buildArgs(params || {});
        if (piName === "grep") {
          const scopeArg = String(args.scope || "").trim();
          if (scopeArg) {
            const gated = resolvePiToolPath(workspaceRoot, scopeArg, { allowRoot: true });
            if (!gated.ok) {
              throw new Error(`Path outside workspace (${gated.reason})`);
            }
            args.scope = gated.relativePath;
          }
        } else if (piName === "cp" || piName === "copy") {
          const srcArg = args.relativePath || args.path || "";
          const destArg = args.dest || args.destination || args.target || "";
          const gatedSrc = resolvePiToolPath(workspaceRoot, srcArg);
          if (!gatedSrc.ok) {
            throw new Error(`Path outside workspace (${gatedSrc.reason})`);
          }
          const gatedDest = resolvePiToolPath(workspaceRoot, destArg);
          if (!gatedDest.ok) {
            throw new Error(`Path outside workspace (${gatedDest.reason})`);
          }
          args.relativePath = gatedSrc.relativePath;
          args.destRelativePath = gatedDest.relativePath;
          delete args.dest;
          delete args.destination;
          delete args.target;
        } else if (piName === "list" || piName === "ls" || piName === "list_dir"
          || piName === "glob" || piName === "find" || piName === "mkdir") {
          const pathArg = args.relativePath || args.path || args.dir || args.scope || "";
          // Empty path = workspace root for list/glob; mkdir still requires a name.
          const allowRoot = piName !== "mkdir";
          const gated = pathArg
            ? resolvePiToolPath(workspaceRoot, pathArg, { allowRoot })
            : (allowRoot
              ? { ok: true, abs: workspaceRoot, relativePath: "" }
              : { ok: false, reason: "empty-path" });
          if (!gated.ok) {
            throw new Error(`Path outside workspace (${gated.reason})`);
          }
          args.relativePath = gated.relativePath;
          if (piName === "mkdir") args.path = gated.relativePath;
        } else {
          const pathArg = args.relativePath || args.path || "";
          const gated = resolvePiToolPath(workspaceRoot, pathArg);
          if (!gated.ok) {
            throw new Error(`Path outside workspace (${gated.reason})`);
          }
          args.relativePath = gated.relativePath;
          // mv/move → rename_path expects newName (same-dir). Accept dest basename.
          if (piName === "mv" || piName === "move") {
            const dest = String(args.dest || args.destination || args.target || args.newName || args.new_name || "");
            const base = dest.split(/[\\/]/u).filter(Boolean).pop() || dest;
            args.newName = base;
          }
        }
        return inner.execute(id, args, signal, onUpdate);
      },
    });
  };

  alias(
    "read",
    "read_file",
    "Read a workspace file (fenced). Prefer workspace-relative paths. Default window matches Pi (2000 lines). encoding= tolerates binary-ish text; truncation is reported in note.",
    (p) => ({
      relativePath: p.path || p.relativePath,
      offset: p.offset,
      limit: p.limit == null ? PI_READ_DEFAULT_LIMIT : p.limit,
      around: p.around,
      heading: p.heading,
      encoding: p.encoding,
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
      const out = {
        relativePath: n.path,
        oldText: n.oldText,
        newText: n.newText,
        replaceAll: n.replaceAll,
      };
      // Thread locator params so mid-file / list edits stay unique.
      if (p.startLine != null) out.startLine = p.startLine;
      if (p.endLine != null) out.endLine = p.endLine;
      if (p.heading) out.heading = p.heading;
      return out;
    },
  );
  alias(
    "grep",
    "search",
    "Search workspace Markdown/text (fenced grep, no shell). pattern/query; default skips Archive. Set regex=true only for real regex.",
    (p) => ({
      query: p.pattern || p.query || p.keyword || "",
      scope: p.path || p.scope || "",
      // Default false — same as Desktop search. Models often pass literal keywords
      // that are invalid regex (`.` `+` `(`).
      regex: p.regex === true,
      maxResults: p.maxResults,
      includeArchive: Boolean(p.includeArchive),
    }),
  );
  alias(
    "list",
    "list_files",
    "List a workspace directory (fenced). Returns name/type/size/mtime. Empty path = workspace root. Readable across all planes (content, memory/, .topmind/).",
    (p) => ({
      relativePath: p.path || p.relativePath || p.dir || "",
      includeSystem: p.includeSystem === true || p.includeHidden === true,
    }),
  );
  alias("ls", "list_files", "Alias of list (list_files).", (p) => ({
    relativePath: p.path || p.relativePath || p.dir || "",
    includeSystem: p.includeSystem === true || p.includeHidden === true,
  }));
  alias("list_dir", "list_files", "Alias of list (list_files).", (p) => ({
    relativePath: p.path || p.relativePath || p.dir || "",
    includeSystem: p.includeSystem === true || p.includeHidden === true,
  }));
  alias(
    "glob",
    "glob_files",
    "Find workspace files by glob pattern (fenced, no shell). Default skips 99-归档/Archive. Example: **/*.md or 20-专题/**/*.md",
    (p) => ({
      pattern: p.pattern || p.glob || p.query || "",
      scope: p.path || p.scope || p.dir || "",
      maxResults: p.maxResults,
      includeArchive: Boolean(p.includeArchive),
    }),
  );
  alias("find", "glob_files", "Alias of glob (glob_files).", (p) => ({
    pattern: p.pattern || p.glob || p.query || "",
    scope: p.path || p.scope || p.dir || "",
    maxResults: p.maxResults,
    includeArchive: Boolean(p.includeArchive),
  }));
  alias(
    "stat",
    "stat_path",
    "Stat a workspace path (fenced). Returns type/size/mtime.",
    (p) => ({ relativePath: p.path || p.relativePath }),
  );
  alias(
    "mkdir",
    "create_dir",
    "Create a workspace directory (fenced, write gate). Recursive.",
    (p) => ({ relativePath: p.path || p.relativePath || p.dir || "" }),
  );
  alias(
    "mv",
    "rename_path",
    "Rename/move a workspace file in place (fenced, write gate). Maps to rename_path; cross-directory moves use move_to_topic.",
    (p) => ({
      relativePath: p.path || p.relativePath,
      newName: p.newName || p.new_name || p.dest || p.destination || p.target || "",
    }),
  );
  alias("move", "rename_path", "Alias of mv (rename_path).", (p) => ({
    relativePath: p.path || p.relativePath,
    newName: p.newName || p.new_name || p.dest || p.destination || p.target || "",
  }));
  alias(
    "cp",
    "copy_file",
    "Copy a workspace file (fenced, write gate). Refuses when dest exists unless overwrite=true.",
    (p) => ({
      relativePath: p.path || p.relativePath,
      dest: p.dest || p.destination || p.target || "",
      overwrite: p.overwrite === true,
    }),
  );
  alias("copy", "copy_file", "Alias of cp (copy_file).", (p) => ({
    relativePath: p.path || p.relativePath,
    dest: p.dest || p.destination || p.target || "",
    overwrite: p.overwrite === true,
  }));
  alias(
    "rm",
    "delete_path",
    "Delete a workspace file (fenced, graded confirm). Locked/core go to Archive trash; ordinary open notes are irreversible. Use only when the user asked.",
    (p) => ({ relativePath: p.path || p.relativePath }),
  );
  alias("delete", "delete_path", "Alias of rm (delete_path).", (p) => ({
    relativePath: p.path || p.relativePath,
  }));

  return tools;
}

/**
 * Hard block for shell-shaped tool names even if a model invents them.
 * Structured fenced tools (list/glob/stat/mkdir/mv/cp/rm) replace bare bash.
 * @param {{ toolName?: string, toolCall?: { name?: string } }} context
 */
export function beforePiToolCall(context) {
  const name = String(context?.toolName || context?.toolCall?.name || "");
  if (isBlockedShellToolName(name)) {
    return {
      block: true,
      reason: "shell is disabled; use fenced list/glob/stat/read/write/edit or named workspace tools",
    };
  }
  return undefined;
}
