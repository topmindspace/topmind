/**
 * ThemeMenuButton — ActivityBar chrome control (replaces the old click-to-cycle).
 *
 * Opens a right-side dropdown (same placement family as AppsMenuButton) with
 * three horizontal chip rows: mode · surface tone · accent seed. One click to
 * any target — no cycling through three states to reach the one you want.
 *
 * Axes are independent (see lib/theme.ts):
 *   mode  · Theme      → light / dark / auto
 *   tone  · ThemeTone  → warm / cool / neutral / slate  (surface ladder)
 *   seed  · ThemeSeed  → sky / teal / graphite  (accent axis)
 */
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  RiComputerLine,
  RiMoonLine,
  RiPaletteLine,
  RiSunLine,
} from "@remixicon/react";
import type { RemixiconComponentType } from "@remixicon/react";
import { useViewStore } from "../../stores/view-store";
import {
  setThemePreference,
  setThemeSeedPreference,
  setThemeTonePreference,
} from "../../lib/appearance";
import { getCachedSettings } from "../../lib/settings-cache";
import {
  THEME_SEEDS,
  THEME_TONES,
  type Theme,
  type ThemeSeed,
  type ThemeTone,
} from "../../lib/theme";
import { cn } from "../../lib/kit";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../ui/tooltip";
import { DropdownMenu, DropdownSectionLabel } from "../ui/DropdownMenu";

const MODE_ORDER: Theme[] = ["auto", "light", "dark"];

/** Mini surface swatches — pure CSS, no token pollution (preview only). */
const TONE_SWATCH: Record<ThemeTone, { light: string; dark: string; ink: string }> = {
  warm: { light: "#f3f1eb", dark: "#1c1a17", ink: "#242220" },
  cool: { light: "#f2f5f8", dark: "#1a2028", ink: "#1c2430" },
  neutral: { light: "#f4f4f4", dark: "#1a1a1a", ink: "#1f1f1f" },
  slate: { light: "#eaeef3", dark: "#161c24", ink: "#15202b" },
};

/** Accent dots for seeds — matches the live accent stops. */
const SEED_DOT: Record<ThemeSeed, { light: string; dark: string }> = {
  sky: { light: "#0369a1", dark: "#38bdf8" },
  teal: { light: "#0f766e", dark: "#5eead4" },
  graphite: { light: "#3f3f46", dark: "#d4d4d8" },
};

function modeIcon(theme: Theme): RemixiconComponentType {
  if (theme === "light") return RiSunLine;
  if (theme === "dark") return RiMoonLine;
  return RiComputerLine;
}

function Chip({
  active,
  onSelect,
  label,
  title,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  label: string;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      title={title || label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect();
      }}
      className={cn(
        "v4-menu-item flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1.5 text-3xs font-medium outline-none",
        "transition-colors v4-focus-ring",
        active
          ? "bg-accent-container text-on-accent-container"
          : "text-text-secondary hover:bg-state-hover hover:text-text-primary",
      )}
    >
      {children}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

export function ThemeMenuButton() {
  const { t } = useTranslation("shell");
  const theme = useViewStore((s) => s.theme);
  const [open, setOpen] = useState(false);
  const settings = getCachedSettings();
  const tone: ThemeTone = (settings?.themeTone as ThemeTone) || "warm";
  const seed: ThemeSeed = (settings?.themeSeed as ThemeSeed) || "sky";
  const isDark =
    theme === "dark" ||
    (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="start"
      minWidth={300}
      maxWidth={360}
      maxHeight={420}
      matchTriggerWidth={false}
      preferPlacement="right"
      /* Clear the status bar; bottom-docked chrome buttons grow the panel upward. */
      padBottom={32}
      panelClassName="v4-no-drag"
      trigger={
        <Tooltip content={t("activityBar.theme")} side="right">
          <button
            type="button"
            className={cn(
              "v4-no-drag flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] transition-colors v4-focus-ring",
              open
                ? "bg-accent-container text-on-accent-container"
                : "text-text-tertiary hover:bg-state-hover hover:text-text-primary",
            )}
            aria-label={t("activityBar.theme")}
            aria-haspopup="menu"
            aria-expanded={open}
            data-activity="theme"
            onClick={() => setOpen((v) => !v)}
          >
            <RiPaletteLine size={ICON.md} />
          </button>
        </Tooltip>
      }
    >
      <div className="px-2 pb-1 pt-1.5">
        <DropdownSectionLabel>{t("themeMenu.mode")}</DropdownSectionLabel>
        <div className="flex items-center gap-1" role="listbox" aria-label={t("themeMenu.mode")}>
          {MODE_ORDER.map((m) => {
            const Icon = modeIcon(m);
            return (
              <Chip
                key={m}
                active={theme === m}
                label={t(`themeMenu.mode-${m}` as never)}
                onSelect={() => {
                  setThemePreference(m);
                  setOpen(false);
                }}
              >
                <Icon size={ICON.xs} className="shrink-0" />
              </Chip>
            );
          })}
        </div>
      </div>

      <div className="px-2 pb-1 pt-1">
        <DropdownSectionLabel>{t("themeMenu.tone")}</DropdownSectionLabel>
        <div className="flex items-center gap-1" role="listbox" aria-label={t("themeMenu.tone")}>
          {THEME_TONES.map((id) => {
            const sw = TONE_SWATCH[id];
            return (
              <Chip
                key={id}
                active={tone === id}
                label={t(`themeMenu.tone-${id}` as never)}
                onSelect={() => {
                  setThemeTonePreference(id);
                  setOpen(false);
                }}
              >
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-border-subtle"
                  style={{
                    background: isDark ? sw.dark : sw.light,
                    boxShadow: `inset 0 0 0 1px ${sw.ink}22`,
                  }}
                />
              </Chip>
            );
          })}
        </div>
      </div>

      <div className="px-2 pb-2 pt-1">
        <DropdownSectionLabel>{t("themeMenu.seed")}</DropdownSectionLabel>
        <div className="flex items-center gap-1" role="listbox" aria-label={t("themeMenu.seed")}>
          {THEME_SEEDS.map((id) => {
            const dot = SEED_DOT[id];
            return (
              <Chip
                key={id}
                active={seed === id}
                label={t(`themeMenu.seed-${id}` as never)}
                onSelect={() => {
                  setThemeSeedPreference(id);
                  setOpen(false);
                }}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: isDark ? dot.dark : dot.light }}
                />
              </Chip>
            );
          })}
        </div>
      </div>
    </DropdownMenu>
  );
}
