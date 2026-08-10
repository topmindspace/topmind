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
      title={t("statusBar.inlineAiLeaveTitle", { defaultValue: "离开将取消 AI 工作" })}
      description={
        busyLabel
          ? t("statusBar.inlineAiLeaveConfirmWithLabel", {
              label: busyLabel,
              defaultValue: `「${busyLabel}」仍在进行或有未应用结果。强制离开将取消本次 AI 工作。`,
            })
          : t("statusBar.inlineAiLeaveConfirm", {
              defaultValue:
                "AI 仍在处理或有未应用的结果。强制离开将取消本次 AI 工作，是否继续？",
            })
      }
      confirmText={t("statusBar.inlineAiLeaveForce", { defaultValue: "强制离开" })}
      cancelText={t("statusBar.inlineAiLeaveStay", { defaultValue: "继续等待" })}
      destructive
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
