/**
 * Help overlay — product onboarding, workflow, philosophy, and FAQ.
 * Entry: workspace switcher menu「帮助」
 * Layout mirrors Settings: left nav rail · header · scrollable content with measure.
 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiBookOpenLine,
  RiCloseLine,
  RiFlowChart,
  RiLightbulbLine,
  RiQuestionLine,
  RiRocketLine,
  RiSettingsLine,
  RiSparklingLine,
  RiStethoscopeLine,
} from "@remixicon/react";
import { useViewStore } from "../../stores/view-store";
import { emitLocal } from "../../plugins/host";
import { Button } from "../ui/Button";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/kit";
import { formatChord } from "../../lib/chord";

type TabId = "start" | "features" | "workflow" | "philosophy" | "faq";

const TABS: { id: TabId; icon: typeof RiRocketLine; fallbackLabel: string }[] = [
  { id: "start", icon: RiRocketLine, fallbackLabel: "快速开始" },
  { id: "features", icon: RiBookOpenLine, fallbackLabel: "主要功能" },
  { id: "workflow", icon: RiFlowChart, fallbackLabel: "工作流" },
  { id: "philosophy", icon: RiLightbulbLine, fallbackLabel: "设计理念" },
  { id: "faq", icon: RiQuestionLine, fallbackLabel: "常见问题" },
];

/** i18n `returnObjects` may yield a string when the key is missing — never crash the panel. */
function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function HelpPanel() {
  const { t } = useTranslation("shell");
  const closeOverlay = useViewStore((s) => s.closeOverlay);
  const titleId = useId();
  const [tab, setTab] = useState<TabId>("start");

  const openSettings = () => {
    closeOverlay();
    emitLocal("overlay:open", { kind: "settings" });
  };
  const openToolsLogs = () => {
    closeOverlay();
    emitLocal("overlay:open", { kind: "tools-logs" });
  };

  return (
    <div
      className="v4-overlay-sheet v4-settings-dialog flex h-[min(760px,88vh)] w-[min(920px,calc(100vw-2rem))] max-w-full overflow-hidden"
      data-help-panel
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <nav
        className="v4-sidebar-scroll v4-settings-nav m-2.5 mr-0 flex w-[160px] shrink-0 flex-col gap-0.5 self-stretch overflow-y-auto rounded-[var(--radius-lg)] border border-border-subtle-dim p-1.5"
        aria-label={t("help.title")}
      >
        <div className="mb-2 flex items-center gap-1.5 px-1.5 py-1">
          <RiSparklingLine size={ICON.xs} className="shrink-0 text-accent-color" aria-hidden />
          <span className="truncate text-3xs font-semibold text-text-primary">{t("help.title")}</span>
        </div>
        {TABS.map(({ id, icon: Icon, fallbackLabel }) => {
          const raw = t(`help.tabs.${id}`);
          const label =
            typeof raw === "string" && raw && !raw.includes("help.tabs.") ? raw : fallbackLabel;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-left text-3xs transition-colors v4-focus-ring",
                tab === id
                  ? "bg-surface-elevated font-semibold text-text-primary shadow-[var(--shadow-card)] ring-1 ring-border-subtle-dim"
                  : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
              )}
            >
              <Icon size={ICON.xs} className="shrink-0 opacity-70" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border-subtle-dim bg-surface-elevated">
        <header
          className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle-dim bg-[var(--color-dialog-header)] px-5 py-3"
          data-help-header
        >
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold tracking-tight text-text-primary">
              {t("help.title")}
            </h2>
            <p className="mt-0.5 truncate text-3xs text-text-quaternary">
              {t(`help.tabBlurb.${tab}`)}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 p-0"
            onClick={() => closeOverlay()}
            aria-label={t("help.close")}
          >
            <RiCloseLine size={ICON.xs} />
          </Button>
        </header>

        <div className="v4-content-scroll min-h-0 flex-1 overflow-auto overscroll-contain bg-background/30">
          <div className="mx-auto w-full max-w-[40rem] px-5 py-5 sm:px-6">
            {tab === "start" && (
              <StartTab onSettings={openSettings} onTools={openToolsLogs} />
            )}
            {tab === "features" && (
              <FeaturesTab onSettings={openSettings} onTools={openToolsLogs} />
            )}
            {tab === "workflow" && (
              <WorkflowTab onSettings={openSettings} onTools={openToolsLogs} />
            )}
            {tab === "philosophy" && <PhilosophyTab />}
            {tab === "faq" && (
              <FaqTab onSettings={openSettings} onTools={openToolsLogs} />
            )}
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border-subtle-dim bg-[var(--color-dialog-header)] px-5 py-2.5">
          <p className="min-w-0 flex-1 truncate text-3xs text-text-quaternary">{t("help.footerHint")}</p>
          <Button size="sm" variant="ghost" onClick={openSettings}>
            <RiSettingsLine size={ICON.micro} className="mr-1" aria-hidden />
            {t("help.openSettings")}
          </Button>
          <Button size="sm" variant="ghost" onClick={openToolsLogs}>
            <RiStethoscopeLine size={ICON.micro} className="mr-1" aria-hidden />
            {t("help.openTools")}
          </Button>
        </footer>
      </div>
    </div>
  );
}

/* ── Start: modern hero + steps ─────────────────────────────────────────── */

function StartTab({
  onSettings,
  onTools,
}: {
  onSettings: () => void;
  onTools: () => void;
}) {
  const { t } = useTranslation("shell");
  const steps = asList<{ title: string; body: string }>(
    t("help.start.steps", { returnObjects: true }),
  );
  const shortcuts = asList<{ keys: string; label: string }>(
    t("help.start.shortcuts", { returnObjects: true }),
  );

  return (
    <div className="space-y-6">
      {/* Hero — soft brand wash, not marketing chrome */}
      <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-surface-muted/50 px-5 py-6 sm:px-6 sm:py-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent-muted blur-2xl"
        />
        <div className="relative">
          <p className="text-3xs font-medium uppercase tracking-[0.12em] text-accent-color">
            {t("help.start.heroKicker")}
          </p>
          <h3 className="mt-1.5 text-xl font-semibold tracking-tight text-text-primary">
            {t("help.start.heroTitle")}
          </h3>
          <p className="mt-2 max-w-[36rem] text-3xs leading-relaxed text-text-secondary">
            {t("help.start.heroDesc")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={onSettings}>
              <RiSettingsLine size={ICON.micro} className="mr-1" aria-hidden />
              {t("help.openSettings")}
            </Button>
            <Button size="sm" variant="outline" onClick={onTools}>
              <RiStethoscopeLine size={ICON.micro} className="mr-1" aria-hidden />
              {t("help.openTools")}
            </Button>
          </div>
        </div>
      </section>

      {/* Steps — numbered timeline */}
      <section>
        <h4 className="mb-2.5 text-3xs font-medium tracking-wide text-text-quaternary">
          {t("help.start.stepsTitle")}
        </h4>
        <ol className="relative space-y-0 border-l border-border-subtle-dim pl-4">
          {steps.map((s, i) => (
            <li key={s.title} className="relative pb-4 last:pb-0">
              <span
                aria-hidden
                className="absolute -left-[1.4rem] top-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-border-subtle bg-surface-elevated text-[10px] font-bold tabular-nums text-accent-color"
              >
                {i + 1}
              </span>
              <div className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface px-3.5 py-2.5">
                <div className="text-sm font-medium text-text-primary">{s.title}</div>
                <p className="mt-1 text-3xs leading-relaxed text-text-secondary">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Shortcuts */}
      <section>
        <h4 className="mb-2 text-3xs font-medium tracking-wide text-text-quaternary">
          {t("help.start.shortcutsTitle")}
        </h4>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {shortcuts.map((s) => (
            <div
              key={s.keys}
              className="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-border-subtle bg-surface px-2.5 py-2"
            >
              <kbd className="v4-kbd v4-kbd-sm shrink-0">{formatChord(s.keys)}</kbd>
              <span className="truncate text-3xs text-text-secondary">{s.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ── Features ───────────────────────────────────────────────────────────── */

function FeaturesTab({
  onSettings,
  onTools,
}: {
  onSettings: () => void;
  onTools: () => void;
}) {
  const { t } = useTranslation("shell");
  const items = asList<{ title: string; body: string }>(
    t("help.features.items", { returnObjects: true }),
  );
  return (
    <div className="space-y-5">
      <PageIntro title={t("help.features.heroTitle")} desc={t("help.features.heroDesc")} />
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((f) => (
          <article
            key={f.title}
            className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface p-3.5"
          >
            <h3 className="text-sm font-medium text-text-primary">{f.title}</h3>
            <p className="mt-1 text-3xs leading-relaxed text-text-secondary">{f.body}</p>
          </article>
        ))}
      </div>
      <InlineActions onSettings={onSettings} onTools={onTools} />
    </div>
  );
}

/* ── Workflow ───────────────────────────────────────────────────────────── */

function WorkflowTab({
  onSettings,
  onTools,
}: {
  onSettings: () => void;
  onTools: () => void;
}) {
  const { t } = useTranslation("shell");
  const stages = asList<{ title: string; body: string }>(
    t("help.workflow.stages", { returnObjects: true }),
  );
  const dirs = asList<string>(t("help.workflow.dirs", { returnObjects: true }));
  return (
    <div className="space-y-5">
      <PageIntro title={t("help.workflow.heroTitle")} desc={t("help.workflow.heroDesc")} />
      <ol className="space-y-2">
        {stages.map((s, i) => (
          <li
            key={s.title}
            className="flex gap-3 rounded-[var(--radius-lg)] border border-border-subtle bg-surface p-3.5"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-bg-subtle text-3xs font-bold tabular-nums text-accent-color">
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-primary">{s.title}</div>
              <p className="mt-0.5 text-3xs leading-relaxed text-text-secondary">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <section className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface p-4">
        <h3 className="text-sm font-medium text-text-primary">{t("help.workflow.dirsTitle")}</h3>
        <ul className="mt-2 space-y-1 text-3xs text-text-secondary">
          {dirs.map((d) => (
            <li key={d} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-color" aria-hidden />
              <span className="min-w-0">{d}</span>
            </li>
          ))}
        </ul>
      </section>
      <InlineActions onSettings={onSettings} onTools={onTools} />
    </div>
  );
}

/* ── Philosophy ─────────────────────────────────────────────────────────── */

function PhilosophyTab() {
  const { t } = useTranslation("shell");
  const points = asList<{ title: string; body: string }>(
    t("help.philosophy.points", { returnObjects: true }),
  );
  return (
    <div className="space-y-5">
      <PageIntro title={t("help.philosophy.heroTitle")} desc={t("help.philosophy.heroDesc")} />
      <div className="space-y-2">
        {points.map((p) => (
          <div key={p.title} className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface p-3.5">
            <h3 className="text-sm font-medium text-text-primary">{p.title}</h3>
            <p className="mt-1 text-3xs leading-relaxed text-text-secondary">{p.body}</p>
          </div>
        ))}
      </div>
      <p className="rounded-[var(--radius-lg)] bg-surface-muted/50 px-3.5 py-3 text-3xs leading-relaxed text-text-tertiary">
        {t("help.philosophy.closing")}
      </p>
    </div>
  );
}

/* ── FAQ ────────────────────────────────────────────────────────────────── */

function FaqTab({
  onSettings,
  onTools,
}: {
  onSettings: () => void;
  onTools: () => void;
}) {
  const { t } = useTranslation("shell");
  const items = asList<{ q: string; a: string }>(
    t("help.faq.items", { returnObjects: true }),
  );
  return (
    <div className="space-y-5">
      <PageIntro title={t("help.faq.heroTitle")} desc={t("help.faq.heroDesc")} />
      <div className="space-y-1.5">
        {items.map((item) => (
          <details
            key={item.q}
            className="group rounded-[var(--radius-lg)] border border-border-subtle bg-surface open:bg-surface-muted/40"
          >
            <summary className="flex cursor-pointer list-none items-start gap-2 px-3.5 py-3 text-sm font-medium text-text-primary marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="mt-0.5 shrink-0 text-3xs font-bold text-accent-color" aria-hidden>
                Q
              </span>
              <span className="min-w-0 flex-1">{item.q}</span>
            </summary>
            <p className="border-t border-border-subtle-dim px-3.5 pb-3 pl-8 pt-2.5 text-3xs leading-relaxed text-text-secondary">
              {item.a}
            </p>
          </details>
        ))}
      </div>
      <InlineActions onSettings={onSettings} onTools={onTools} />
    </div>
  );
}

/* ── Shared bits ────────────────────────────────────────────────────────── */

function PageIntro({ title, desc }: { title: string; desc: string }) {
  return (
    <header>
      <h3 className="text-base font-semibold tracking-tight text-text-primary">{title}</h3>
      <p className="mt-1 text-3xs leading-relaxed text-text-secondary">{desc}</p>
    </header>
  );
}

function InlineActions({
  onSettings,
  onTools,
}: {
  onSettings: () => void;
  onTools: () => void;
}) {
  const { t } = useTranslation("shell");
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <Button size="sm" variant="outline" onClick={onSettings}>
        <RiSettingsLine size={ICON.micro} className="mr-1" aria-hidden />
        {t("help.openSettings")}
      </Button>
      <Button size="sm" variant="outline" onClick={onTools}>
        <RiStethoscopeLine size={ICON.micro} className="mr-1" aria-hidden />
        {t("help.openTools")}
      </Button>
    </div>
  );
}
