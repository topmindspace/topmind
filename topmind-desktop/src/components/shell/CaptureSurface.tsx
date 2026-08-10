/**
 * Standalone capture surface for floating quick-note window (?surface=capture / #surface=capture).
 * Minimal chrome — no full Shell. Must always paint a solid, readable UI (never blank).
 */
import { useEffect, useState, type CSSProperties } from "react";
import { AlertCircle, Loader2, FolderOpen, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { QuickCapture } from "../overlays/QuickCapture";
import { IngestStagingSheet } from "../overlays/IngestStagingSheet";
import { api } from "../../services/api";
import { applyTheme } from "../../lib/theme";
import { applyLocale } from "../../locales";
import { useViewStore } from "../../stores/view-store";
import { Button } from "../ui/Button";
import { TooltipProvider } from "../ui/tooltip";
import { ICON } from "../../lib/icons";
import type { AppSettings } from "../../types";
import { setCachedSettings } from "../../lib/settings-cache";

type Boot = "loading" | "ready" | "no-ws" | "error";

export function CaptureSurface() {
  const { t } = useTranslation("shell");
  const [boot, setBoot] = useState<Boot>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Immediate theme so first paint isn't unstyled/invisible (Design System 2.0 canvas)
    document.documentElement.style.background = "var(--color-background)";
    document.body.style.background = "var(--color-background)";
    document.body.style.margin = "0";
    document.body.style.minHeight = "100vh";

    let cancelled = false;
    void (async () => {
      try {
        const settings = (await api.sys.settings()) as AppSettings;
        if (cancelled) return;
        setCachedSettings(settings);
        applyLocale(settings.ui?.locale || "auto");
        useViewStore.getState().setTheme(settings.theme || "auto");
        applyTheme(settings.theme || "auto");

        // Prefer live launchStatus; fall back to workspaceRoot string
        const launch = settings.launchStatus;
        const root = String(settings.workspaceRoot || "").trim();
        const liveOk = launch?.ok === true;
        const hasRoot = Boolean(root);

        if (liveOk || hasRoot) {
          setBoot("ready");
          return;
        }
        if (launch && launch.ok === false) {
          setBoot("no-ws");
          setMessage(
            launch.errorMessage ||
              launch.reason ||
              t("captureSurface.pleaseOpenWorkspaceHint"),
          );
          return;
        }
        setBoot("no-ws");
        setMessage(t("captureSurface.pleaseOpenWorkspace"));
      } catch (e) {
        if (cancelled) return;
        // Still show capture UI if possible — save will surface errors
        setBoot("ready");
        setMessage(e instanceof Error ? e.message : String(e));
        // Soft: ready with warning toast via message banner only when truly broken
        if (String(e).includes("preload") || String(e).includes("bridge")) {
          setBoot("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Always solid shell so macOS never shows empty transparent glass
  const shellClass =
    "flex min-h-screen flex-col bg-background text-text-primary";
  const shellStyle: CSSProperties = {
    minHeight: "100vh",
  };

  // Float window is outside Shell — must provide TooltipProvider (same as OnboardingScreen).
  return (
    <TooltipProvider>
      {boot === "loading" ? (
        <div className={shellClass} style={shellStyle}>
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-bg-subtle text-accent-color">
              <Zap size={ICON.md} />
            </div>
            <Loader2 size={ICON.sm} className="animate-spin text-text-quaternary" />
            <div className="text-3xs text-text-tertiary">{t("captureSurface.preparing")}</div>
          </div>
        </div>
      ) : boot === "error" ? (
        <div className={shellClass} style={shellStyle}>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
            <AlertCircle size={ICON.lg} className="text-error" />
            <div className="text-center text-xs font-medium">{t("captureSurface.launchFailed")}</div>
            <div className="max-w-sm text-center text-3xs text-text-tertiary">{message}</div>
            <Button size="sm" variant="outline" onClick={() => void api.sys.closeQuickCapture()}>
              {t("captureSurface.close")}
            </Button>
          </div>
        </div>
      ) : boot === "no-ws" ? (
        <div className={shellClass} style={shellStyle}>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
            <AlertCircle size={ICON.lg} className="text-warning" />
            <div className="text-center text-xs font-medium text-text-primary">{t("captureSurface.needWorkspace")}</div>
            <div className="max-w-sm text-center text-3xs leading-relaxed text-text-secondary">
              {message}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  void api.sys.openCaptureSurface({ mode: "overlay" }).catch(() => {});
                  void api.sys.closeQuickCapture();
                }}
              >
                <FolderOpen size={ICON.sm} /> {t("captureSurface.openMainWindow")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void api.sys.closeQuickCapture()}>
                {t("captureSurface.close")}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className={shellClass} style={shellStyle}>
          {message ? (
            <div className="border-b border-border-subtle-dim bg-status-warning-bg/50 px-3 py-1.5 text-center text-3xs text-warning">
              {message}
            </div>
          ) : null}
          <QuickCapture variant="float" />
          {/* Same window as float capture — zustand staging is per-renderer */}
          <IngestStagingSheet />
        </div>
      )}
    </TooltipProvider>
  );
}
