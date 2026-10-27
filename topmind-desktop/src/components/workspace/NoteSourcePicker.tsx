import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RiArrowDownSLine, RiFileTextLine, RiLoader4Line } from "@remixicon/react";
import { api } from "../../services/api";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { DropdownMenu, DropdownItem } from "../ui/DropdownMenu";

/** User-driven note lookup; no agent call and no automatic article-body scan. */
export function NoteSourcePicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const { t } = useTranslation("wechat");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError("");
    const timer = setTimeout(() => {
      const load = query.trim() ? api.ws.search(query.trim()).then(r => r.results.map(n => n.relativePath)) : api.ws.allNotes(100).then(r => r.notes.map(n => n.path));
      void load.then(items => { if (!cancelled) setPaths([...new Set(items)].filter(p => /\.md$/iu.test(p)).slice(0, 100)); })
        .catch(e => { if (!cancelled) { setPaths([]); setError(e instanceof Error ? e.message : String(e)); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, query ? 200 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query]);
  return <DropdownMenu open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery(""); }} autoFocus={false} minWidth={260} maxWidth={460} maxHeight={360} matchTriggerWidth={false}
    trigger={<Button ref={trigger} variant="secondary" size="sm" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>{t("delivery.changeSource")}<RiArrowDownSLine size={14} /></Button>}>
    <div onKeyDownCapture={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery(""); trigger.current?.focus(); } }}>
    <div className="p-2"><Input autoFocus aria-label={t("delivery.searchNotes")} placeholder={t("delivery.searchNotes")} value={query} onChange={e => setQuery(e.target.value)} /></div>
    {loading ? <p role="status" className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary"><RiLoader4Line size={14} className="animate-spin" />{t("delivery.loadingSource")}</p> : null}
    {error ? <p role="alert" className="px-3 py-2 text-xs text-error">{error}</p> : null}
    {!loading && !error && !paths.length ? <p className="px-3 py-2 text-xs text-text-secondary">{t("delivery.noNotes")}</p> : null}
    {paths.map(path => <DropdownItem key={path} disabled={loading} active={value === path} onSelect={() => { onChange(path); setOpen(false); setQuery(""); trigger.current?.focus(); }} icon={<RiFileTextLine size={16} />}>
      <span className="flex min-w-0 flex-col"><span className="truncate">{path.split("/").pop()}</span><span className="truncate text-2xs text-text-tertiary">{path}</span></span>
    </DropdownItem>)}
    {!query && !loading ? <p className="px-3 py-2 text-2xs text-text-tertiary">{t("delivery.recentNotesHint")}</p> : null}
    </div>
  </DropdownMenu>;
}
