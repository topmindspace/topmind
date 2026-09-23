/**
 * Pi-native FS tools mapped onto the workspace fence + Desktop domain tools.
 *
 * Desktop's target agent loop is `@earendil-works/pi-agent-core` (not the full
 * coding-agent kernel). Shell-shaped names stay OFF (never registered).
 * Structured aliases (list/glob/stat/mkdir/mv/cp/rm) replace bare bash.
 * Every path is resolved against the current workspace root; outside
 * writes/reads are denied here before Kernel writeback / evaluateOutsideRead.
 */
import path from "node:path";

export const PI_NATIVE_FS_TOOLS = Object.freeze([
  "read", "write", "edit",
  "list", "ls", "list_dir",
  "glob", "find",
  "stat",
  "mkdir",
  "mv", "move",
  "cp", "copy",
  "rm", "delete",
]);
export const PI_BASH_ENABLED_BY_DEFAULT = false;
/** Shell-shaped names are never registered and always blocked at the gate. */
export const PI_BLOCKED_SHELL_TOOLS = Object.freeze([
  "bash", "shell", "exec", "run_in_workspace", "command", "eval", "subprocess",
]);
/** Pi coding-agent read default window (packages/agent DEFAULT_MAX_LINES). */
export const PI_READ_DEFAULT_LIMIT = 2000;

/**
 * Map a Pi-native tool name to the Desktop domain tool it must not bypass.
 * Domain tools (capture / memory / todos / topics) stay named Desktop tools.
 * @param {string} name
 * @returns {string | null}
 */
export function mapPiToolNameToDesktop(name) {
  switch (String(name || "")) {
    case "read":
      return "read_file";
    case "write":
      return "save_file";
    case "edit":
      return "edit_file";
    case "grep":
      return "search";
    case "list":
    case "ls":
    case "list_dir":
      return "list_files";
    case "glob":
    case "find":
      return "glob_files";
    case "stat":
      return "stat_path";
    case "mkdir":
      return "create_dir";
    case "mv":
    case "move":
      return "rename_path";
    case "cp":
    case "copy":
      return "copy_file";
    case "rm":
    case "delete":
      return "delete_path";
    default:
      return null;
  }
}

/** True when the name is a shell / unscoped process tool (never allowed). */
export function isBlockedShellToolName(name) {
  return PI_BLOCKED_SHELL_TOOLS.includes(String(name || ""));
}

/** JSON-schema allowJson by extension (intentional config payloads). */
export function allowsJsonWriteBody(relativePath) {
  return /\.(?:json|jsonc|ya?ml|toml|ini|cfg|conf)$/iu.test(String(relativePath || ""));
}

/**
 * Resolve a Pi tool path against the workspace root.
 * Accepts workspace-relative or absolute-inside-root paths.
 * Rejects empty, `..` escape, sibling-prefix, and absolute-outside.
 *
 * @param {string} workspaceRoot
 * @param {string} rawPath
 * @param {{ allowRoot?: boolean }} [opts] allow listing / globbing the root itself
 * @returns {{ ok: true, abs: string, relativePath: string } | { ok: false, reason: string, abs?: string }}
 */
export function resolvePiToolPath(workspaceRoot, rawPath, opts = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    return { ok: false, reason: "no-workspace" };
  }
  const input = String(rawPath ?? "").trim();
  if (!input) return { ok: false, reason: "empty-path" };
  if (input.includes("\0")) return { ok: false, reason: "invalid-path" };

  const root = path.resolve(workspaceRoot);
  const abs = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, input);
  if (abs === root) {
    if (opts.allowRoot) {
      return { ok: true, abs, relativePath: "" };
    }
    return { ok: false, reason: "workspace-root", abs };
  }
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: "outside-workspace", abs };
  }
  return { ok: true, abs, relativePath: rel.replace(/\\/g, "/") };
}

/**
 * Normalize Pi edit args (`oldText`/`newText` or coding-agent `old_string`/`new_string`).
 * @param {Record<string, unknown>} args
 */
export function normalizePiEditArgs(args) {
  const src = args && typeof args === "object" ? args : {};
  const pathArg = src.path ?? src.relativePath;
  const oldText = src.oldText ?? src.old_string;
  const newText = src.newText ?? src.new_string;
  return {
    path: typeof pathArg === "string" ? pathArg : "",
    oldText: typeof oldText === "string" ? oldText : "",
    newText: typeof newText === "string" ? newText : "",
    replaceAll: Boolean(src.replaceAll ?? src.replace_all),
  };
}
