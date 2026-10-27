/** Writing delivery. Keep the public plugin/command identity for compatibility. */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RiFileTextLine } from "@remixicon/react";
import type { OverlaySlot, PluginContext } from "../types";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { useAiStore } from "../../stores/ai-store";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { NoteSourcePicker } from "../../components/workspace/NoteSourcePicker";
import { activeDocumentPath } from "../../lib/active-document";
import { PluginAppHeader } from "../connector-ui";
import { getCachedSettings } from "../../lib/settings-cache";
import { prepareArticle, WRITING_ACTIONS, WRITING_THEMES, type ArticleDelivery, type WritingPlatform, type WritingTheme } from "../../generated/writing/article-renderer.mjs";

export function createWechatOverlaySlot(_ctx: PluginContext): OverlaySlot {
  return { kind: "overlay", id: "topmind-wechat.app", matches: kind => kind === "plugin-app:topmind-wechat", render: () => <WechatApp /> };
}
export function WechatApp() {
  const { t, i18n } = useTranslation("wechat");
  const activePath = useViewStore(s => activeDocumentPath(s));
  const close = useViewStore(s => s.closeOverlay);

  const entryPath = useViewStore(s => s.overlayContext?.sourcePath);
  const [sourcePath, setSourcePath] = useState(entryPath || activePath || "");
  const [actionId, setActionId] = useState("topmind-revise");
  const [requirements, setRequirements] = useState("");
  const [output, setOutput] = useState<"review" | "edit">("review");
  const [allowWeb, setAllowWeb] = useState(false);
  const streaming = useAiStore(s => s.streaming);
  const [platform, setPlatform] = useState<WritingPlatform>("wechat");
  const preferred = getCachedSettings()?.wechat?.theme || "minimal-ink";
  const [theme, setTheme] = useState<WritingTheme>(Object.prototype.hasOwnProperty.call(WRITING_THEMES, preferred) ? preferred as WritingTheme : "minimal-ink");
  const [result, setResult] = useState<ArticleDelivery | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceExcerpt, setSourceExcerpt] = useState("");
  const [sourceError, setSourceError] = useState("");
  const sourceRef = useRef("");
  const generation = useRef(0);
  useEffect(() => { generation.current++; setResult(null); setBusy(false); setMessage(""); setError(""); }, [sourcePath, platform, theme]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    let cancelled = false;
    setSourceExcerpt(""); setSourceError("");
    if (!sourcePath) return;
    setSourceLoading(true);
    void api.ws.read(sourcePath).then(text => {
      if (!cancelled) setSourceExcerpt(text.replace(/^---[\s\S]*?\n---\s*/u, "").replace(/[#>*`]/gu, "").trim().slice(0, 160));
    }).catch(e => { if (!cancelled) setSourceError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setSourceLoading(false); });
    return () => { cancelled = true; };
  }, [sourcePath]);
  const ensureSaved = () => {
    for (const node of document.querySelectorAll<HTMLElement>("[data-source-path][data-save-state]")) {
      if (node.dataset.sourcePath === sourcePath && node.dataset.saveState !== "clean") throw new Error(t("delivery.unsaved"));
    }
  };
  const generate = async () => {
    const run = ++generation.current;
    setBusy(true); setError(""); setMessage(""); setResult(null);
    try {
      ensureSaved();
      const markdown = await api.ws.read(sourcePath);
      const delivery = await prepareArticle({ sourcePath, markdown, platform, theme }, async relative => {
        const image = await api.ws.readBinary(relative);
        return `data:${image.contentType};base64,${image.base64}`;
      });
      if (generation.current === run) { sourceRef.current = markdown; setResult(delivery); }
    } catch (e) { if (generation.current === run) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (generation.current === run) setBusy(false); }
  };
  const withCurrent = async (operation: (delivery: ArticleDelivery) => Promise<void>) => {
    if (!result) return;
    const run = generation.current;
    setBusy(true); setError(""); setMessage("");
    try {
      ensureSaved();
      if (await api.ws.read(sourcePath) !== sourceRef.current) { setResult(null); throw new Error(t("delivery.stale")); }
      const fresh = await prepareArticle({ sourcePath, markdown: sourceRef.current, platform, theme }, async relative => {
        const image = await api.ws.readBinary(relative);
        return `data:${image.contentType};base64,${image.base64}`;
      });
      if (fresh.html !== result.html) { setResult(null); throw new Error(t("delivery.stale")); }
      if (run !== generation.current) return;
      await operation(result);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const copy = () => withCurrent(async delivery => {
    if (platform === "text") await navigator.clipboard.writeText(delivery.text);
    else await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([delivery.body], { type: "text/html" }), "text/plain": new Blob([delivery.text], { type: "text/plain" }) })]);
    setMessage(t("delivery.copied"));
  });
  const exportFile = () => withCurrent(async delivery => {
    const folder = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1) : "";
    const name = sourcePath.split("/").pop()!.replace(/\.md$/iu, "");
    const relativePath = `${folder}out/${name}-${platform}.${platform === "text" ? "txt" : "html"}`;
    const evidence = await api.ws.save({ relativePath, content: platform === "text" ? delivery.text : delivery.html });
    if (evidence.ok === false) throw new Error(t("delivery.failed"));
    if (delivery.images.length) await api.ws.save({ relativePath: `${folder}out/${name}-${platform}-images.md`, content: delivery.checklist });
    setMessage(t("delivery.exported", { path: relativePath }));
  });
  const runAction = async () => {
    const action = WRITING_ACTIONS.find(item => item.id === actionId);
    if (!action) return;
    setError(""); setBusy(true);
    try {
      ensureSaved();
      await api.ws.read(sourcePath);
      if (useAiStore.getState().streaming || useAiStore.getState().messagesLoading) throw new Error(t("delivery.agentBusy"));
      const zh = i18n.language.startsWith("zh");
      const prompt = actionId === "topmind-cover" ? (zh ? "按 topmind-cover，只准备封面提示词和构图方案，不生成图片。" : "Use topmind-cover to prepare a cover prompt only; do not generate images.")
        : actionId === "topmind-poster" ? (zh ? "按 topmind-poster，只提供 HTML 排版方案，不生成 PNG。" : "Use topmind-poster to provide HTML/layout only; do not generate PNG.")
        : zh ? action.prompt : action.promptEn;
      close(); useViewStore.getState().openAiWorkspace("chat");
      await useAiStore.getState().sendMessage(`${prompt}\n${zh ? "目标文章" : "Target article"}：${sourcePath}\n${output === "review" ? t("delivery.reviewOnly") : t("delivery.editSource")}\n${requirements}`, {
        focusPath: sourcePath, taskIntent: { targetPath: sourcePath, skillId: action.id, output, allowWeb },
      });
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const zh = i18n.language.startsWith("zh");
  const currentAction = WRITING_ACTIONS.find(action => action.id === actionId);
  const cannotStart = streaming || busy || sourceLoading || Boolean(sourceError) || !/\.md$/iu.test(sourcePath);
  const groups = [
    { key: "refine", ids: ["topmind-revise", "topmind-format"] },
    { key: "adapt", ids: ["topmind-briefs", "topmind-viral-posts", "topmind-wechat-post", "topmind-x-article"] },
    { key: "visual", ids: ["topmind-cover", "topmind-poster"] },
  ];
  return <div className="v4-plugin-app-panel flex h-full min-h-0 flex-col" data-writing-app>
    <PluginAppHeader icon={<RiFileTextLine size={18} />} title={t("name")} subtitle={t("subtitle")} onClose={close} closeLabel={t("close")} />
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <section aria-label={t("delivery.source")} className="m-4 mb-0 flex flex-col gap-2 rounded-[var(--radius-lg)] bg-surface-wash-15 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-2xs text-text-secondary">{sourcePath && sourcePath === activePath ? t("delivery.activeNote") : t("delivery.source")}</p>
            <h2 className="break-words text-base font-medium">{sourcePath.split("/").pop() || t("delivery.chooseSource")}</h2>
            {sourcePath ? <p className="mt-1 break-all text-2xs text-text-tertiary">{sourcePath}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2"><NoteSourcePicker value={sourcePath} onChange={setSourcePath} />
            {activePath && activePath !== sourcePath ? <Button variant="ghost" size="sm" onClick={() => setSourcePath(activePath)}>{t("delivery.useActiveNote")}</Button> : null}
          </div>
        </div>
        {sourceLoading ? <p role="status" className="text-xs text-text-secondary">{t("delivery.loadingSource")}</p> : sourceError ? <p role="alert" className="text-xs text-error">{sourceError}</p> : sourceExcerpt ? <p className="line-clamp-2 break-words text-xs leading-relaxed text-text-secondary">{sourceExcerpt}</p> : <p className="text-xs text-text-secondary">{t("delivery.empty")}</p>}
      </section>
      {error ? <p role="alert" className="mx-4 mt-3 text-sm text-error">{error}</p> : null}
      <Tabs defaultValue="write" className="flex min-h-0 flex-1 flex-col p-4">
        <TabsList aria-label={t("name")} className="w-full justify-start"><TabsTrigger value="write">{t("delivery.aiTask")}</TabsTrigger><TabsTrigger value="preview">{t("delivery.localDelivery")}</TabsTrigger></TabsList>
        <TabsContent value="write" className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-4">{groups.map(group => <section key={group.key}>
              <h3 className="mb-2 text-xs text-text-secondary">{t(`delivery.group.${group.key}`)}</h3>
              <div className="grid grid-cols-2 gap-2">{WRITING_ACTIONS.filter(action => group.ids.includes(action.id)).map(action => <Button key={action.id} variant={actionId === action.id ? "default" : "secondary"} size="sm" className="justify-start" aria-pressed={actionId === action.id} onClick={() => { setActionId(action.id); if (["topmind-cover", "topmind-poster"].includes(action.id)) setOutput("review"); }}>{zh ? action.zh : action.en}</Button>)}</div>
            </section>)}</div>
            <section aria-label={t("delivery.requirements")} className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-lg)] bg-surface-wash-15 p-4">
              <div><h3 className="text-sm font-medium">{currentAction ? zh ? currentAction.zh : currentAction.en : t("delivery.chooseAction")}</h3><p className="mt-1 text-xs leading-relaxed text-text-secondary">{t(`delivery.actionHelp.${actionId}`)}</p></div>
              <label className="text-xs text-text-secondary">{t("delivery.requirements")}<textarea className="v4-focus-ring mt-2 block min-h-24 w-full resize-y rounded-[var(--radius-md)] border border-border-subtle bg-surface p-3 text-sm text-text-primary" placeholder={t("delivery.requirementsHint")} value={requirements} onChange={e => setRequirements(e.target.value)} /></label>
              <label className="text-xs text-text-secondary">{t("delivery.resultMode")}<Select className="mt-2" value={output} onChange={e => setOutput(e.target.value as "review" | "edit")} options={[{ value: "review", label: t("delivery.reviewOnly") }, ...(!["topmind-cover", "topmind-poster"].includes(actionId) ? [{ value: "edit", label: t("delivery.editSource") }] : [])]} /></label>
              <label className="flex items-start gap-2 text-xs text-text-secondary"><input className="mt-0.5" type="checkbox" checked={allowWeb} onChange={e => setAllowWeb(e.target.checked)} /><span>{t("delivery.allowWeb")}</span></label>
              <p className="text-2xs leading-relaxed text-text-tertiary">{t("delivery.contextHint")}</p>
              <Button disabled={cannotStart} onClick={() => void runAction()}>{t("delivery.start")}</Button>
            </section>
          </div>
        </TabsContent>
        <TabsContent value="preview" className="mt-4 flex flex-col gap-4">
          <p className="text-xs text-text-secondary">{t("delivery.previewHint")}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[8rem] flex-1 text-xs text-text-secondary">{t("delivery.format")}<Select className="mt-2" value={platform} onChange={e => setPlatform(e.target.value as WritingPlatform)} options={[{value:"wechat",label:t("delivery.wechat")},{value:"x",label:"X Article"},{value:"text",label:t("delivery.text")}]} /></label>
            <label className="min-w-[8rem] flex-1 text-xs text-text-secondary">{t("settings.theme")}<Select className="mt-2" value={theme} onChange={e => setTheme(e.target.value as WritingTheme)} options={Object.keys(WRITING_THEMES).map(id => ({value:id,label:t(`themes.${id}`)}))} /></label>
            <Button disabled={busy || sourceLoading || Boolean(sourceError) || !sourcePath} onClick={() => void generate()}>{busy ? t("delivery.working") : t("delivery.preview")}</Button>
          </div>
          <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || !result} onClick={() => void copy()}>{t("delivery.copy")}</Button><Button variant="secondary" disabled={busy || !result} onClick={() => void exportFile()}>{t("delivery.export")}</Button></div>
          {message ? <p role="status" className="break-all text-sm text-success">{message}</p> : null}
          {result?.diagnostics.length ? <p className="text-xs text-warning">{t("delivery.check", { count: result.diagnostics.length })} {Array.from(new Set(result.diagnostics.map(item => item.code))).map(code => t(`delivery.diagnostics.${code}`)).join(" · ")}</p> : null}
          {result?.images.length ? <details className="text-xs text-text-secondary"><summary>{t("delivery.images", { count: result.images.length })}</summary><pre className="whitespace-pre-wrap break-all">{result.checklist}</pre></details> : null}
          {result ? platform === "text" ? <pre className="whitespace-pre-wrap text-sm">{result.text}</pre> : <iframe title={t("delivery.preview")} sandbox="" srcDoc={result.html} className="min-h-[420px] w-full rounded-[var(--radius-lg)] border border-border-subtle bg-white" /> : <div className="flex min-h-40 items-center justify-center rounded-[var(--radius-lg)] bg-surface-wash-15 p-6 text-center text-sm text-text-secondary">{t("delivery.previewEmpty")}</div>}
        </TabsContent>
      </Tabs>
    </div>
  </div>;
}
