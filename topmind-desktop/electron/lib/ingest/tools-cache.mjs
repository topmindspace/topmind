/**
 * Persist anydoc/markitdown/pandoc probe results so Settings/Hub do not re-scan PATH
 * on every open. Probe runs on first use or when user force-refreshes.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getIngestUserDataDir } from "./runtime-paths.mjs";

const CACHE_FILE = "ingest-tools-cache.json";

function cachePath() {
  const dir = getIngestUserDataDir();
  if (!dir) return null;
  return path.join(dir, CACHE_FILE);
}

/**
 * @returns {Promise<{
 *   checkedAt: string,
 *   anydoc: object,
 *   pandoc: object,
 *   markitdown: object,
 *   pathAugmented?: boolean,
 * } | null>}
 */
export async function readToolsDiskCache() {
  const p = cachePath();
  if (!p) return null;
  try {
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.checkedAt || !parsed.pandoc || !parsed.markitdown || !parsed.anydoc) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {{ checkedAt: string, anydoc?: object, pandoc: object, markitdown: object, pathAugmented?: boolean }} tools
 */
export async function writeToolsDiskCache(tools) {
  const p = cachePath();
  if (!p || !tools) return;
  try {
    await fs.mkdir(path.dirname(p), { recursive: true });
    const slim = {
      checkedAt: tools.checkedAt,
      anydoc: slimTool(tools.anydoc),
      pandoc: slimTool(tools.pandoc),
      markitdown: slimTool(tools.markitdown),
      pathAugmented: Boolean(tools.pathAugmented),
    };
    await fs.writeFile(p, JSON.stringify(slim, null, 2), "utf8");
  } catch {
    /* non-fatal */
  }
}

function slimTool(t) {
  if (!t || typeof t !== "object") {
    return { available: false, version: null, path: "", install: null };
  }
  return {
    available: Boolean(t.available),
    version: t.version ?? null,
    path: t.path || "",
    viaModule: t.viaModule,
    source: t.source,
    install: t.install || null,
    upgradable: t.upgradable,
  };
}

export async function clearToolsDiskCache() {
  const p = cachePath();
  if (!p) return;
  try {
    await fs.unlink(p);
  } catch {
    /* ignore */
  }
}
