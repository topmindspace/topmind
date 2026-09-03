import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiBrainLine,
  RiCheckLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiFileCopyLine,
  RiLoader4Line,
  RiRefreshLine,
  RiRobot2Line,
  RiToolsLine,
  RiUserLine,
} from "@remixicon/react";
import { useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AiMessage, AiToolCall, Selection } from "../../types";
import { cn } from "../../lib/cn";
import { extractWorkspacePaths } from "../../lib/note-meta";
import { streamStatusLabel } from "../../lib/stream-status";
import { useViewStore } from "../../stores/view-store";
import { useAiStore } from "../../stores/ai-store";
import { ICON } from "../../lib/icons";
import { visibleAssistantMessage } from "../../lib/ai-chat-split";
import { Tooltip } from "../ui/tooltip";

interface Props {
  message: AiMessage;
  streaming?: boolean;
  streamStatus?: string | null;
  streamToolName?: string | null;
  streamToolCount?: number | null;
  streamMaxSteps?: number | null;
}

function openWorkspacePath(select: (sel: Selection) => void, p: string) {
  if (p.endsWith(".md")) {
    select({ kind: "file", path: p });
    return;
  }
  const parts = p.split("/").filter(Boolean);
  if (parts.length >= 2) {
    select({ kind: "topic", topicId: `${parts[0]}/${parts[1]}` });
  }
}

/** Micro-component for elapsed second ticks: localizes 1s re-render to this leaf element only */
function ElapsedSeconds() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (elapsed < 2) return null;
  return (
    <span className="font-mono text-3xs tabular-nums text-text-quaternary/60" aria-hidden>
      {elapsed}s
    </span>
  );
}

function StreamStatusIndicator({ status, toolName, count, maxSteps }: { status: string; toolName?: string | null; count?: number | null; maxSteps?: number | null }) {
  const { t } = useTranslation("editor");
  if (status === "writing" || status === "done") return null;

  let icon = RiBrainLine;
  let spin = false;
  switch (status) {
    case "preparing":
    case "compacting":
    case "steering":
      icon = RiLoader4Line;
      spin = true;
      break;
    case "calling-tool":
      icon = RiToolsLine;
      spin = true;
      break;
    case "thinking":
      icon = RiBrainLine;
      break;
    default:
      return null;
  }

  const label =
    status === "steering" ? t("ai.streamStatusSteering") : streamStatusLabel(status, toolName, count, maxSteps);
  const Icon = icon;
  return (
    <div className="flex items-center gap-1.5 px-0.5 py-0.5 text-3xs text-text-quaternary" role="status">
      <Icon size={ICON.xs} className={cn("shrink-0 opacity-80", spin && "animate-spin")} aria-hidden />
      <span className="font-mono text-3xs tracking-tight">{label}</span>
      <ElapsedSeconds key={status} />
    </div>
  );
}

/** Match any shipped AI write tool (covers all mutation operations). */
export function isAiWriteTool(name: string): boolean {
  return /^(?:save_|edit_file|capture_|create_|move_|publish_|append_|delete_|rename_|retire_|update_|add_todo|toggle_todo)/u.test(
    name.replace(/^topmind_/, ""),
  );
}

function ToolCallTimeline({ tools }: { tools: AiToolCall[] }) {
  const { t } = useTranslation("editor");
  const [allOpen, setAllOpen] = useState(false);
  if (!tools.length) return null;

  // When 3+ tools, show a compact summary line that expands all
  if (tools.length >= 3 && !allOpen) {
    const runningCount = tools.filter((t) => t.status === "running").length;
    const writeCount = tools.filter((t) => isAiWriteTool(t.name)).length;
    return (
      <div className="mb-2">
        <button
          type="button"
          onClick={() => setAllOpen(true)}
          className="flex items-center gap-1.5 rounded-[var(--radius-md)] bg-surface-muted/50 px-2 py-1 text-3xs text-text-tertiary transition-colors hover:bg-surface-muted/70"
        >
          {runningCount > 0 ? (
            <RiLoader4Line size={ICON.xs} className="shrink-0 animate-spin text-accent-color" />
          ) : (
            <RiCheckboxCircleLine size={ICON.xs} className="shrink-0 text-success" />
          )}
          <RiToolsLine size={ICON.micro} className="shrink-0 opacity-50" />
          <span className="font-mono">
            {t("ai:tool.callsCount", { count: tools.length })}
          </span>
          {writeCount > 0 ? (
            <span className="text-success/70">{t("ai:tool.writesCount", { count: writeCount })}</span>
          ) : null}
          {runningCount > 0 ? (
            <span className="text-accent-color/70">{t("ai:tool.runningCount", { count: runningCount })}</span>
          ) : null}
          <RiArrowRightSLine size={ICON.micro} className="shrink-0 opacity-50" />
        </button>
      </div>
    );
  }

  return (
    <div className="mb-2 flex flex-col gap-0.5">
      {tools.length >= 3 ? (
        <button
          type="button"
          onClick={() => setAllOpen(false)}
          className="mb-0.5 flex items-center gap-1 text-3xs text-text-quaternary hover:text-text-tertiary"
        >
          <RiArrowDownSLine size={ICON.micro} />
          {t("ai:tool.callsCollapse")}
        </button>
      ) : null}
      {tools.map((tc) => (
        <ToolCallCard key={tc.id} tool={tc} />
      ))}
    </div>
  );
}

function ToolCallCard({ tool }: { tool: AiToolCall }) {
  const { t } = useTranslation("editor");
  const [open, setOpen] = useState(false);
  const select = useViewStore((s) => s.select);
  const running = tool.status === "running";
  const paths = tool.paths?.length
    ? tool.paths
    : tool.summary
      ? extractWorkspacePaths(tool.summary)
      : [];
  const isWrite = isAiWriteTool(tool.name);
  const shortName = tool.name.replace(/^topmind_/, "");
  const primary = paths[0];

  // Diff snippets from edit_file output (stored by ai-store from tool-result event)
  const oldSnippet = tool.output?.oldSnippet as string | undefined;
  const newSnippet = tool.output?.newSnippet as string | undefined;
  const hasDiff = tool.name === "edit_file" && oldSnippet && newSnippet;
  const hasExpandable = Boolean(tool.summary || hasDiff || paths.length > 1);

  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] px-2 py-0.5 text-3xs transition-colors",
        running
          ? "bg-accent-bg-subtle/55 text-text-secondary"
          : isWrite
            ? "bg-status-success-bg/25 text-text-tertiary"
            : "bg-surface-muted/40 text-text-tertiary",
      )}
    >
      <div className="flex w-full items-center gap-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => {
            if (running) return;
            if (hasExpandable) {
              setOpen((v) => !v);
              return;
            }
            if (primary) openWorkspacePath(select, primary);
          }}
          title={primary ? t("ai.openPathTooltip", { path: primary }) : tool.summary || shortName}
        >
          {running ? (
            <RiLoader4Line size={ICON.xs} className="shrink-0 animate-spin text-accent-color" />
          ) : (
            <RiCheckboxCircleLine size={ICON.xs} className="shrink-0 text-success" />
          )}
          <code className="min-w-0 flex-1 truncate font-mono text-3xs text-text-secondary">{shortName}</code>
        </button>
        {primary && !running ? (
          <Tooltip content={primary}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openWorkspacePath(select, primary);
              }}
              className="max-w-[7rem] shrink-0 truncate rounded-[var(--radius-sm)] bg-surface/80 px-1.5 py-0.5 font-mono text-3xs text-accent-color hover:underline"
            >
              {primary.split("/").pop() || primary}
            </button>
          </Tooltip>
        ) : null}
        {hasExpandable ? (
          <button
            type="button"
            className="shrink-0 p-0.5 text-text-quaternary hover:text-text-tertiary"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            aria-label={t("ai.detailAria")}
          >
            {open ? <RiArrowDownSLine size={ICON.micro} /> : <RiArrowRightSLine size={ICON.micro} />}
          </button>
        ) : running ? (
          <span className="text-3xs text-text-quaternary">…</span>
        ) : null}
      </div>
      {/* Expanded details — only shown when explicitly opened */}
      {open && !running ? (
        <div className="mt-1 space-y-1 pl-5">
          {paths.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {paths.map((p) => (
                <Tooltip key={p} content={t("ai.openPathTooltip", { path: p })}>
                  <button
                    type="button"
                    onClick={() => openWorkspacePath(select, p)}
                    className="max-w-full truncate rounded-[var(--radius-sm)] bg-surface/80 px-1.5 py-0.5 font-mono text-3xs text-accent-color hover:underline"
                  >
                    {p.split("/").pop() || p}
                  </button>
                </Tooltip>
              ))}
            </div>
          ) : null}
          {hasDiff ? (
            <div className="rounded-[var(--radius-xs)] bg-surface-muted p-1.5 font-mono text-2xs">
              <div className="text-error line-through whitespace-pre-wrap">- {oldSnippet}</div>
              <div className="text-success whitespace-pre-wrap">+ {newSnippet}</div>
            </div>
          ) : null}
          {tool.summary ? (
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-surface px-1.5 py-1 font-mono text-2xs text-text-quaternary">
              {tool.summary}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { t } = useTranslation("editor");
  const [copied, setCopied] = useState(false);
  const lang = language?.trim() || "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="group/code relative my-2 overflow-hidden rounded-[var(--radius-md)] border border-border-subtle bg-surface-inset/40 dark:bg-surface-inset/70 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle-dim/80 bg-surface-muted/40 px-2.5 py-1">
        <span className="rounded px-1.5 py-0.5 font-mono text-3xs font-medium text-text-tertiary">
          {lang || "code"}
        </span>
        <Tooltip content={copied ? t("ai.copiedCode") : t("ai.copyCode")}>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-3xs text-text-tertiary transition-colors hover:bg-surface hover:text-text-primary v4-focus-ring"
            aria-label={copied ? t("ai.copiedLabel") : t("ai.copyLabel")}
          >
            {copied ? (
              <RiCheckLine size={ICON.micro} className="text-success" aria-hidden />
            ) : (
              <RiFileCopyLine size={ICON.micro} aria-hidden />
            )}
            {copied ? t("ai.copiedLabel") : t("ai.copyLabel")}
          </button>
        </Tooltip>
      </div>
      <pre className="overflow-x-auto p-3 text-2xs leading-[1.68] select-text">
        <code className="font-mono text-text-primary">{code}</code>
      </pre>
    </div>
  );
}

/** Render AI message markdown — code blocks, headings, lists, links, blockquotes.
 *  Lightweight inline parser (not full remark); handles common AI output patterns. */
function renderMarkdown(text: string): React.ReactNode {
  const blocks = text.split(/(```[\s\S]*?```)/g);
  return blocks.map((block, i) => {
    if (block.startsWith("```") && block.endsWith("```")) {
      const code = block.slice(3, -3);
      const firstNewline = code.indexOf("\n");
      const lang = firstNewline >= 0 ? code.slice(0, firstNewline).trim() : "";
      const body = firstNewline >= 0 ? code.slice(firstNewline + 1) : code;
      const cleaned = body.replace(/\n$/u, "");
      return <CodeBlock key={i} code={cleaned} language={lang} />;
    }
    return <BlockFormatted key={i} text={block} />;
  });
}

/** Parse a non-code text block into structural elements (headings, lists, quotes, paragraphs). */
function BlockFormatted({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: { text: string; ordered: boolean }[] = [];
  let paragraph: string[] = [];
  let quoteLines: string[] = [];
  let tableLines: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      elements.push(<p key={key++} className="my-1">{<InlineFormatted text={paragraph.join("\n")} />}</p>);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      const ordered = listItems[0].ordered;
      if (ordered) {
        elements.push(
          <ol key={key++} className="my-1 ml-5 list-decimal space-y-0.5">
            {listItems.map((li, idx) => (
              <li key={idx} className="text-sm leading-relaxed">{<InlineFormatted text={li.text} />}</li>
            ))}
          </ol>,
        );
      } else {
        elements.push(
          <ul key={key++} className="my-1 ml-5 list-disc space-y-0.5">
            {listItems.map((li, idx) => (
              <li key={idx} className="text-sm leading-relaxed">{<InlineFormatted text={li.text} />}</li>
            ))}
          </ul>,
        );
      }
      listItems = [];
    }
  };
  const flushQuote = () => {
    if (quoteLines.length > 0) {
      elements.push(
        <blockquote key={key++} className="my-1.5 border-l-2 border-accent-color/40 pl-3 text-text-secondary italic">
          {<InlineFormatted text={quoteLines.join("\n")} />}
        </blockquote>,
      );
      quoteLines = [];
    }
  };
  const flushTable = () => {
    if (tableLines.length < 2) {
      // Not a valid table — treat as paragraph
      if (tableLines.length > 0) {
        elements.push(<p key={key++} className="my-1">{<InlineFormatted text={tableLines.join("\n")} />}</p>);
      }
      tableLines = [];
      return;
    }
    // Parse table: header | separator | data rows
    const parseRow = (line: string) =>
      line.replace(/^\|/u, "").replace(/\|\s*$/u, "").split("|").map((c) => c.trim());
    const header = parseRow(tableLines[0]);
    // Check separator row for alignment
    const sep = parseRow(tableLines[1]);
    const aligns = sep.map((s) => {
      if (s.startsWith(":") && s.endsWith(":")) return "center" as const;
      if (s.endsWith(":")) return "right" as const;
      return "left" as const;
    });
    const rows = tableLines.slice(2).map(parseRow);
    elements.push(
      <div key={key++} className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-2xs">
          <thead>
            <tr>
              {header.map((h, i) => (
                <th
                  key={i}
                  className="border border-border-subtle-dim bg-surface-muted/60 px-2 py-1 font-semibold text-text-secondary"
                  style={{ textAlign: aligns[i] || "left" }}
                >
                  {<InlineFormatted text={h} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border border-border-subtle-dim px-2 py-1 text-text-tertiary"
                    style={{ textAlign: aligns[ci] || "left" }}
                  >
                    {<InlineFormatted text={cell} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableLines = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); flushTable(); };

  for (const line of lines) {
    // Heading: ## or ### or ####
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushAll();
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      const cls = level <= 1 ? "text-base font-bold mt-2 mb-1" : level === 2 ? "text-sm font-bold mt-2 mb-0.5" : "text-sm font-semibold mt-1.5 mb-0.5";
      elements.push(<div key={key++} className={cls}>{<InlineFormatted text={headingText} />}</div>);
      continue;
    }
    // Blockquote
    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quoteLines.push(line.replace(/^>\s?/, ""));
      continue;
    }
    // Unordered list
    const ulMatch = line.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      flushQuote();
      listItems.push({ text: ulMatch[1], ordered: false });
      continue;
    }
    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      flushQuote();
      listItems.push({ text: olMatch[1], ordered: true });
      continue;
    }
    // Horizontal rule
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      flushAll();
      elements.push(<hr key={key++} className="my-2 border-t border-border-subtle-dim" />);
      continue;
    }
    // Markdown table row: starts with |
    if (/^\|/u.test(line)) {
      flushParagraph();
      flushList();
      flushQuote();
      tableLines.push(line);
      continue;
    }
    // Empty line — flush
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    // Regular paragraph line
    flushList();
    flushQuote();
    flushTable();
    paragraph.push(line);
  }
  flushAll();
  return <>{elements.map((el) => el)}</>;
}

function InlineFormatted({ text }: { text: string }) {
  const select = useViewStore((s) => s.select);
  // Split on **bold**, ~~strikethrough~~, *italic*, `code`, [link](url)
  const segments = text.split(/(\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.startsWith("**") && seg.endsWith("**")) {
          return <strong key={i} className="font-semibold text-text-primary">{seg.slice(2, -2)}</strong>;
        }
        if (seg.startsWith("~~") && seg.endsWith("~~")) {
          return <del key={i} className="line-through text-text-quaternary opacity-80">{seg.slice(2, -2)}</del>;
        }
        if (seg.startsWith("*") && seg.endsWith("*") && seg.length > 2) {
          return <em key={i} className="italic text-text-secondary">{seg.slice(1, -1)}</em>;
        }
        if (seg.startsWith("`") && seg.endsWith("`")) {
          const inner = seg.slice(1, -1);
          const pathLike = extractWorkspacePaths(inner)[0] === inner || /\.md$/u.test(inner);
          if (pathLike && inner.includes("/")) {
            return (
              <button
                key={i}
                type="button"
                onClick={() => select({ kind: "file", path: inner })}
                className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-3xs text-accent-color hover:underline"
              >
                {inner}
              </button>
            );
          }
          return (
            <code key={i} className="rounded bg-surface-muted px-1.5 py-0.5 text-3xs font-mono text-text-primary">
              {inner}
            </code>
          );
        }
        // Markdown link [text](url)
        const linkMatch = seg.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          const linkText = linkMatch[1];
          const url = linkMatch[2];
          return (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-color underline underline-offset-2 hover:opacity-80"
              onClick={(e) => {
                // Internal workspace path links
                if (url.endsWith(".md") && url.includes("/")) {
                  e.preventDefault();
                  select({ kind: "file", path: url });
                }
              }}
            >
              {linkText}
            </a>
          );
        }
        return <span key={i}>{seg}</span>;
      })}
    </>
  );
}

/** Token usage badge — shown after streaming completes on non-error assistant messages. */
function UsageBadge({ usage, modelId }: { usage: NonNullable<AiMessage["usage"]>; modelId?: string }) {
  const { t } = useTranslation("editor");
  const total = usage.totalTokens;
  if (!total && !usage.promptTokens && !usage.completionTokens) return null;
  const parts: string[] = [];
  if (usage.promptTokens != null) parts.push(`${usage.promptTokens}↑`);
  if (usage.completionTokens != null) parts.push(`${usage.completionTokens}↓`);
  if (total != null && !parts.length) parts.push(`${total}`);
  const label = parts.join(" ");
  const tooltip = [
    modelId ? `Model: ${modelId}` : null,
    usage.promptTokens != null ? `Prompt: ${usage.promptTokens}` : null,
    usage.completionTokens != null ? `Completion: ${usage.completionTokens}` : null,
    total != null ? `Total: ${total}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <Tooltip content={tooltip}>
      <span className="mt-0.5 inline-flex items-center gap-0.5 text-2xs tabular-nums text-text-tertiary">
        {label}
      </span>
    </Tooltip>
  );
}

/** Error block with retry button — replaces inline ⚠️ text for better UX. */
function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation("editor");
  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-error/20 bg-status-error-bg/50 px-2.5 py-2 text-3xs text-error">
      <div className="flex items-start gap-1.5">
        <RiErrorWarningLine size={ICON.xs} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap">{message}</span>
      </div>
      <div className="flex justify-end">
        <Tooltip content={t("ai.retryTooltip")}>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-error/10 px-2 py-0.5 text-3xs font-medium text-error transition-colors hover:bg-error/20"
            aria-label={t("ai.retryLabel")}
          >
            <RiRefreshLine size={ICON.micro} />
            {t("ai.retryLabel")}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function ReasoningBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const { t } = useTranslation("editor");
  // Default collapsed always — user can expand to inspect reasoning trace.
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // While streaming with the trace open, keep the latest tokens in view.
  useEffect(() => {
    if (!streaming || !open) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, streaming, open]);

  if (!text?.trim()) return null;

  // Live tail preview: last non-empty line, so a collapsed trace still shows progress.
  const tailPreview = (() => {
    if (!streaming || open) return "";
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.length ? lines[lines.length - 1] : "";
  })();

  const charCount = text.trim().length;

  return (
    <div className="mb-2 rounded-[var(--radius-md)] border border-border-subtle/80 bg-surface-muted/40">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-3xs text-text-quaternary hover:text-text-tertiary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <RiBrainLine size={ICON.xs} className={cn("shrink-0 opacity-80", streaming && !open && "animate-pulse text-accent-color/70")} />
        <span className="shrink-0 font-medium">{t("ai.reasoningLabel")}</span>
        {streaming && !open ? (
          tailPreview ? (
            <span className="min-w-0 flex-1 truncate font-normal italic opacity-80" aria-live="polite">
              {tailPreview}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-text-quaternary/70">{t("ai.reasoningStreaming")}</span>
          )
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {!streaming ? (
          <span className="shrink-0 tabular-nums text-text-quaternary/70">
            {t("ai.reasoningDone")} · {t("ai.reasoningChars", { count: charCount })}
          </span>
        ) : null}
        {open ? <RiArrowDownSLine size={ICON.micro} className="shrink-0" /> : <RiArrowRightSLine size={ICON.micro} className="shrink-0" />}
      </button>
      <div
        className="v4-reasoning-expand"
        data-open={open}
        aria-hidden={!open}
      >
        <div
          ref={bodyRef}
          className="max-h-40 overflow-auto border-t border-border-subtle/60 px-2.5 py-1.5 text-2xs italic leading-relaxed text-text-quaternary whitespace-pre-wrap"
        >
          {text}
          {streaming ? <span className="v4-stream-cursor" aria-hidden /> : null}
        </div>
      </div>
    </div>
  );
}

export function ChatMessage({ message, streaming, streamStatus, streamToolName, streamToolCount, streamMaxSteps }: Props) {
  const { t } = useTranslation("editor");
  const regenerate = useAiStore((s) => s.regenerate);
  const [copied, setCopied] = useState(false);
  if (message.role === "system") return null;
  const isUser = message.role === "user";
  const isError = Boolean(message.isError);
  const tools = message.toolCalls || [];
  const visible = useMemo(() => {
    return !isUser && !isError
      ? visibleAssistantMessage(message.content, message.reasoning)
      : { body: message.content, reasoning: "" };
  }, [isUser, isError, message.content, message.reasoning]);
  const visibleBody = visible.body;
  const visibleReasoning = visible.reasoning;
  const hasReasoning = Boolean(visibleReasoning.trim());

  const renderedMarkdown = useMemo(() => {
    if (!visibleBody) return null;
    return renderMarkdown(visibleBody);
  }, [visibleBody]);

  // Reasoning is always collapsed by default — show a pulsing indicator while streaming.
  const showStatusIndicator =
    !isUser && streaming && !message.content && tools.length === 0 && streamStatus;
  const hasContent = Boolean(visibleBody);
  const showUsage = !streaming && !isError && Boolean(message.usage);

  // No enter animation here — parent gates motion so stream deltas don't re-animate
  return (
    <div className={cn("group/msg flex items-start gap-2.5", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? (
        <div
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1",
            isError
              ? "bg-status-error-bg text-error ring-error/20"
              : "bg-accent-bg-subtle text-accent-color ring-accent-border-subtle",
          )}
          aria-hidden
        >
          {isError ? <RiErrorWarningLine size={ICON.sm} /> : <RiRobot2Line size={ICON.sm} />}
        </div>
      ) : null}
      <div
        className={cn(
          "max-w-[min(85%,36rem)] wrap-break-word px-3.5 py-2.5 text-sm leading-[1.65]",
          isUser ? "v4-msg-user whitespace-pre-wrap" : "v4-msg-assistant text-text-primary",
          streaming && !isUser && hasContent && "v4-stream-cursor",
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : isError ? (
          <ErrorBlock message={message.content} onRetry={() => void regenerate()} />
        ) : (
          <div className="flex flex-col">
            {tools.length > 0 ? <ToolCallTimeline tools={tools} /> : null}
            {hasReasoning ? (
              <ReasoningBlock text={visibleReasoning} streaming={streaming} />
            ) : null}
            {showStatusIndicator ? (
              <StreamStatusIndicator status={streamStatus!} toolName={streamToolName} count={streamToolCount} maxSteps={streamMaxSteps} />
            ) : null}
            {hasContent ? (
              <div className="whitespace-pre-wrap">{renderedMarkdown}</div>
            ) : streaming && tools.length === 0 && !showStatusIndicator && !hasReasoning ? (
              <StreamStatusIndicator status={streamStatus || "thinking"} toolName={streamToolName} count={streamToolCount} maxSteps={streamMaxSteps} />
            ) : !streaming && !hasContent && tools.length === 0 ? (
              <span className="text-3xs text-text-quaternary">{t("ai.noTextReply")}</span>
            ) : null}
            {showUsage && message.usage ? (
              <UsageBadge usage={message.usage} modelId={message.modelId} />
            ) : null}
            {!streaming && hasContent ? (
              <div className="mt-1 flex justify-start">
                <button
                  type="button"
                  className="inline-flex h-5 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 text-3xs text-text-quaternary opacity-0 transition-opacity group-hover/msg:opacity-100 hover:text-text-secondary focus-visible:opacity-100 v4-focus-ring"
                  onClick={() => {
                    void navigator.clipboard.writeText(visibleBody).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                  aria-label={copied ? t("ai.copied") : t("ai.copyReply")}
                >
                  {copied ? <RiCheckLine size={ICON.micro} className="text-success" /> : <RiFileCopyLine size={ICON.micro} />}
                  {copied ? t("ai.copied") : t("ai.copyReply")}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {isUser ? (
        <div
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-button)]"
          aria-hidden
        >
          <RiUserLine size={ICON.sm} />
        </div>
      ) : null}
    </div>
  );
}
