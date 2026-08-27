/**
 * Built-in workspace views — one ViewSlot per Selection kind.
 * Heavy views (especially Tiptap FileEditor) are code-split so home/tree
 * boot does not pay the editor vendor cost.
 */
import { lazy, type ReactNode } from "react";
import type { ViewSlot } from "../types";
import { LazyBoundary } from "../../components/ui/LazyBoundary";
import i18n from "../../locales";
import { StreamDetailView } from "./views/StreamDetailView";
import { CategoryView } from "./views/CategoryView";
import { TopicOverviewView } from "./views/TopicOverviewView";
import { FilePreviewView } from "./views/FilePreviewView";
import { InboxView } from "./views/InboxView";
import { OutputsView } from "./views/OutputsView";
import { ArchiveView } from "./views/ArchiveView";
import { MemoryBrowseView } from "./views/MemoryBrowseView";
import { isMarkdownNotePath } from "../../lib/file-preview";

const FileEditorView = lazy(() =>
  import("./views/FileEditorView").then((m) => ({ default: m.FileEditorView })),
);

function withLazy(node: ReactNode) {
  return <LazyBoundary label={i18n.t("common:action.loading")}>{node}</LazyBoundary>;
}

export function createWorkspaceViews(): ViewSlot[] {
  return [
    {
      kind: "view",
      id: "topmind-workspace.view.stream",
      order: 10,
      matches: (sel) => sel.kind === "stream",
      render: () => <StreamDetailView />,
    },
    {
      kind: "view",
      id: "topmind-workspace.view.category",
      order: 10,
      matches: (sel) => sel.kind === "category",
      render: ({ sel }) => (sel.kind === "category" ? <CategoryView category={sel.category} /> : null),
    },
    {
      kind: "view",
      id: "topmind-workspace.view.topic",
      order: 10,
      matches: (sel) => sel.kind === "topic",
      render: ({ sel }) => (sel.kind === "topic" ? <TopicOverviewView topicId={sel.topicId} /> : null),
    },
    {
      kind: "view",
      id: "topmind-workspace.view.file",
      order: 10,
      matches: (sel) => sel.kind === "file",
      render: ({ sel }) => {
        if (sel.kind !== "file") return null;
        if (isMarkdownNotePath(sel.path)) {
          return withLazy(
            <FileEditorView
              path={sel.path}
              topicId={sel.topicId}
              readOnly={sel.readOnly}
              focusHeading={sel.focusHeading}
            />,
          );
        }
        return (
          <FilePreviewView
            key={sel.path}
            path={sel.path}
            topicId={sel.topicId}
            readOnly={sel.readOnly}
          />
        );
      },
    },
    {
      kind: "view",
      id: "topmind-workspace.view.inbox",
      order: 10,
      matches: (sel) => sel.kind === "inbox",
      render: () => <InboxView />,
    },
    {
      kind: "view",
      id: "topmind-workspace.view.outputs",
      order: 10,
      matches: (sel) => sel.kind === "outputs",
      render: () => <OutputsView />,
    },
    {
      kind: "view",
      id: "topmind-workspace.view.archive",
      order: 10,
      matches: (sel) => sel.kind === "archive",
      render: () => <ArchiveView />,
    },
    {
      kind: "view",
      id: "topmind-workspace.view.memory",
      order: 10,
      matches: (sel) => sel.kind === "memory",
      render: () => <MemoryBrowseView />,
    },
  ];
}
