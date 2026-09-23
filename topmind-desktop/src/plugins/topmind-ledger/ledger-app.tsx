/**
 * 记账 mini-app — one-stop surface (DS 4.2).
 * Opens on OverlayHost light scrim so the workbench stays visible behind.
 * Header (books + balance) · always-on AI|form entry · recent flow · deep tabs.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiAddLine,
  RiCloseLine,
  RiDashboardLine,
  RiListUnordered,
  RiPencilLine,
  RiPriceTag3Line,
  RiSparklingLine,
  RiWallet3Line,
} from "@remixicon/react";
import type { OverlaySlot, PluginContext } from "../types";
import type { LedgerBook } from "../../types";
import { api } from "../../services/api";
import { useViewStore } from "../../stores/view-store";
import { onLocal } from "../host";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { ICON } from "../../lib/icons";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { LoadingState } from "../../components/ui/view";
import { AppModeTabs, AppSlot, ChipToggleGroup, ConnectorToastBanner, PluginAppHeader, StatSlot } from "../connector-ui";
import { cn } from "../../lib/kit";
import { toastWriteback } from "../../lib/writeback-toast";
import { getCachedSettings } from "../../lib/settings-cache";
import { summarizeLedgerBooks } from "../../lib/ledger-summary";

type TabId = "board" | "flow" | "categories";

const DIR_OUT = "支出";
const DIR_IN = "收入";
type LedgerDir = typeof DIR_OUT | typeof DIR_IN;
type EntryMode = "ai" | "form";

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
  const [mode, setMode] = useState<EntryMode>("ai");
  const [books, setBooks] = useState<LedgerBook[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [roleId, setRoleId] = useState(defaultRoleId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [nl, setNl] = useState("");
  const [direction, setDirection] = useState<LedgerDir>(DIR_OUT);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [flowCategory, setFlowCategory] = useState("");
  const [nlPreview, setNlPreview] = useState<string | null>(null);

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
  const currentSummary = useMemo(
    () => summary.byBook.find((b) => b.roleId === current?.roleId) || null,
    [summary, current],
  );
  const recentEntries = useMemo(() => {
    const all = current?.entries || [];
    return all.slice(-8).reverse();
  }, [current]);

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
    setNlPreview(null);
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
        const preview = [
          r.direction ? (r.direction === DIR_IN ? t("income") : t("expense")) : null,
          r.amount != null ? `${t("amount")} ${r.amount}` : null,
          r.category ? `${t("category")} ${r.category}` : null,
          r.note || null,
          r.roleId ? `${t("quickBook")} ${r.roleId}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        setNlPreview(preview || t("errorIncomplete"));
        setError(t("errorIncomplete"));
        setMode("form");
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
      if (!r.ok) setError(r.reason || t("errorWrite"));
      else setNewCategory("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeCategory = async (name: string) => {
    setBusy(true);
    try {
      await api.ledger.removeCategory(name);
      if (category === name) setCategory("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setRemoveConfirm(null);
    }
  };

  const bookBalance = currentSummary
    ? Number(currentSummary.balance ?? 0)
    : Number(current?.balance ?? 0);

  if (loading) {
    return (
      <div className="v4-plugin-app-panel flex h-full min-h-0 flex-col" data-ledger-app>
        <PluginAppHeader
          icon={<RiWallet3Line size={ICON.sm} className="text-accent-color" />}
          title={t("title")}
          subtitle={t("subtitle")}
          onClose={() => closeOverlay()}
          closeLabel={t("close")}
        />
        <LoadingState label={t("loading", { defaultValue: "加载账本…" })} />
      </div>
    );
  }

  return (
    <div
      className="v4-plugin-app-panel flex h-full min-h-0 flex-col"
      data-ledger-app
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle-dim px-4 py-2.5">
        <span className="v4-icon-chip-accent flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)]">
          <RiWallet3Line size={ICON.sm} className="text-accent-color" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight text-text-primary">{t("title")}</div>
          <div className="truncate text-3xs text-text-quaternary">{t("subtitle")}</div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => closeOverlay()} aria-label={t("close")}>
          <RiCloseLine size={ICON.xs} />
        </Button>
      </div>

      <div className="shrink-0 border-b border-border-subtle-dim bg-surface/40 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
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
          <div className="ml-auto">
            <StatSlot label={t("balance")} value={formatYuan(bookBalance)} unit={t("yuan")} tone="accent" />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-border-subtle-dim px-4 py-3" data-ledger-quick>
        <div className="mb-2 flex items-center gap-1">
          {(
            [
              { id: "ai" as const, icon: RiSparklingLine, label: t("nlLabel") },
              { id: "form" as const, icon: RiPencilLine, label: t("formLabel") },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-3xs font-medium transition-colors v4-focus-ring",
                mode === m.id
                  ? "bg-accent-container text-on-accent-container"
                  : "text-text-tertiary hover:bg-state-hover hover:text-text-secondary",
              )}
            >
              <m.icon size={ICON.micro} aria-hidden />
              {m.label}
            </button>
          ))}
        </div>

        {mode === "ai" ? (
          <AppSlot title={t("nlLabel")} hint={t("nlHint")}>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitNl();
            }}
          >
              <Input value={nl} onChange={(e) => setNl(e.target.value)} placeholder={t("nlPlaceholder")} disabled={busy} aria-label={t("nlLabel")} className="min-w-0 flex-1" />
              <Button type="submit" size="sm" softDisabled={busy} disabled={!nl.trim()}>
                <RiSparklingLine size={ICON.micro} aria-hidden />
                {t("nlSubmit")}
              </Button>
          </form>
          </AppSlot>
        ) : (
          <AppSlot title={t("formLabel")}>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitManual();
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1">
                {([DIR_OUT, DIR_IN] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    aria-pressed={direction === d}
                    className={cn(
                      "rounded-[var(--radius-md)] border px-2.5 py-1.5 text-3xs v4-focus-ring",
                      direction === d
                        ? d === DIR_OUT
                          ? "border-transparent bg-error-container text-on-error-container font-medium"
                          : "border-transparent bg-success-container text-on-success-container font-medium"
                        : "border-border-subtle-dim text-text-secondary hover:bg-state-hover",
                    )}
                  >
                    {d === DIR_OUT ? t("expense") : t("income")}
                  </button>
                ))}
              </div>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("amount")} className="w-28" aria-label={t("amount")} />
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("note")} className="min-w-0 flex-1" aria-label={t("note")} />
              <Button type="submit" size="sm" softDisabled={busy} disabled={!amount}>
                {t("add")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-3xs text-text-quaternary">{t("category")}</span>
              <ChipToggleGroup
                value={category}
                onChange={setCategory}
                items={[{ id: "", label: t("quickNoCategory") }, ...categories.map((c) => ({ id: c, label: c }))]}
              />
            </div>
          </form>
          </AppSlot>
        )}

        {nlPreview ? (
          <div className="mt-2 flex items-start gap-1.5 rounded-[var(--radius-md)] border border-warning/25 bg-status-warning-bg px-2.5 py-1.5 text-3xs text-warning" role="status">
            <RiSparklingLine size={ICON.micro} className="mt-0.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              {t("nlPreviewLabel")}: {nlPreview}
            </span>
          </div>
        ) : null}
        {okMsg ? (
          <div className="mt-2 text-3xs text-success" role="status">
            {okMsg}
          </div>
        ) : null}
        {error ? (
          <div className="mt-2 text-3xs text-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <div className="border-b border-border-subtle-dim px-4 py-1.5">
        <AppModeTabs
          value={tab}
          onChange={setTab}
          items={[
            { id: "board", icon: <RiDashboardLine size={ICON.micro} aria-hidden />, label: t("tabs.board") },
            { id: "flow", icon: <RiListUnordered size={ICON.micro} aria-hidden />, label: t("tabs.flow") },
            { id: "categories", icon: <RiPriceTag3Line size={ICON.micro} aria-hidden />, label: t("tabs.categories") },
          ]}
        />
        <span className="ml-auto truncate text-3xs text-text-quaternary" data-ledger-book-path>
          {current ? t("bookPath", { path: current.relPath || current.roleId }) : t("loading")}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-4 py-3">
        {loading ? (
          <div className="py-8 text-center text-3xs text-text-quaternary">{t("loading")}</div>
        ) : tab === "board" ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              <StatCard label={t("income")} value={formatYuan(Number(currentSummary?.income ?? 0))} tone="success" />
              <StatCard label={t("expense")} value={formatYuan(Number(currentSummary?.expense ?? 0))} tone="error" />
              <StatCard label={t("balance")} value={formatYuan(bookBalance)} tone="accent" />
            </div>
            <div className="rounded-[var(--radius-lg)] border border-border-subtle-dim bg-surface">
              <div className="flex items-center justify-between border-b border-border-subtle-dim px-3 py-1.5">
                <span className="text-3xs font-medium text-text-secondary">{t("recentTitle")}</span>
                <button type="button" className="text-3xs text-accent-color hover:underline v4-focus-ring" onClick={() => setTab("flow")}>
                  {t("seeAllFlow")}
                </button>
              </div>
              {recentEntries.length === 0 ? (
                <div className="px-3 py-6 text-center text-3xs text-text-quaternary">{t("empty")}</div>
              ) : (
                <ul className="divide-y divide-border-subtle-dim">
                  {recentEntries.map((e, i) => (
                    <EntryRow key={`${e.timestamp}-${i}`} entry={e} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : tab === "flow" ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-3xs text-text-quaternary">{t("allCategories")}</span>
              <button
                type="button"
                onClick={() => setFlowCategory("")}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-3xs v4-focus-ring",
                  !flowCategory
                    ? "border-accent-border-subtle bg-accent-bg-subtle text-accent-color"
                    : "border-border-subtle-dim text-text-tertiary",
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
                    "rounded-full border px-2 py-0.5 text-3xs v4-focus-ring",
                    flowCategory === c
                      ? "border-accent-border-subtle bg-accent-bg-subtle text-accent-color"
                      : "border-border-subtle-dim text-text-tertiary",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            {(current?.entries || [])
              .slice()
              .reverse()
              .filter((e) => !flowCategory || e.category === flowCategory)
              .map((e, i) => (
                <div key={`flow-${e.timestamp}-${i}`} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface px-2.5 py-1.5 text-3xs">
                  <span className="w-28 shrink-0 text-text-quaternary">{e.timestamp}</span>
                  <span className={cn("w-10 shrink-0 font-medium", e.direction === DIR_IN ? "text-success" : "text-error")}>
                    {e.direction === DIR_IN ? t("income") : t("expense")}
                  </span>
                  <span className="w-20 shrink-0 font-mono tabular-nums text-text-primary">{formatYuan(e.amount)}</span>
                  <span className="min-w-0 flex-1 truncate text-text-secondary">
                    {e.category || t("uncategorized")} · {e.note || t("untitled")}
                  </span>
                </div>
              ))}
            {(current?.entries || []).length === 0 ? (
              <div className="py-8 text-center text-3xs text-text-quaternary">{t("empty")}</div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-3xs text-text-quaternary">{t("categoriesHint")}</p>
            <div className="flex gap-2">
              <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder={t("addCategoryPlaceholder")} className="h-8" />
              <Button size="sm" softDisabled={busy} disabled={!newCategory.trim()} onClick={() => void addCategory()}>
                {t("addCategory")}
              </Button>
            </div>
            {categories.length === 0 ? (
              <div className="py-6 text-center text-3xs text-text-quaternary">{t("emptyCategories")}</div>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <li key={c} className="inline-flex items-center gap-1 rounded-full border border-border-subtle-dim bg-surface px-2.5 py-1 text-3xs text-text-secondary">
                    {c}
                    <button type="button" className="text-text-quaternary hover:text-error v4-focus-ring" onClick={() => setRemoveConfirm(c)} aria-label={t("removeCategory")}>
                      <RiCloseLine size={ICON.nano} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!removeConfirm}
        title={t("removeCategoryConfirmTitle", { name: removeConfirm || "" })}
        description={t("removeCategoryConfirmBody")}
        destructive
        onConfirm={() => {
          if (removeConfirm) void removeCategory(removeConfirm);
        }}
        onCancel={() => setRemoveConfirm(null)}
      />
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "success" | "error" | "accent" }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border-subtle-dim bg-surface px-3 py-2">
      <div className="text-3xs text-text-quaternary">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-mono text-base font-semibold tabular-nums",
          tone === "success" && "text-on-success-container",
          tone === "error" && "text-on-error-container",
          tone === "accent" && "text-on-accent-container",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
}: {
  entry: { timestamp: string; direction: string; amount: number; category?: string; note?: string };
}) {
  const { t } = useTranslation("ledger");
  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-3xs">
      <span className="w-28 shrink-0 truncate text-text-quaternary">{entry.timestamp}</span>
      <span className={cn("w-6 shrink-0 font-medium", entry.direction === DIR_IN ? "text-success" : "text-error")}>
        {entry.direction === DIR_IN ? "＋" : "－"}
      </span>
      <span className="w-16 shrink-0 font-mono tabular-nums text-text-primary">{formatYuan(entry.amount)}</span>
      <span className="min-w-0 flex-1 truncate text-text-secondary">
        {entry.category || t("uncategorized")} · {entry.note || t("untitled")}
      </span>
    </li>
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
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {books.map((b) => (
        <button
          key={b.roleId}
          type="button"
          onClick={() => onSelect(b.roleId)}
          aria-pressed={b.roleId === currentId}
          className={cn(
            "rounded-full border px-2.5 py-1 text-3xs transition-colors v4-focus-ring",
            b.roleId === currentId
              ? "border-transparent bg-accent-container font-medium text-on-accent-container"
              : "border-border-subtle-dim text-text-secondary hover:bg-state-hover",
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
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" softDisabled={busy} disabled={!newRole.trim()} onClick={onAdd} aria-label={t("addRolePlaceholder")}>
          <RiAddLine size={ICON.micro} />
        </Button>
      </div>
    </div>
  );
}
