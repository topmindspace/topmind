/** Writing delivery. Keep the public plugin/command identity for compatibility. */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RiFileTextLine } from "@remixicon/react";
import type { OverlaySlot, PluginContext } from "../types";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { useAiStore } from "../../stores/ai-store";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { PluginAppHeader } from "../connector-ui";
import { getCachedSettings } from "../../lib/settings-cache";
import { prepareArticle, WRITING_ACTIONS, WRITING_THEMES, type ArticleDelivery, type WritingPlatform, type WritingTheme } from "../../generated/writing/article-renderer.mjs";

export function createWechatOverlaySlot(_ctx: PluginContext): OverlaySlot {
  return { kind: "overlay", id: "topmind-wechat.app", matches: kind => kind === "plugin-app:topmind-wechat", render: () => <WechatApp /> };
}
export function WechatApp() {
  const { t, i18n } = useTranslation("wechat");
  const selection = useViewStore(s => s.selection);
  const close = useViewStore(s => s.closeOverlay);
  const selected = selection.kind === "file" ? selection.path : "";
  const [sourcePath, setSourcePath] = useState(selected);
  const [platform, setPlatform] = useState<WritingPlatform>("wechat");
  const preferred = getCachedSettings()?.wechat?.theme || "minimal-ink";
  const [theme, setTheme] = useState<WritingTheme>(Object.prototype.hasOwnProperty.call(WRITING_THEMES, preferred) ? preferred as WritingTheme : "minimal-ink");
  const [result, setResult] = useState<ArticleDelivery | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const sourceRef = useRef("");
  const generation = useRef(0);
  useEffect(() => { if (selected) setSourcePath(selected); }, [selected]);
  useEffect(() => { generation.current++; setResult(null); setBusy(false); setMessage(""); setError(""); }, [sourcePath, platform, theme]);
  useEffect(() => () => { generation.current++; }, []);
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
  const runAction = (id: string) => {
    const action = WRITING_ACTIONS.find(item => item.id === id);
    if (!action) return;
    close(); useViewStore.getState().openAiWorkspace("chat");
    void useAiStore.getState().sendMessage(`${i18n.language.startsWith("zh") ? action.prompt : action.promptEn}${sourcePath ? `\n当前文件：${sourcePath}` : ""}`);
  };
  return <div className="v4-plugin-app-panel flex h-full min-h-0 flex-col" data-writing-app>
    <PluginAppHeader icon={<RiFileTextLine size={18} />} title={t("name")} subtitle={t("subtitle")} onClose={close} closeLabel={t("close")} />
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <section aria-label={t("delivery.actions")} className="flex flex-wrap gap-2">{WRITING_ACTIONS.map(action => <Button key={action.id} variant="secondary" size="sm" onClick={() => runAction(action.id)}>{i18n.language.startsWith("zh") ? action.zh : action.en}</Button>)}</section>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="min-w-0 text-xs text-text-secondary">{t("delivery.source")}<Input value={sourcePath} onChange={event => setSourcePath(event.target.value)} placeholder={t("delivery.sourceHint")} /></label>
        <label className="text-xs text-text-secondary">{t("delivery.format")}<select className="block h-9 rounded bg-surface-wash-15 px-2 text-sm" value={platform} onChange={event => setPlatform(event.target.value as WritingPlatform)}><option value="wechat">{t("delivery.wechat")}</option><option value="x">X Article</option><option value="text">{t("delivery.text")}</option></select></label>
        <label className="text-xs text-text-secondary">{t("settings.theme")}<select className="block h-9 rounded bg-surface-wash-15 px-2 text-sm" value={theme} onChange={event => setTheme(event.target.value as WritingTheme)}>{Object.keys(WRITING_THEMES).map(id => <option key={id} value={id}>{t(`themes.${id}`)}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !/\.md$/iu.test(sourcePath)} onClick={() => void generate()}>{busy ? t("delivery.working") : t("delivery.preview")}</Button><Button variant="secondary" disabled={busy || !result} onClick={() => void copy()}>{t("delivery.copy")}</Button><Button variant="secondary" disabled={busy || !result} onClick={() => void exportFile()}>{t("delivery.export")}</Button></div>
      {error ? <p role="alert" className="text-sm text-error">{error}</p> : null}
      {message ? <p role="status" className="break-all text-sm text-success">{message}</p> : null}
      {result?.diagnostics.length ? <p className="text-xs text-warning">{t("delivery.check", { count: result.diagnostics.length })} {Array.from(new Set(result.diagnostics.map(item => item.code))).map(code => t(`delivery.diagnostics.${code}`)).join(" · ")}</p> : null}
      {result?.images.length ? <details className="text-xs text-text-secondary"><summary>{t("delivery.images", { count: result.images.length })}</summary><pre className="whitespace-pre-wrap break-all">{result.checklist}</pre></details> : null}
      {result ? platform === "text" ? <pre className="whitespace-pre-wrap text-sm">{result.text}</pre> : <iframe title={t("delivery.preview")} sandbox="" srcDoc={result.html} className="min-h-[380px] w-full flex-1 rounded border border-border-subtle bg-surface" /> : <p className="text-sm text-text-secondary">{t("delivery.empty")}</p>}
      <p className="text-xs text-text-tertiary">{t("delivery.boundary")}</p>
    </div>
  </div>;
}
