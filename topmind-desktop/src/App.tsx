import { useEffect, useState, lazy, Suspense } from "react";
import { RiErrorWarningLine, RiLoader4Line, RiRefreshLine } from "@remixicon/react";
import { api } from "./services/api";
import { applyTheme } from "./lib/theme";
import { useViewStore } from "./stores/view-store";
import { Button } from "./components/ui/Button";
import { ICON } from "./lib/icons";
import type { AppSettings, LaunchStatus, RecentWorkspace } from "./types";
import { setCachedSettings } from "./lib/settings-cache";
import { applyLocale } from "./locales";
import { useTranslation } from "react-i18next";

const Shell = lazy(() =>
  import("./components/shell/Shell").then((m) => ({ default: m.Shell })),
);
const CaptureSurface = lazy(() =>
  import("./components/shell/CaptureSurface").then((m) => ({ default: m.CaptureSurface })),
);
const OnboardingScreen = lazy(() =>
  import("./components/shell/OnboardingScreen").then((m) => ({ default: m.OnboardingScreen })),
);

type Boot =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "onboarding"; settings: AppSettings; recent: RecentWorkspace[] }
  | { state: "ready"; settings: AppSettings };

/** Detect float capture window (query and/or hash — loadFile uses both). */
export function isCaptureSurfaceBoot(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("surface") === "capture") {
      return true;
    }
    const hash = String(window.location.hash || "").replace(/^#/u, "");
    if (hash === "surface=capture" || hash.includes("surface=capture")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export default function App() {
  // Floating quick-note window — skip full shell boot (must paint CaptureSurface, never blank shell)
  if (isCaptureSurfaceBoot()) {
    return (
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-background">
            <RiLoader4Line size={ICON.md} className="animate-spin text-accent-color" />
          </div>
        }
      >
        <CaptureSurface />
      </Suspense>
    );
  }

  return <MainApp />;
}

function MainApp() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });
  const { t } = useTranslation(["common", "shell"]);

  const loadBootSettings = async () => {
    try {
      const settings = await api.sys.settings();
      setCachedSettings(settings);
      // Apply locale from settings (auto → detect from OS)
      applyLocale(settings.ui?.locale || "auto");
      const launch: LaunchStatus | undefined = settings.launchStatus;
      // Landing / onboarding when:
      //   - no recent workspace (reason: no-workspace)
      //   - user closed workspace (reason: closed)
      //   - last open failed (reason: invalid-workspace / invalid-engine)
      // Never auto-create a workspace just to fill the shell.
      if (launch && launch.ok === false) {
        setBoot({
          state: "onboarding",
          settings,
          recent: settings.workspaces?.recent ?? [],
        });
        return;
      }
      useViewStore.getState().setTheme(settings.theme);
      setBoot({ state: "ready", settings });
    } catch (err) {
      setBoot({ state: "error", message: err instanceof Error ? err.message : t("common:status.error") });
    }
  };

  useEffect(() => {
    void loadBootSettings();
  }, []);

  const theme = useViewStore((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("auto");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  if (boot.state === "loading") {
    return (
      <div className="v4-boot v4-drag flex h-screen flex-col items-center justify-center gap-3">
        <div className="v4-brand-mark flex h-14 w-14 items-center justify-center overflow-hidden rounded-[var(--radius-2xl)] bg-surface-elevated shadow-[var(--shadow-md)] ring-1 ring-border-subtle-dim">
          <img
            src="./favicon.svg"
            alt=""
            width={56}
            height={56}
            className="h-full w-full object-cover"
            draggable={false}
            onError={(e) => {
              const el = e.currentTarget;
              if (el.dataset.fb === "1") {
                el.style.display = "none";
                return;
              }
              el.dataset.fb = "1";
              el.src = "./icon-256.png";
            }}
          />
        </div>
        <RiLoader4Line size={ICON.sm} className="animate-spin text-accent-color" />
        <div className="text-sm font-medium text-text-primary">{t("shell:shell.loadingWorkspace")} topmind…</div>
        <div className="text-3xs text-text-quaternary">{t("common:status.loading")}</div>
      </div>
    );
  }

  if (boot.state === "error") {
    return (
      <div className="v4-boot v4-drag flex h-screen flex-col items-center justify-center gap-3 px-6">
        <div className="v4-icon-chip flex h-12 w-12 items-center justify-center rounded-2xl text-error">
          <RiErrorWarningLine size={ICON.lg} />
        </div>
        <div className="text-sm font-medium text-text-primary">{t("common:status.error")}</div>
        <div className="max-w-sm text-center text-3xs text-text-tertiary">{boot.message}</div>
        <Button
          variant="outline"
          size="sm"
          className="v4-no-drag mt-2"
          onClick={() => {
            setBoot({ state: "loading" });
            void loadBootSettings();
          }}
        >
          <RiRefreshLine size={ICON.xs} /> {t("common:action.retry")}
        </Button>
      </div>
    );
  }

  if (boot.state === "onboarding") {
    const launch = boot.settings.launchStatus;
    return (
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-background">
            <RiLoader4Line size={ICON.md} className="animate-spin text-accent-color" />
          </div>
        }
      >
        <OnboardingScreen
          settings={boot.settings}
          recent={boot.recent}
          launchReason={launch?.reason}
          launchError={launch?.errorMessage}
          onWorkspaceSwitched={() => {
            setBoot({ state: "loading" });
            // Full reload ensures main process ctx + plugins rehydrate cleanly
            window.location.reload();
          }}
        />
      </Suspense>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <RiLoader4Line size={ICON.md} className="animate-spin text-accent-color" />
        </div>
      }
    >
      <Shell settings={boot.settings} />
    </Suspense>
  );
}
