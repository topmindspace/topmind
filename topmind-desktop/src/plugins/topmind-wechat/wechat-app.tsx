/**
 * 公众号创作 mini-app — DS 4.2 一站式工作流（对齐 ledger 壳）。
 * 包列表 → 改稿 → 质检三关 → 排版导出。写盘仅 api.ws.*（path receipt）。
 * 规则子集同源 skills/topmind-wechat（scan_ai_flavor / lint-wechat / md2wechat）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiAddLine,
  RiCheckboxCircleLine,
  RiDownloadLine,
  RiFileCopyLine,
  RiFileTextLine,
  RiFolderOpenLine,
  RiSearchLine,
  RiSparklingLine,
} from "@remixicon/react";
import type { OverlaySlot, PluginContext } from "../types";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { onLocal } from "../host";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { EmptyState, LoadingState, MetaText, listRowClass } from "../../components/ui/view";
import { AppModeTabs, AppSlot, ConfirmLeaveDialog, ConnectorToastBanner, ConnectorToolChip, PluginAppHeader, StatSlot } from "../connector-ui";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/kit";
import { toastWriteback } from "../../lib/writeback-toast";
import { getCachedSettings } from "../../lib/settings-cache";
import { setOverlayCloseGuard } from "../../lib/overlay-close-guard";
import { formatChord } from "../../lib/chord";
import {
  analyzeWechatQuality,
  countChineseChars,
  defaultFactChecklist,
  WECHAT_AI_TARGET,
  WECHAT_MAX_ITEM,
  WECHAT_MAX_PARA,
} from "../../lib/wechat-quality";
import {
  resolveWechatTheme,
  stripWechatFrontmatter,
  wechatCopyHtml,
  wechatHtmlDocument,
  WECHAT_THEME_IDS,
  type WechatThemeId,
} from "../../lib/wechat-format";

type StepId = "packages" | "edit" | "quality" | "preview";

const STATUS_DRAFT = "草稿";
const STATUS_FINAL = "定稿";
const STATUS_PUBLISHED = "已发布";

interface WechatPackage {
  relPath: string;
  name: string;
  draftPath: string;
  hasDraft: boolean;
  status: string;
  wordCount: number;
  mtime: string;
  title: string;
}

export function createWechatOverlaySlot(_ctx: PluginContext): OverlaySlot {
  return {
    kind: "overlay",
    id: "topmind-wechat.app",
    matches: (kind) => kind === "plugin-app:topmind-wechat",
    render: () => <WechatApp />,
  };
}

function resolvePackageRoot(): string {
  const hint = getCachedSettings()?.wechat?.packageRoot?.trim();
  if (hint) return hint.replace(/^\/+|\/+$/g, "");
  const year = new Date().getFullYear();
  return `40-创作/${year}-公众号`;
}

type ImageCheckItem = { src: string; status: "embedded" | "missing" | "remote" | "data" };

async function replaceAsync(
  input: string,
  re: RegExp,
  repl: (match: string, g1: string, g2: string) => Promise<string>,
): Promise<string> {
  const parts: string[] = [];
  let last = 0;
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = global.exec(input)) !== null) {
    parts.push(input.slice(last, m.index));
    parts.push(await repl(m[0], m[1] || "", m[2] || ""));
    last = m.index + m[0].length;
  }
  parts.push(input.slice(last));
  return parts.join("");
}

async function embedLocalImagesWithChecklist(
  md: string,
  packageRel: string,
): Promise<{ md: string; checklist: ImageCheckItem[] }> {
  const checklist: ImageCheckItem[] = [];
  const out = await replaceAsync(md, /!\[([^\]]*)\]\(([^)\s]+)\)/g, async (_m, alt: string, src: string) => {
    if (/^data:/i.test(src)) {
      checklist.push({ src, status: "data" });
      return `![${alt}](${src})`;
    }
    if (/^(https?:)?\/\//i.test(src)) {
      checklist.push({ src, status: "remote" });
      return `![${alt}](${src})`;
    }
    const rel = packageRel
      ? `${packageRel.replace(/\/$/, "")}/${src.replace(/^\.\//, "")}`
      : src;
    try {
      const bin = await api.ws.readBinary(rel);
      checklist.push({ src, status: "embedded" });
      return `![${alt}](data:${bin.contentType};base64,${bin.base64})`;
    } catch {
      checklist.push({ src, status: "missing" });
      return `![${alt}](${src})`;
    }
  });
  return { md: out, checklist };
}

function buildUploadChecklist(slug: string, items: ImageCheckItem[]): string {
  const lines = [
    `# 图片上传清单 · ${slug}`,
    "",
    `> 生成于 ${new Date().toISOString().slice(0, 10)}。HTML 已对可读本地图做 base64 内嵌；下表为兜底补传顺序（按正文出现顺序）。`,
    "",
    `- 正文图数：${items.length}`,
    `- 已内嵌：${items.filter((i) => i.status === "embedded").length}`,
    `- 缺失/占位：${items.filter((i) => i.status === "missing").length}`,
    `- 远程图：${items.filter((i) => i.status === "remote").length}`,
    "",
    "| # | 状态 | 路径 |",
    "|---|------|------|",
  ];
  items.forEach((it, i) => {
    const label =
      it.status === "embedded" ? "已内嵌" :
      it.status === "missing" ? "缺失占位" :
      it.status === "remote" ? "远程" : "data URI";
    lines.push(`| ${i + 1} | ${label} | \`${it.src.slice(0, 80)}\` |`);
  });
  if (items.some((i) => i.status === "missing")) {
    lines.push("", "缺失项请从交付包 `images/` 按上表顺序手动补传。");
  }
  lines.push("", "正文首图建议另备 2.35:1 封面（公众号首条封面比例）。", "");
  return lines.join("\n");
}

function buildSkeleton(title: string, _slug: string): string {
  const now = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();
  return `---
title: "${title}"
category: 40-创作
topic: ${year}-公众号
source_type: user-original
captured_at: ${now}
status: 草稿
direction: reverse
source_file: ""
target_file: pending
word_count: 0
tags: [公众号, 排版]
note_role: bundle
---

# ${title}

<!-- 骨架说明（写作时逐条删除）：
  1. 开头：3 句内给出「反差钩子」。
  2. 小标题用 ##；单段 ≤ ${WECHAT_MAX_PARA} 字；列表项 ≤ ${WECHAT_MAX_ITEM} 字。
  3. 关键数据用 ::: stat（每行「值 | 说明」）。
  4. 外链写 [文字](url)，导出自动转文末脚注。
-->

> 一句话导语：这篇文章解决什么问题、读者能带走什么。

## 为什么值得聊

## 核心内容

### 分论点一

### 分论点二

## 我的看法

::: pull
把最想让读者记住的一句话放在这里。
:::

## 小结

---

*本文首发于我的公众号，转载请注明出处。*
`;
}

function statusTone(status: string): string {
  if (status === STATUS_DRAFT) return "bg-status-warning-bg text-warning";
  if (status === STATUS_FINAL) return "bg-status-success-bg text-success";
  if (status === STATUS_PUBLISHED) return "bg-surface-muted text-text-secondary";
  return "bg-surface-muted text-text-tertiary";
}

export function WechatApp() {
  const { t } = useTranslation("wechat");
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const settings = getCachedSettings();
  const defaultTheme = (settings?.wechat?.theme || "minimal-ink") as WechatThemeId;

  const [step, setStep] = useState<StepId>("packages");
  const [packages, setPackages] = useState<WechatPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [packageRoot, setPackageRoot] = useState(resolvePackageRoot);
  const [query, setQuery] = useState("");
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [toolScripts, setToolScripts] = useState(false);
  const [toolPython, setToolPython] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);
  const [phoneFrame, setPhoneFrame] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveResolve = useRef<((ok: boolean) => void) | null>(null);
  const leaveAction = useRef<(() => void) | null>(null);
  const [lastHtmlPath, setLastHtmlPath] = useState<string | null>(null);
  const [checklistText, setChecklistText] = useState<string>("");

  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const [current, setCurrent] = useState<WechatPackage | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);

  const [factChecks, setFactChecks] = useState<Record<string, boolean>>({});
  const checklist = useMemo(() => defaultFactChecklist(), []);
  const quality = useMemo(() => (draft ? analyzeWechatQuality(draft) : null), [draft]);

  const [themeId, setThemeId] = useState<WechatThemeId>(defaultTheme);
  const theme = useMemo(() => resolveWechatTheme(themeId), [themeId]);
  const [previewEmbedded, setPreviewEmbedded] = useState("");

  // 脏稿关闭守卫 — Esc / 遮罩不得直接丢稿
  useEffect(() => {
    if (!dirty) {
      setOverlayCloseGuard(null);
      return;
    }
    setOverlayCloseGuard(
      () =>
        new Promise<boolean>((resolve) => {
          leaveResolve.current = resolve;
          leaveAction.current = null;
          setLeaveOpen(true);
        }),
    );
    return () => setOverlayCloseGuard(null);
  }, [dirty, t]);

  // ⌘S 保存 · ←/→ 切步（输入框内不抢）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === "TEXTAREA" || tag === "INPUT" || (e.target as HTMLElement | null)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (current && dirty) void saveDraft();
        return;
      }
      if (typing) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const order: StepId[] = ["packages", "edit", "quality", "preview"];
        const i = order.indexOf(step);
        const j = e.key === "ArrowRight" ? i + 1 : i - 1;
        const next = order[j];
        if (next) {
          const disabled = (next === "edit" || next === "quality" || next === "preview") && !current;
          if (!disabled) setStep(next);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 步骤焦点
  useEffect(() => {
    if (step === "packages") titleRef.current?.focus();
    if (step === "edit") draftRef.current?.focus();
  }, [step]);

  const refreshPackages = useCallback(async () => {
    try {
      setPackageRoot(resolvePackageRoot());
      const r = await api.ws.listDir(packageRoot);
      const entries = (r.entries || []) as Array<{ name: string; kind?: string; mtime?: string }>;
      const dirs = entries.filter((e) => (e.kind || "dir") !== "file" || !/\.[a-z0-9]+$/i.test(e.name));
      const list: WechatPackage[] = [];
      for (const e of dirs) {
        const relPath = `${packageRoot}/${e.name}`;
        const draftPath = `${relPath}/公众号稿.md`;
        let hasDraft = false;
        let title = e.name;
        let status = "—";
        let wordCount = 0;
        try {
          const raw = await api.ws.read(draftPath);
          hasDraft = true;
          const fm = parseFm(raw);
          title = fm.title || e.name;
          status = fm.status || "草稿";
          wordCount = Number(fm.word_count || countChineseChars(stripWechatFrontmatter(raw).body));
        } catch {
          hasDraft = false;
        }
        list.push({
          relPath,
          name: e.name,
          draftPath,
          hasDraft,
          status,
          wordCount,
          mtime: String(e.mtime || ""),
          title,
        });
      }
      list.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
      setPackages(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [packageRoot]);

  useEffect(() => {
    void refreshPackages();
  }, [refreshPackages]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const probe = await api.wechat.probeScripts();
        if (!cancelled) {
          setToolScripts(!!probe.scripts);
          setToolPython(!!probe.python);
        }
      } catch {
        if (!cancelled) {
          setToolScripts(false);
          setToolPython(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return onLocal("workspace:file-changed", (payload) => {
      const rel =
        payload && typeof payload === "object" && "relativePath" in payload
          ? String((payload as { relativePath?: string }).relativePath || "")
          : "";
      if (!rel || rel.includes("公众号") || rel.startsWith(packageRoot)) void refreshPackages();
    });
  }, [packageRoot, refreshPackages]);

  // 预览：粘贴/导出同源 — 本地图 embed
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!draft || !current) {
        if (!cancelled) setPreviewEmbedded("");
        return;
      }
      const { md } = await embedLocalImagesWithChecklist(draft, current.relPath);
      if (!cancelled) setPreviewEmbedded(wechatCopyHtml(md, theme));
    })();
    return () => {
      cancelled = true;
    };
  }, [draft, current, theme]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return packages;
    return packages.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.status.includes(q),
    );
  }, [packages, query]);

  const openPackage = async (p: WechatPackage) => {
    if (!p.hasDraft) {
      setError(t("missingDraft", { name: p.name }));
      return;
    }
    if (dirty) {
      const ok = await new Promise<boolean>((resolve) => {
        leaveResolve.current = resolve;
        leaveAction.current = null;
        setLeaveOpen(true);
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const raw = await api.ws.read(p.draftPath);
      setCurrent(p);
      setDraft(raw);
      setDirty(false);
      setFactChecks({});
      setStep("edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createPackage = async () => {
    const title = newTitle.trim();
    const slug = (newSlug.trim() || title.trim()).replace(/\s+/g, "-");
    if (!title || !slug) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const folder = `${packageRoot}/${date}-${slug}`;
      const draftPath = `${folder}/公众号稿.md`;
      const content = buildSkeleton(title, slug);
      const r = await api.ws.save({ relativePath: draftPath, content });
      toastWriteback(t("saveDone"), r);
      setOkMsg(t("created", { path: draftPath }));
      setNewTitle("");
      setNewSlug("");
      await refreshPackages();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!current) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const body = stripWechatFrontmatter(draft).body;
      const wc = countChineseChars(body);
      let content = draft;
      if (/^word_count:\s*.*$/m.test(content)) {
        content = content.replace(/^word_count:\s*.*$/m, `word_count: ${wc}`);
      }
      const r = await api.ws.save({ relativePath: current.draftPath, content });
      setDraft(content);
      setDirty(false);
      toastWriteback(t("saveDone"), r);
      setOkMsg(t("saved", { path: current.draftPath }));
      await refreshPackages();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 质检问题 → 正文定位（复用 textarea selection，不引第二编辑器） */
  const jumpToLine = (line?: number) => {
    if (!line || line < 1) return;
    setStep("edit");
    requestAnimationFrame(() => {
      const el = draftRef.current;
      if (!el) return;
      const lines = draft.split("\n");
      let pos = 0;
      for (let i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i].length + 1;
      const end = pos + (lines[line - 1]?.length || 0);
      el.focus();
      el.setSelectionRange(pos, Math.max(pos, end));
    });
  };

  const insertSnippet = (snippet: string) => {
    const el = draftRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = draft.slice(0, start) + snippet + draft.slice(end);
    setDraft(next);
    setDirty(true);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const polishDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const { body } = stripWechatFrontmatter(draft);
      const res = await api.ai.complete({
        text: body,
        action: "polish",
        mode: "rewrite",
        instruction:
          "去 AI 味改写：删套话/黑话/段末加粗金句；保留全部数字、口径、来源与代码块原文；只改语感不动事实；目标 scan_ai_flavor ≥85。输出替换正文的 Markdown。",
        documentText: body.slice(0, 28000),
        requestId: `wechat-polish-${Date.now()}`,
      });
      const polished = String(res?.text || "").trim();
      if (!polished) {
        setError(t("polishFailed"));
        return;
      }
      const { frontmatter } = stripWechatFrontmatter(draft);
      const next = frontmatter ? `---\n${frontmatter}\n---\n\n${polished}\n` : polished;
      setDraft(next);
      setDirty(true);
      setOkMsg(t("polishApplied"));
      setStep("quality");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openExportedHtml = async () => {
    if (!lastHtmlPath) return;
    try {
      await api.ws.open(lastHtmlPath);
      setOkMsg(t("openedHtml", { path: lastHtmlPath }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(previewEmbedded || wechatCopyHtml(draft, theme));
      setOkMsg(t("copiedHtml"));
    } catch {
      setError(t("copyFailed"));
    }
  };

  const exportHtml = async () => {
    if (!current) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    setExportNote(null);
    try {
      const slug = current.name.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-released$/, "") || "article";
      // 优先 skill 脚本真源；不可用时回退内置约束子集
      try {
        const via = await api.wechat.exportViaScript({
          packageRel: current.relPath,
          draftRel: current.draftPath,
          slug,
          title: current.title,
          theme: themeId,
          embedImages: true,
        });
        if (via.ok) {
          const path = via.htmlRel || `${current.relPath}/${slug}-公众号版.html`;
          const list = via.listRel || `${current.relPath}/图片上传清单.md`;
          setOkMsg(t("exportedWithChecklist", { path, list }));
          setLastHtmlPath(path);
          try {
            setChecklistText(await api.ws.read(list));
          } catch {
            setChecklistText("");
          }
          const bits: string[] = [];
          if (via.complianceNote) bits.push(via.complianceNote);
          if (via.embedCount != null) bits.push(t("embedCount", { n: via.embedCount }));
          setExportNote(bits.length ? bits.join(" · ") : t("tools.skillReady"));
          if (via.compliance === "warn") setError(t("complianceWarn"));
          await refreshPackages();
          return;
        }
      } catch {
        // fall through to builtin
      }
      const { md: embedded, checklist: items } = await embedLocalImagesWithChecklist(draft, current.relPath);
      const html = wechatHtmlDocument(embedded, theme);
      const htmlPath = `${current.relPath}/${slug}-公众号版.html`;
      const r = await api.ws.save({ relativePath: htmlPath, content: html });
      toastWriteback(t("exportDone"), r);
      const listPath = `${current.relPath}/图片上传清单.md`;
      await api.ws.save({ relativePath: listPath, content: buildUploadChecklist(slug, items) });
      setOkMsg(t("exportedWithChecklist", { path: htmlPath, list: listPath }));
      await refreshPackages();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const finalizePackage = async () => {
    if (!current) return;
    setConfirmFinalize(false);
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      let content = draft;
      if (/^status:\s*.*$/m.test(content)) {
        content = content.replace(/^status:\s*.*$/m, `status: ${STATUS_FINAL}`);
      } else {
        content = content.replace(/^---\n/, `---\nstatus: ${STATUS_FINAL}\n`);
      }
      const saveEv = await api.ws.save({ relativePath: current.draftPath, content });
      toastWriteback(t("saveDone"), saveEv);
      setDraft(content);
      setDirty(false);

      let next = { ...current, status: STATUS_FINAL, name: current.name, relPath: current.relPath, draftPath: current.draftPath };
      if (!current.name.endsWith("-released")) {
        const newName = `${current.name}-released`;
        const ren = await api.ws.rename({ relativePath: current.relPath, newName });
        toastWriteback(t("saveDone"), ren);
        const parent = current.relPath.replace(/\/[^/]+$/, "");
        next = {
          ...current,
          status: STATUS_FINAL,
          name: newName,
          relPath: `${parent}/${newName}`,
          draftPath: `${parent}/${newName}/公众号稿.md`,
        };
      }
      setCurrent(next);
      setOkMsg(t("finalized", { path: next.draftPath }));
      await refreshPackages();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const aiOk = (quality?.aiScore ?? 0) >= WECHAT_AI_TARGET;
  const lintErrors = quality?.lintIssues.filter((i) => i.level === "error") || [];
  const lintWarns = quality?.lintIssues.filter((i) => i.level === "warn") || [];
  const factsOk = checklist.every((c) => factChecks[c.id]);
  const canFinalize = current?.status === STATUS_DRAFT;

  const steps: Array<{ id: StepId; label: string; disabled?: boolean; done?: boolean }> = [
    { id: "packages", label: t("steps.packages"), done: !!current },
    { id: "edit", label: t("steps.edit"), disabled: !current, done: !!current && !dirty },
    { id: "quality", label: t("steps.quality"), disabled: !current, done: !!current && aiOk && factsOk },
    { id: "preview", label: t("steps.preview"), disabled: !current },
  ];

  const fillBody = step === "edit" || step === "preview";

  return (
    <div className="v4-plugin-app-panel flex h-full min-h-0 flex-col" data-wechat-app>
      {/* Header — PluginAppHeader（全 APP 统一） */}
      <PluginAppHeader
        icon={<RiFileTextLine size={ICON.sm} className="text-accent-color" />}
        title={t("title")}
        subtitle={t("subtitle")}
        tools={
          <>
            <ConnectorToolChip label={t("tools.skillChip")} ok={toolScripts} />
            <ConnectorToolChip label={t("tools.pythonChip")} ok={toolPython} />
          </>
        }
        meta={current ? current.title : undefined}
        onClose={() => closeOverlay()}
        closeLabel={t("close")}
      />

      {/* Stepper */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle-dim bg-surface/40 px-4 py-1.5" data-wechat-steps>
        <AppModeTabs
          value={step}
          onChange={(id) => setStep(id)}
          items={steps.map((s2) => ({
            id: s2.id,
            label: s2.label,
            disabled: s2.disabled,
            done: s2.done,
          }))}
        />
        <span className="ml-auto max-w-[16rem] truncate text-3xs text-text-quaternary" data-wechat-package-path>
          {current ? t("draftPath", { path: current.draftPath }) : t("packageRoot", { path: packageRoot })}
        </span>
      </div>

      {/* Sticky status */}
      {error || okMsg || exportNote ? (
        <div className="shrink-0 px-4 pt-2">
          <ConnectorToastBanner
            result={
              error
                ? `✗ ${error}`
                : okMsg
                  ? `✓ ${okMsg}`
                  : exportNote
            }
          >
            {okMsg && exportNote ? <div className="opacity-80">{exportNote}</div> : null}
          </ConnectorToastBanner>
        </div>
      ) : null}

      {/* Body — step 感知布局 */}
      <div
        className={cn(
          "min-h-0 flex-1 px-4 pb-3",
          fillBody ? "flex flex-col overflow-hidden pt-2" : "overflow-auto overscroll-contain pt-3",
        )}
      >
        {step === "packages" ? (
          <div className="flex flex-col gap-3" data-wechat-packages>
            <AppSlot title={t("newPackage")} hint={t("newPackageHint")}>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createPackage();
                }}
              >
                <Input
                  ref={titleRef}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={t("newTitle")}
                  className="min-w-0 flex-1"
                  aria-label={t("newTitle")}
                />
                <Input
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder={t("newSlug")}
                  className="w-36"
                  aria-label={t("newSlug")}
                />
                <Button type="submit" size="sm" softDisabled={busy} disabled={!newTitle.trim()}>
                  <RiAddLine size={ICON.micro} aria-hidden />
                  {t("create")}
                </Button>
              </form>
            </AppSlot>

            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <RiSearchLine size={ICON.micro} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-quaternary" aria-hidden />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchPackages")}
                  className="pl-8"
                  aria-label={t("searchPackages")}
                />
              </div>
              <MetaText>{filtered.length}</MetaText>
            </div>

            {loading ? (
              <LoadingState label={t("loading")} />
            ) : filtered.length === 0 ? (
              <EmptyState
                compact
                icon={<RiFolderOpenLine size={ICON.sm} />}
                title={packages.length === 0 ? t("empty") : t("emptySearch")}
                hint={t("emptyHint", { path: packageRoot })}
                action={
                  <Button size="sm" variant="outline" onClick={() => titleRef.current?.focus()}>
                    {t("newPackage")}
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col gap-1" data-wechat-package-list>
                {filtered.map((p) => (
                  <li key={p.relPath}>
                    <button
                      type="button"
                      onClick={() => void openPackage(p)}
                      disabled={!p.hasDraft || busy}
                      className={cn(listRowClass(current?.relPath === p.relPath), "w-full min-w-0 items-start py-2.5")}
                      data-wechat-package-item={p.name}
                    >
                      <RiFolderOpenLine size={ICON.sm} className="mt-0.5 shrink-0 text-text-quaternary" aria-hidden />
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-3xs font-medium text-text-primary">
                          {p.title}
                          {!p.hasDraft ? (
                            <span className="ml-1.5 rounded bg-status-warning-bg px-1 text-3xs text-warning">{t("missingDraftPill")}</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-3xs text-text-quaternary">
                          <span className="truncate">{p.name}</span>
                          <span className={cn("rounded-full px-1.5 py-0.5", statusTone(p.status))}>{p.status}</span>
                          <span className="font-mono tabular-nums">{t("wordCountN", { n: p.wordCount })}</span>
                          {p.mtime ? <span>{p.mtime.slice(0, 10)}</span> : null}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : step === "edit" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2" data-wechat-edit data-layout="split">
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-[var(--radius-card)] border border-border-subtle-dim bg-surface-elevated px-2 py-1.5">
              <Button size="sm" softDisabled={busy || !dirty} onClick={() => void saveDraft()}>
                {t("save")}
                <span className="ml-1 font-mono text-3xs opacity-60">{formatChord("⌘S")}</span>
              </Button>
              {quality ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-3xs tabular-nums",
                    aiOk ? "bg-status-success-bg text-success" : "bg-status-warning-bg text-warning",
                  )}
                  title={t("aiScoreTitle")}
                >
                  {quality.aiScore}
                </span>
              ) : null}
              <Button size="sm" variant="ai" softDisabled={busy} onClick={() => void polishDraft()}>
                <RiSparklingLine size={ICON.micro} aria-hidden />
                {t("polish")}
              </Button>
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {(
                  [
                    { id: "stat", label: t("insert.stat"), snip: "\n\n::: stat\n12ms | 说明\n:::\n" },
                    { id: "pull", label: t("insert.pull"), snip: "\n\n::: pull\n核心一句\n:::\n" },
                    { id: "warn", label: t("insert.warn"), snip: "\n\n::: warn\n注意\n:::\n" },
                    { id: "note", label: t("insert.note"), snip: "\n\n::: note\n补充\n:::\n" },
                  ] as const
                ).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="rounded-full border border-border-subtle-dim px-2 py-0.5 text-3xs text-text-tertiary hover:bg-state-hover v4-focus-ring"
                    onClick={() => insertSnippet(b.snip)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-2" data-wechat-split>
            <textarea
              ref={draftRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
              }}
              className="min-h-[320px] w-full flex-1 resize-none rounded-[var(--radius-card)] border border-border-subtle-dim bg-surface px-4 py-3 font-mono text-2xs leading-[1.7] text-text-primary v4-focus-ring"
              spellCheck={false}
              aria-label={t("draftLabel")}
            />
            <aside
              className="hidden min-h-0 overflow-auto rounded-[var(--radius-card)] border border-border-subtle-dim px-4 py-3 lg:block"
              style={{ background: theme.paper, fontFamily: theme.fontFamily }}
              data-wechat-live-preview
            >
              <div
                className={phoneFrame ? "mx-auto max-w-[375px] rounded-[28px] border border-border-subtle-dim bg-surface-elevated px-3 py-5 text-[15px] leading-[1.75] shadow-[var(--shadow-float)]" : "mx-auto max-w-[42rem] text-[15px] leading-[1.75]"}
                style={{ color: theme.ink }}
                dangerouslySetInnerHTML={{ __html: previewEmbedded }}
              />
            </aside>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3 text-3xs text-text-quaternary">
              {quality ? (
                <>
                  <span>{t("wordCountN", { n: quality.charCount })}</span>
                  <span>{t("paraCount", { n: quality.paragraphCount })}</span>
                  <span>{t("boldRatio", { n: Math.round(quality.boldRatio * 100) })}</span>
                  {quality.charsPerImage != null ? (
                    <span>{t("charsPerImage", { n: quality.charsPerImage })}</span>
                  ) : null}
                </>
              ) : null}
              <span className="ml-auto">{t("editHint")}</span>
              <Button size="sm" variant="outline" softDisabled={!current} onClick={() => setStep("quality")}>
                {t("toQuality")}
              </Button>
            </div>
          </div>
        ) : step === "quality" ? (
          <div className="flex flex-col gap-3" data-wechat-quality>
            <div className="grid gap-3 sm:grid-cols-2">
              {/* 关 3 · 文字 */}
              <AppSlot title={t("gateText")} titleIcon={<RiSparklingLine size={ICON.sm} />}>
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={cn(
                      "ml-auto font-mono text-base font-semibold tabular-nums",
                      aiOk ? "text-success" : "text-warning",
                    )}
                    data-wechat-ai-score
                  >
                    {quality?.aiScore ?? "—"}
                  </span>
                  <span className="text-3xs text-text-quaternary">{t("aiScoreHint", { n: WECHAT_AI_TARGET })}</span>
                </div>
                {quality ? (
                  <div className="mb-1.5 text-3xs text-text-quaternary">
                    {t("structuralDeduction", { n: quality.structuralDeduction })}
                  </div>
                ) : null}
                {quality?.aiHits.length ? (
                  <ul className="flex max-h-40 flex-col gap-1 overflow-auto" data-wechat-ai-hits>
                    {quality.aiHits.slice(0, 12).map((h, i) => (
                      <li
                      key={`${h.code}-${i}`}
                      className="flex cursor-pointer items-start gap-1.5 text-3xs hover:bg-state-hover"
                      onClick={() => {
                        setStep("edit");
                        requestAnimationFrame(() => {
                          const el = draftRef.current;
                          if (!el) return;
                          el.focus();
                          el.setSelectionRange(h.index, h.index + (h.pattern?.length || 0));
                        });
                      }}
                      data-wechat-ai-jump
                    >
                        <span
                          className={cn(
                            "shrink-0 rounded px-1",
                            h.severity === "high"
                              ? "bg-error-container text-on-error-container"
                              : h.severity === "mid"
                                ? "bg-status-warning-bg text-warning"
                                : "bg-surface-muted text-text-tertiary",
                          )}
                        >
                          {t(h.nameKey, { defaultValue: h.name })}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-text-secondary">「{h.pattern}」</span>
                        <span className="shrink-0 font-mono text-text-quaternary">-{h.penalty}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-3xs text-text-quaternary">{t("aiClean")}</div>
                )}
              </AppSlot>

              {/* 排版 lint */}
              <AppSlot title={t("gateLayout")}>
                {lintErrors.length === 0 && lintWarns.length === 0 ? (
                  <div className="text-3xs text-text-quaternary" data-wechat-lint-clean>
                    {t("lintClean")}
                  </div>
                ) : (
                  <ul className="flex max-h-48 flex-col gap-1 overflow-auto" data-wechat-lint-list>
                    {[...lintErrors, ...lintWarns].map((issue, i) => (
                      <li
                      key={`${issue.rule}-${i}`}
                      className="flex cursor-pointer items-start gap-1.5 text-3xs hover:bg-state-hover"
                      onClick={() => jumpToLine(issue.line)}
                      data-wechat-lint-jump
                    >
                        <span
                          className={cn(
                            "shrink-0 rounded px-1",
                            issue.level === "error"
                              ? "bg-error-container text-on-error-container"
                              : "bg-status-warning-bg text-warning",
                          )}
                        >
                          {issue.level === "error" ? t("lintError") : t("lintWarn")}
                        </span>
                        <span className="min-w-0 flex-1 text-text-secondary">
                          {t(issue.messageKey, { ...issue.messageParams, defaultValue: issue.message })}
                          {issue.line ? ` (L${issue.line})` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </AppSlot>
            </div>

            {/* 事实 / 逻辑关 */}
            <div data-wechat-facts>
            <AppSlot
              title={t("gateFacts")}
              hint={t("factsHint")}
              actions={factsOk ? <RiCheckboxCircleLine size={ICON.micro} className="text-success" aria-hidden /> : undefined}
            >
              <ul className="flex flex-col gap-1.5">
                {checklist.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-start gap-2 text-3xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={!!factChecks[c.id]}
                        onChange={(e) => setFactChecks((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                        className="mt-0.5"
                      />
                      <span>{t(`facts.${c.id}`)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </AppSlot></div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-3xs text-text-quaternary">
                {t("exportGateHint")}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button size="sm" variant="ai" softDisabled={busy} onClick={() => void polishDraft()}>
                  <RiSparklingLine size={ICON.micro} aria-hidden />
                  {t("polish")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setStep("edit")}>
                  {t("toEdit")}
                </Button>
                <Button size="sm" onClick={() => setStep("preview")}>
                  {t("toPreview")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2" data-wechat-preview>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {WECHAT_THEME_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setThemeId(id)}
                  aria-pressed={themeId === id}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-3xs v4-focus-ring",
                    themeId === id
                      ? "border-transparent bg-accent-container font-medium text-on-accent-container"
                      : "border-border-subtle-dim text-text-secondary hover:bg-state-hover",
                  )}
                >
                  {t(`themes.${id}`)}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setPhoneFrame((v) => !v)} aria-pressed={phoneFrame}>
                  {t("phoneFrame")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowChecklist((v) => !v)}>
                  {t("checklist")}
                </Button>
                <Button size="sm" variant="ghost" softDisabled={busy || !lastHtmlPath} onClick={() => void openExportedHtml()}>
                  <RiFileTextLine size={ICON.micro} aria-hidden />
                  {t("openHtml")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void copyHtml()}>
                  <RiFileCopyLine size={ICON.micro} aria-hidden />
                  {t("copyHtml")}
                </Button>
                <Button size="sm" variant="outline" softDisabled={busy || !canFinalize} onClick={() => setConfirmFinalize(true)}>
                  {t("finalize")}
                </Button>
                <Button size="sm" softDisabled={busy} onClick={() => void exportHtml()}>
                  <RiDownloadLine size={ICON.micro} aria-hidden />
                  {t("exportHtml")}
                </Button>
              </div>
            </div>
            {showChecklist ? (
              <div className="max-h-40 shrink-0 overflow-auto rounded-[var(--radius-lg)] border border-border-subtle-dim bg-surface px-3 py-2" data-wechat-checklist>
                <div className="mb-1 text-3xs font-medium text-text-secondary">{t("checklistTitle")}</div>
                <pre className="whitespace-pre-wrap font-mono text-3xs leading-relaxed text-text-tertiary">{checklistText || t("checklistEmpty")}</pre>
              </div>
            ) : null}
            <div
              className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-lg)] border border-border-subtle-dim px-4 py-4"
              style={{ background: theme.paper, fontFamily: theme.fontFamily }}
              data-wechat-preview-pane
              data-phone-frame={phoneFrame ? "on" : undefined}
            >
              <div
                className={phoneFrame ? "mx-auto max-w-[375px] rounded-[28px] border border-border-subtle-dim bg-surface-elevated px-3 py-5 text-[15px] leading-[1.75] shadow-[var(--shadow-float)]" : "mx-auto max-w-[42rem] text-[15px] leading-[1.75]"}
                style={{ color: theme.ink }}
                dangerouslySetInnerHTML={{ __html: previewEmbedded }}
              />
            </div>
          </div>
        )}
      </div>

      <ConfirmLeaveDialog
        open={leaveOpen}
        title={t("dirtyCloseTitle")}
        description={t("dirtyCloseConfirm")}
        onConfirm={() => {
          const resolve = leaveResolve.current;
          const act = leaveAction.current;
          leaveResolve.current = null;
          leaveAction.current = null;
          setLeaveOpen(false);
          setDirty(false);
          resolve?.(true);
          act?.();
        }}
        onCancel={() => {
          const resolve = leaveResolve.current;
          leaveResolve.current = null;
          leaveAction.current = null;
          setLeaveOpen(false);
          resolve?.(false);
        }}
      />

      <ConfirmDialog
        open={confirmFinalize}
        title={t("finalizeConfirmTitle")}
        description={t("finalizeConfirmDesc")}
        confirmText={t("finalize")}
        onConfirm={() => void finalizePackage()}
        onCancel={() => setConfirmFinalize(false)}
      />
    </div>
  );
}

function parseFm(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw.startsWith("---\n")) return out;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return out;
  const fm = raw.slice(4, end);
  for (const line of fm.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
