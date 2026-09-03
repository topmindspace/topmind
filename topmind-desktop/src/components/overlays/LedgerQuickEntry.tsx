/**
 * LedgerQuickEntry — 记一下 × 记账 注入口.
 * Renders inside the Quick Capture sheet (overlay + float) only when the
 * ledger plugin is enabled. One chip → compact entry form; capture text that
 * looks like bookkeeping prefills the form via the kernel NL parser.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RiArrowDownSLine, RiArrowUpSLine, RiLoader4Line, RiWallet3Line } from "@remixicon/react";
import { api } from "../../services/api";
import { getCachedSettings, setCachedSettings } from "../../lib/settings-cache";
import { emitLocal, onLocal } from "../../plugins/host";
import { toastWriteback } from "../../lib/writeback-toast";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";
import { Input } from "../ui/Input";

/** Light client-side trigger check — mirrors lib/ledger-engine triggers. */
const LEDGER_TEXT_RE = /记账|记一笔|花了|存入|支出|收入|买了|消费|账户余额|账单/u;

export function looksLikeLedgerText(text: string): boolean {
  return LEDGER_TEXT_RE.test(text.trim());
}

interface LedgerBookLite {
  roleId: string;
  accountName: string;
}

export function LedgerQuickEntry({
  content,
  visible = true,
  forceOpen = false,
  onRequestClose,
  onSaved,
}: {
  content: string;
  /** Render gate — hosts may show the entry only on detected intent. */
  visible?: boolean;
  /** Controlled open from a host toggle. */
  forceOpen?: boolean;
  /** 收起 while forceOpen — host collapses its toggle. */
  onRequestClose?: () => void;
  /** After a successful append — hosts may clear the consumed draft text. */
  onSaved?: () => void;
}) {
  const { t } = useTranslation("ledger");
  const [settings, setSettings] = useState(() => getCachedSettings());
  useEffect(() => {
    const pull = () => {
      void api.sys.settings().then((s) => {
        setCachedSettings(s);
        setSettings(s);
      }).catch(() => {});
    };
    pull();
    return onLocal("plugins:settings-changed", pull);
  }, []);
  const enabled = settings?.ledger?.enabled !== false;
  const defaultRoleId = settings?.ledger?.defaultRoleId || "Personal";

  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [books, setBooks] = useState<LedgerBookLite[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [direction, setDirection] = useState<"支出" | "收入">("支出");
  const [amount, setAmount] = useState("");
  const [roleId, setRoleId] = useState(defaultRoleId);
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [donePath, setDonePath] = useState<string | null>(null);

  const looksLedger = LEDGER_TEXT_RE.test(content.trim());

  const loadBooks = useCallback(async () => {
    try {
      const res = await api.ledger.list();
      setBooks((res.books || []).map((b) => ({ roleId: b.roleId, accountName: b.accountName })));
      setCategories(res.categories || []);
    } catch {
      /* entry form still usable with the default book */
    }
  }, []);

  const toggle = useCallback(() => {
    setOpen((v) => {
      const next = !v;
      if (next) {
        setDonePath(null);
        setErr(null);
        if (!loaded) {
          setLoaded(true);
          void loadBooks();
        }
      }
      return next;
    });
  }, [loaded, loadBooks]);

  // NL handoff: capture text that reads like bookkeeping prefills the form.
  const prefill = useCallback(async () => {
    const text = content.trim();
    if (!text || !LEDGER_TEXT_RE.test(text)) return;
    try {
      const r = await api.ledger.capture(text, { persist: false, skipAi: true });
      if (r.intent === "capture") {
        if (r.direction) setDirection(r.direction);
        if (r.amount != null && r.amount > 0) setAmount(String(r.amount));
        if (r.category) setCategory(r.category);
        if (r.note) setNote(r.note);
        if (r.roleId) setRoleId(r.roleId);
      }
    } catch {
      /* prefill is best-effort */
    }
  }, [content]);

  const onToggleExpand = useCallback(() => {
    const wasOpen = open;
    toggle();
    if (!wasOpen) void prefill();
  }, [open, toggle, prefill]);

  const submit = useCallback(async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setErr(t("errorIncomplete"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.ledger.append(roleId, {
        direction,
        amount: n,
        category: category.trim(),
        note: note.trim(),
      });
      if (!r.ok) {
        setErr(r.reason || t("errorWrite"));
        return;
      }
      toastWriteback(t("quickDoneToast"), r.writebackEvidence ?? null);
      setDonePath(r.targetPath || null);
      setAmount("");
      setNote("");
      onSaved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [amount, roleId, direction, category, note, t, onSaved]);

  if (!enabled || (!visible && !forceOpen)) return null;

  return (
    <div className="mb-1.5">
      {!open ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleExpand}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-3xs font-medium transition-colors v4-focus-ring",
              looksLedger
                ? "bg-accent-bg-subtle text-accent-color shadow-[inset_0_0_0_1px_var(--color-accent-border-subtle)]"
                : "bg-surface-muted/50 text-text-tertiary hover:bg-surface-muted hover:text-text-secondary",
            )}
            aria-expanded={open}
          >
            <RiWallet3Line size={ICON.micro} aria-hidden />
            {looksLedger ? t("quickDetect") : t("quickEntry")}
            <RiArrowDownSLine size={ICON.nano} aria-hidden />
          </button>
          {looksLedger ? (
            <span className="text-3xs text-text-quaternary">{t("quickDetectHint")}</span>
          ) : null}
        </div>
      ) : (
        <div
          className="rounded-[var(--radius-md)] border border-border-subtle bg-surface-muted/40 px-2.5 py-2"
          role="group"
          aria-label={t("quickEntry")}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-3xs font-semibold tracking-tight text-text-secondary">
              <RiWallet3Line size={ICON.micro} className="text-accent-color" aria-hidden />
              {t("quickEntry")}
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                if (forceOpen) onRequestClose?.();
              }}
              className="text-text-quaternary transition-colors hover:text-text-secondary"
              aria-label={t("close")}
            >
              <RiArrowUpSLine size={ICON.nano} />
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="v4-segmented !gap-0 !p-0.5" role="radiogroup" aria-label={t("quickDirectionAria")}>
              {(["支出", "收入"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={direction === d}
                  data-active={direction === d}
                  onClick={() => setDirection(d)}
                  className="v4-segmented-item !px-2 !py-0.5 text-3xs"
                >
                  {t(d === "支出" ? "expense" : "income")}
                </button>
              ))}
            </div>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={amount}
              autoFocus
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                  if (forceOpen) onRequestClose?.();
                }
              }}
              placeholder={t("amount")}
              aria-label={t("amount")}
              className="h-7 w-24 text-sm"
            />
            {books.length > 1 ? (
              <select
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                aria-label={t("quickBook")}
                className="h-7 rounded-[var(--radius-md)] border border-border-subtle bg-input px-2 text-3xs text-text-primary outline-none"
              >
                {books.map((b) => (
                  <option key={b.roleId} value={b.roleId}>
                    {b.accountName}
                  </option>
                ))}
              </select>
            ) : null}
            {categories.length > 0 ? (
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label={t("category")}
                className="h-7 max-w-28 rounded-[var(--radius-md)] border border-border-subtle bg-input px-2 text-3xs text-text-primary outline-none"
              >
                <option value="">{t("quickNoCategory")}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : null}
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                  if (forceOpen) onRequestClose?.();
                }
              }}
              placeholder={t("note")}
              aria-label={t("note")}
              className="h-7 min-w-0 max-w-40 flex-1 text-3xs"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !amount.trim()}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-md)] bg-primary px-2.5 text-3xs font-medium text-primary-foreground shadow-[var(--shadow-button)] transition-[background-color,opacity] duration-[var(--duration-fast)] hover:bg-primary-hover active:bg-primary-active disabled:opacity-50"
            >
              {busy ? <RiLoader4Line size={ICON.micro} className="animate-spin" aria-hidden /> : null}
              {t("nlSubmit")}
            </button>
          </div>

          {err ? (
            <div className="mt-1 text-3xs text-error" role="alert">
              {err}
            </div>
          ) : null}
          {donePath ? (
            <div className="mt-1 flex items-center gap-2 text-3xs text-success" role="status">
              <span>{t("quickDone", { path: donePath })}</span>
              <button
                type="button"
                className="text-accent-color hover:underline"
                onClick={() => {
                  emitLocal("overlay:open", { kind: "plugin-app", pluginId: "topmind-ledger" });
                }}
              >
                {t("settings.openApp")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
