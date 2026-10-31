/**
 * Renderer cache of workspace image paths.
 * The markdown rewrite never walks the disk — it only reads this list.
 */
import { api } from "../services/api";

let cache: { root: string; paths: readonly string[] | undefined } | null = null;
let pending: { root: string; task: Promise<readonly string[] | undefined> } | null = null;

export function peekWorkspaceImagePaths(): readonly string[] | undefined {
  return cache?.paths;
}

export function invalidateWorkspaceImagePaths(): void {
  cache = null;
  pending = null;
}

export function ensureWorkspaceImagePaths(root = ""): Promise<readonly string[] | undefined> {
  if (cache && cache.root === root) return Promise.resolve(cache.paths);
  if (pending && pending.root === root) return pending.task;
  const task = api.ws
    .listImagePaths()
    .then((r) => {
      if (pending?.task !== task) return cache?.root === root ? cache.paths : undefined;
      // A partial index cannot establish a unique basename. `undefined`
      // keeps pathless embeds unresolved while explicit paths stay usable.
      const paths = r?.truncated === true ? undefined : Array.isArray(r?.paths) ? r.paths : [];
      cache = { root, paths };
      return paths as readonly string[] | undefined;
    })
    .catch(() => undefined)
    .finally(() => {
      if (pending?.task === task) pending = null;
    });
  pending = { root, task };
  return task;
}
