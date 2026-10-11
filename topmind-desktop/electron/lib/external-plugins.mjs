/**
 * Third-party / external Desktop plugins.
 *
 * Layout (industry-aligned folder plugin model, similar to VS Code / Obsidian):
 *
 *   {topmind_DESKTOP_HOME}/plugins/
 *     my-plugin/
 *       topmind-plugin.json   ← required manifest
 *       index.mjs             ← optional main (activate export)
 *       README.md
 *
 * Discovery is side-effect free. Loading renderer plugins is opt-in via host
 * (see PLUGIN.md). Invalid manifests are skipped with reasons, never crash Desktop.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

/** @returns {string} Absolute plugins root under Desktop home. */
export function getPluginsRoot() {
  try {
    const { resolveDesktopStateHome } = require("./workspace-home.mjs");
    const home = resolveDesktopStateHome();
    return path.join(home, "plugins");
  } catch {
    const os = require("node:os");
    return path.join(os.homedir(), "topmind", "topmind-desktop", "plugins");
  }
}

/**
 * @typedef {object} ExternalPluginManifest
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {string} [description]
 * @property {string} [author]
 * @property {string} [main] relative entry (default index.mjs)
 * @property {string} [homepage]
 * @property {string[]} [permissions] e.g. ["rpc:workspace", "slot:sidebar"]
 * @property {string[]} [slots] declared slot kinds
 * @property {boolean} [enabled] default true when present in folder
 */

/**
 * Validate and normalize a raw manifest object.
 * @param {unknown} raw
 * @param {string} dirName folder name (fallback id)
 * @returns {{ ok: true, manifest: ExternalPluginManifest } | { ok: false, error: string }}
 */
export function normalizeManifest(raw, dirName = "plugin") {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "manifest must be a JSON object" };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : null;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : null;
  const version = typeof o.version === "string" && o.version.trim() ? o.version.trim() : null;
  if (!id) return { ok: false, error: "missing required field: id" };
  if (!name) return { ok: false, error: "missing required field: name" };
  if (!version) return { ok: false, error: "missing required field: version" };
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    return { ok: false, error: `invalid id "${id}" (use kebab-case alphanumeric)` };
  }
  // Reserve topmind-* for first-party builtins
  if (id.startsWith("topmind-") && !o.official) {
    return { ok: false, error: `id "${id}" is reserved for first-party topmind plugins` };
  }
  const main = typeof o.main === "string" && o.main.trim() ? o.main.trim() : "index.mjs";
  if (main.includes("..") || path.isAbsolute(main)) {
    return { ok: false, error: "main must be a relative path without .." };
  }
  return {
    ok: true,
    manifest: {
      id,
      name,
      version,
      description: typeof o.description === "string" ? o.description : undefined,
      author: typeof o.author === "string" ? o.author : undefined,
      main,
      homepage: typeof o.homepage === "string" ? o.homepage : undefined,
      permissions: Array.isArray(o.permissions) ? o.permissions.map(String) : [],
      slots: Array.isArray(o.slots) ? o.slots.map(String) : [],
      enabled: o.enabled === false ? false : true,
    },
  };
}

/**
 * Scan plugins root; return discovered plugins with status.
 * @param {string} [root]
 */
export async function listExternalPlugins(root = getPluginsRoot()) {
  /** @type {Array<object>} */
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT") {
      return [];
    }
    throw e;
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith(".")) continue;
    const dir = path.join(root, ent.name);
    const manifestPath = path.join(dir, "topmind-plugin.json");
    try {
      const raw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const norm = normalizeManifest(raw, ent.name);
      if (!norm.ok) {
        out.push({
          id: ent.name,
          dir,
          status: "invalid",
          error: norm.error,
          manifest: null,
        });
        continue;
      }
      const entryPath = path.join(dir, norm.manifest.main);
      let hasEntry = false;
      try {
        await fs.access(entryPath);
        hasEntry = true;
      } catch {
        hasEntry = false;
      }
      out.push({
        id: norm.manifest.id,
        dir,
        status: hasEntry ? "ready" : "no-entry",
        error: hasEntry ? null : `entry not found: ${norm.manifest.main}`,
        manifest: norm.manifest,
        entryPath: hasEntry ? entryPath : null,
        entryUrl: hasEntry ? pathToFileURL(entryPath).href : null,
      });
    } catch (e) {
      out.push({
        id: ent.name,
        dir,
        status: "invalid",
        error: e instanceof Error ? e.message : String(e),
        manifest: null,
      });
    }
  }

  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return out;
}

export async function ensurePluginsDir(root = getPluginsRoot()) {
  await fs.mkdir(root, { recursive: true });
  // Drop a short README so users discover the convention
  const readme = path.join(root, "README.md");
  try {
    await fs.access(readme);
  } catch {
    await fs.writeFile(
      readme,
      `# topmind external plugins

Place each plugin in its own folder:

\`\`\`text
plugins/
  my-connector/
    topmind-plugin.json
    index.mjs
\`\`\`

See the engine repo \`topmind-desktop/PLUGIN.md\` for the full third-party guide.
`,
      "utf8",
    );
  }
  return root;
}

export async function openPluginsDir() {
  const root = await ensurePluginsDir();
  const { shell } = require("electron");
  await shell.openPath(root);
  return { ok: true, path: root };
}

/**
 * Example scaffold content for docs / tests.
 */
export function exampleManifest() {
  return {
    id: "example-hello",
    name: "Hello Plugin",
    version: "0.1.0",
    description: "Minimal third-party topmind Desktop plugin scaffold",
    author: "you",
    main: "index.mjs",
    permissions: ["slot:action"],
    slots: ["action"],
  };
}
