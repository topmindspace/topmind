import { useEffect, useState } from "react";
import { onLocal } from "../plugins/host";
import { useViewStore } from "../stores/view-store";
import {
  ensureWorkspaceImagePaths,
  invalidateWorkspaceImagePaths,
  peekWorkspaceImagePaths,
} from "./workspace-image-paths";

/**
 * Re-render when the image index arrives, the workspace changes, or a file
 * move/save drops the cached list. The listener lives here so stream preview
 * tests never import the view store through the cache module.
 */
export function useWorkspaceImagePaths(): readonly string[] | undefined {
  const root = useViewStore((s) => s.workspaceRoot);
  const [paths, setPaths] = useState<readonly string[] | undefined>(() => peekWorkspaceImagePaths());
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    return onLocal("workspace:file-changed", () => {
      invalidateWorkspaceImagePaths();
      setEpoch((n) => n + 1);
    });
  }, []);
  useEffect(() => {
    let live = true;
    setPaths(peekWorkspaceImagePaths());
    void ensureWorkspaceImagePaths(root).then((next) => {
      if (live) setPaths(next);
    });
    return () => {
      live = false;
    };
  }, [root, epoch]);
  return paths;
}
