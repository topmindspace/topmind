/**
 * 记账 mini-app — dedicated surface:
 * 看板 (totals) · 流水 · 分类管理 · 快捷记账 (form + NL).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, List, PencilLine, Plus, Tags, Wallet, X } from "lucide-react";
import type { OverlaySlot, PluginContext } from "../types";
import type { LedgerBook, LedgerEntry } from "../../types";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { onLocal } from "../host";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { ICON } from "../../lib/icons";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { cn } from "../../lib/cn";
import { toastWriteback } from "../../lib/writeback-toast";
import { getCachedSettings } from "../../lib/settings-cache";
import { summarizeLedgerBooks } from "../../lib/ledger-summary";

type TabId = "board" | "flow" | "categories" | "quick";

export function createLedgerOverlaySlot(_ctx: PluginContext): OverlaySlot {
  return {
    kind: "overlay",
    id: "topmind-ledger.app",
    matches: (kind) => kind === "plugin-app:topmind-ledger",
    render: () => <LedgerApp />,
  };
}

function formatYuan(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0.00";
  return v.toFixed(2);
}

export function LedgerApp() {
  const { t } = useTranslation("ledger");
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const settings = getCachedSettings();
  const defaultRoleId = settings?.ledger?.defaultRoleId || "Personal";

  const [tab, setTab] = useState<TabId>("board");
  const [books, setBooks] = useState<LedgerBook[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [roleId, setRoleId] = useState(defaultRoleId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [nl, setNl] = useState("");
  const [direction, setDirection] = useState<"收入" | "支出">("支出");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [flowCategory, setFlowCategory] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await api.ledger.list();
      setBooks(r.books || []);
      setCategories(r.categories || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return onLocal("workspace:file-changed", (payload) => {
      const rel =
        payload && typeof payload === "object" && "relativePath" in payload
          ? String((payload as { relativePath?: string }).relativePath || "")
          : "";
      if (!rel || /ledgers\//.test(rel)) void refresh();
    });
  }, [refresh]);

  const current = useMemo(
    () => books.find((b) => b.roleId === roleId) || books[0] || null,
    [books, roleId],
  );

  useEffect(() => {
    if (current && current.roleId !== roleId) setRoleId(current.roleId);
  }, [current, roleId]);

  const summary = useMemo(() => summarizeLedgerBooks(books), [books]);

  const submitManual = async () => {
    const n = Number(amount);
    if (!current || !Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const r = await api.ledger.append(current.roleId, {
        direction,
        amount: n,
        category: category.trim(),
        note: note.trim(),
      });
      if (!r.ok) {
        setError(r.reason || t("errorWrite"));
        return;
      }
      toastWriteback(t("quickDoneToast"), r.writebackEvidence ?? null);
      setOkMsg(t("quickDone", { path: r.targetPath || "" }));
      setAmount("");
      setNote("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitNl = async () => {
    const text = nl.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const r = await api.ledger.capture(text, {
        persist: true,
        defaultRoleId: current?.roleId || defaultRoleId,
      });
      if (r.intent === "list" || r.intent === "balance") {
        if (r.roleId) setRoleId(r.roleId);
        setNl("");
        setTab("flow");
        await refresh();
        return;
      }
      if (!r.ok || !r.complete) {
        setError(t("errorIncomplete"));
        if (r.direction) setDirection(r.direction);
        if (r.amount) setAmount(String(r.amount));
        if (r.note) setNote(r.note);
        if (r.category) setCategory(r.category);
        if (r.roleId) setRoleId(r.roleId);
        return;
      }
      if (r.roleId) setRoleId(r.roleId);
      toastWriteback(t("quickDoneToast"), r.writebackEvidence ?? null);
      setOkMsg(t("quickDone", { path: r.targetPath || "" }));
      setNl("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addRole = async () => {
    const name = newRole.trim();
    if (!name) return;
    setBusy(true);
    try {
      const r = await api.ledger.addRole({ name });
      if (r.ok && r.book?.roleId) {
        setNewRole("");
        await refresh();
        setRoleId(r.book.roleId);
      } else {
        setError(r.reason || t("errorWrite"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    setBusy(true);
    try {
      const r = await api.ledger.addCategory(name);
      if (r.ok) {
        setNewCategory("");
        setCategories(r.categories || []);
      } else {
        setError(r.reason || t("errorWrite"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeCategory = (name: string) => {
    setRemoveConfirm(name);
  };

  const confirmRemoveCategory = async (name: string) => {
    setBusy(true);
    try {
      const r = await api.ledger.removeCategory(name);
      if (r.ok) setCategories(r.categories || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const flowEntries = useMemo(() => {
    const src = current?.entries ? [...current.entries].reverse() : [];
    if (!flowCategory) return src;
    return src.filter((e) => e.category === flowCategory);
  }, [current, flowCategory]);

  const tabs: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "board", label: t("tabs.board"), icon: LayoutDashboard },
    { id: "flow", label: t("tabs.flow"), icon: List },
    { id: "categories", label: t("tabs.categories"), icon: Tags },
    { id: "quick", label: t("tabs.quick"), icon: PencilLine },
  ];

  return (
    <div className="v4-overlay-sheet flex max-h-[min(88vh,800px)] w-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="v4-icon-chip flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-accent-color">
            <Wallet size={ICON.md} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-text-primary">{t("title")}</h2>
            <BookPathLine relPath={current?.relPath} t={t} />
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={closeOverlay} aria-label={t("close")}>
          <X size={ICON.sm} />
        </Button>
      </div>

      <div className="flex gap-1 border-b border-border-subtle px-4 py-1.5">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-[var(--radius-md)] px-2.5 py-1.5 text-3xs font-medium v4-focus-ring",
                tab === item.id
                  ? "bg-accent-bg-subtle text-accent-color"
                  : "text-text-secondary hover:bg-surface-muted",
              )}
            >
              <Icon size={ICON.xs} />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {error ? <div className="text-3xs text-error">{error}</div> : null}
        {okMsg ? (
          <div className="text-3xs text-success" role="status" aria-live="polite">
            {okMsg}
          </div>
        ) : null}
        {loading ? <div className="text-3xs text-text-quaternary">{t("loading")}</div> : null}

        {tab === "board" ? (
          <BoardPanel summary={summary} onOpenBook={(id) => { setRoleId(id); setTab("flow"); }} t={t} />
        ) : null}

        {tab === "flow" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <BookChips
              books={books}
              currentId={current?.roleId}
              onSelect={setRoleId}
              newRole={newRole}
              setNewRole={setNewRole}
              onAdd={() => void addRole()}
              busy={busy}
              t={t}
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setFlowCategory("")}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-3xs",
                  !flowCategory ? "border-accent-border-subtle bg-accent-bg-subtle text-accent-color" : "border-border-subtle-dim text-text-secondary",
                )}
              >
                {t("allCategories")}
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFlowCategory(c)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-3xs",
                    flowCategory === c ? "border-accent-border-subtle bg-accent-bg-subtle text-accent-color" : "border-border-subtle-dim text-text-secondary",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <FlowList entries={flowEntries} t={t} />
          </div>
        ) : null}

        {tab === "categories" ? (
          <div className="flex flex-col gap-3">
            <p className="text-3xs text-text-tertiary">{t("categoriesHint")}</p>
            <div className="flex gap-2">
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={t("addCategoryPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addCategory();
                }}
              />
              <Button size="sm" onClick={() => void addCategory()} disabled={busy || !newCategory.trim()}>
                {t("addCategory")}
              </Button>
            </div>
            {categories.length === 0 ? (
              <div className="rounded-[var(--radius-lg)] border border-dashed border-border-subtle px-3 py-6 text-center text-3xs text-text-quaternary">
                {t("emptyCategories")}
              </div>
            ) : (
              <ul className="divide-y divide-border-subtle-dim rounded-[var(--radius-lg)] border border-border-subtle-dim">
                {categories.map((c) => {
                  const tot = summary.byCategory.find((x) => x.category === c);
                  return (
                    <li key={c} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div>
                        <div className="text-xs text-text-primary">{c}</div>
                        <div className="text-3xs text-text-quaternary">
                          {t("categoryMeta", { count: tot?.count ?? 0, expense: formatYuan(tot?.expense ?? 0) })}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => removeCategory(c)} disabled={busy}>
                        {t("removeCategory")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <ConfirmDialog
              open={removeConfirm !== null}
              title={t("removeCategoryConfirmTitle", { name: removeConfirm ?? "" })}
              description={t("removeCategoryConfirmBody")}
              destructive
              onCancel={() => setRemoveConfirm(null)}
              onConfirm={() => {
                const name = removeConfirm;
                setRemoveConfirm(null);
                if (name) void confirmRemoveCategory(name);
              }}
            />
          </div>
        ) : null}

        {tab === "quick" ? (
          <div className="flex flex-col gap-3">
            <BookChips
              books={books}
              currentId={current?.roleId}
              onSelect={setRoleId}
              newRole={newRole}
              setNewRole={setNewRole}
              onAdd={() => void addRole()}
              busy={busy}
              t={t}
            />
            <form
              className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-border-subtle-dim px-3 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitNl();
              }}
            >
              <label className="text-3xs font-medium text-text-secondary">{t("nlLabel")}</label>
              <div className="flex gap-2">
                <Input value={nl} onChange={(e) => setNl(e.target.value)} placeholder={t("nlPlaceholder")} disabled={busy} />
                <Button type="submit" size="sm" disabled={busy || !nl.trim()}>
                  {t("nlSubmit")}
                </Button>
              </div>
            </form>
            <form
              className="grid grid-cols-2 gap-2 rounded-[var(--radius-lg)] border border-border-subtle-dim px-3 py-3 sm:grid-cols-5"
              onSubmit={(e) => {
                e.preventDefault();
                void submitManual();
              }}
            >
              <div className="col-span-2 flex gap-1 sm:col-span-1">
                {(["支出", "收入"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={cn(
                      "flex-1 rounded-[var(--radius-md)] border px-2 py-1.5 text-3xs v4-focus-ring",
                      direction === d
                        ? d === "支出"
                          ? "border-status-error/30 bg-status-error-bg text-status-error"
                          : "border-status-success/30 bg-status-success-bg text-success"
                        : "border-border-subtle-dim text-text-secondary",
                    )}
                  >
                    {d === "支出" ? t("expense") : t("income")}
                  </button>
                ))}
              </div>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("amount")} />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-[var(--control-h-md,34px)] rounded-[var(--radius-md)] border border-border-subtle-dim bg-input px-2 text-sm text-text-primary"
              >
                <option value="">{t("category")}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("note")} />
              <Button type="submit" size="sm" disabled={busy || !amount}>
                {t("add")}
              </Button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BookChips({
  books,
  currentId,
  onSelect,
  newRole,
  setNewRole,
  onAdd,
  busy,
  t,
}: {
  books: LedgerBook[];
  currentId?: string;
  onSelect: (id: string) => void;
  newRole: string;
  setNewRole: (v: string) => void;
  onAdd: () => void;
  busy: boolean;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const current = books.find((b) => b.roleId === currentId);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {books.map((b) => (
        <button
          key={b.roleId}
          type="button"
          onClick={() => onSelect(b.roleId)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-3xs transition-colors v4-focus-ring",
            b.roleId === currentId
              ? "border-accent-border-subtle bg-accent-bg-subtle text-accent-color"
              : "border-border-subtle-dim text-text-secondary hover:bg-surface-muted",
          )}
        >
          {b.accountName || b.roleId}
        </button>
      ))}
      <div className="flex items-center gap-1">
        <Input
          value={newRole}
          onChange={(e) => setNewRole(e.target.value)}
          placeholder={t("addRolePlaceholder")}
          className="h-7 w-28 px-2 text-3xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
        />
        <Button variant="ghost" size="sm" onClick={onAdd} disabled={busy || !newRole.trim()}>
          <Plus size={ICON.xs} />
        </Button>
      </div>
      <div className="basis-full min-w-0">
        <BookPathLine relPath={current?.relPath} t={t} />
      </div>
    </div>
  );
}

function BookPathLine({
  relPath,
  t,
}: {
  relPath?: string | null;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <p
      className="min-w-0 truncate font-mono text-3xs text-text-quaternary"
      data-ledger-book-path
      title={relPath || undefined}
    >
      {relPath ? t("bookPath", { path: relPath }) : t("bookPathHint")}
    </p>
  );
}

function BoardPanel({
  summary,
  onOpenBook,
  t,
}: {
  summary: ReturnType<typeof summarizeLedgerBooks>;
  onOpenBook: (id: string) => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <StatCard label={t("balance")} value={formatYuan(summary.balance)} />
        <StatCard label={t("income")} value={formatYuan(summary.income)} tone="in" />
        <StatCard label={t("expense")} value={formatYuan(summary.expense)} tone="out" />
      </div>
      <div>
        <div className="mb-1.5 text-3xs font-medium text-text-secondary">{t("byBook")}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {summary.byBook.map((b) => (
            <button
              key={b.roleId}
              type="button"
              onClick={() => onOpenBook(b.roleId)}
              className="rounded-[var(--radius-lg)] border border-border-subtle-dim px-3 py-2 text-left hover:bg-surface-muted/60 v4-focus-ring"
            >
              <div className="text-xs font-medium text-text-primary">{b.accountName || b.roleId}</div>
              <div className="mt-0.5 font-mono text-sm tabular-nums">{formatYuan(b.balance)}</div>
              {b.relPath ? (
                <div className="mt-0.5 truncate font-mono text-3xs text-text-quaternary" title={b.relPath}>
                  {b.relPath}
                </div>
              ) : null}
              <div className="mt-0.5 text-3xs text-text-quaternary">
                {t("income")} {formatYuan(b.income)} · {t("expense")} {formatYuan(b.expense)}
              </div>
            </button>
          ))}
        </div>
      </div>
      {summary.byCategory.length > 0 ? (
        <div>
          <div className="mb-1.5 text-3xs font-medium text-text-secondary">{t("byCategory")}</div>
          <ul className="divide-y divide-border-subtle-dim rounded-[var(--radius-lg)] border border-border-subtle-dim">
            {summary.byCategory.map((c) => (
              <li key={c.category || "_"} className="flex items-center justify-between px-3 py-2 text-xs">
                <span>{c.category || t("uncategorized")}</span>
                <span className="font-mono tabular-nums text-text-secondary">
                  +{formatYuan(c.income)} / −{formatYuan(c.expense)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "in" | "out" }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border-subtle-dim bg-surface-muted/40 px-3 py-2">
      <div className="text-3xs text-text-tertiary">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-mono text-lg font-semibold tabular-nums",
          tone === "in" && "text-success",
          tone === "out" && "text-status-error",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function FlowList({ entries, t }: { entries: LedgerEntry[]; t: (k: string) => string }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-border-subtle px-3 py-6 text-center text-3xs text-text-quaternary">
        {t("empty")}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border-subtle-dim rounded-[var(--radius-lg)] border border-border-subtle-dim">
      {entries.map((e, i) => (
        <li key={`${e.timestamp}-${i}`} className="flex items-start justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <div className="text-3xs tabular-nums text-text-quaternary">{e.timestamp}</div>
            <div className="truncate text-xs text-text-primary">
              {[e.category, e.note].filter(Boolean).join(" · ") || t("untitled")}
            </div>
          </div>
          <div
            className={cn(
              "shrink-0 font-mono text-xs tabular-nums",
              e.direction === "支出" ? "text-status-error" : "text-success",
            )}
          >
            {e.direction === "支出" ? "−" : "+"}
            {formatYuan(e.amount)}
          </div>
        </li>
      ))}
    </ul>
  );
}
