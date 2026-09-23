/**
 * Global ConfirmDialog for inline AI leave protection.
 * Holds navigation until user confirms (never navigate-then-block).
 */
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../ui/Dialog";
import { useInlineAiStore } from "../../lib/inline-ai-busy";
import { useViewStore } from "../../stores/view-store";

export function InlineAiLeaveHost() {
  const { t } = useTranslation("shell");
  const pendingNav = useInlineAiStore((s) => s.pendingNav);
  const busyLabel = useInlineAiStore((s) => {
    const last = s.sessions[s.sessions.length - 1];
    return last?.label ?? null;
  });

  const open = pendingNav != null;

  const handleCancel = () => {
    useInlineAiStore.getState().clearPendingNav();
  };

  const handleConfirm = () => {
    const pending = useInlineAiStore.getState().pendingNav;
    // Discard AI work first so unmount handlers see cleared sessions
    useInlineAiStore.getState().clearAll();
    useInlineAiStore.getState().clearPendingNav();
    if (!pending) return;
    const vs = useViewStore.getState();
    if (pending.kind === "select" && pending.next) {
      vs.applySelectForced(pending.next);
    } else if (pending.kind === "back") {
      vs.applyHistoryForced("back");
    } else if (pending.kind === "forward") {
      vs.applyHistoryForced("forward");
    }
  };

  return (
    <ConfirmDialog
      open={open}
      title={t("statusBar.inlineAiLeaveTitle")}
      description={
        busyLabel
          ? t("statusBar.inlineAiLeaveConfirmWithLabel", { label: busyLabel })
          : t("statusBar.inlineAiLeaveConfirm")
      }
      confirmText={t("statusBar.inlineAiLeaveForce")}
      cancelText={t("statusBar.inlineAiLeaveStay")}
      destructive
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
