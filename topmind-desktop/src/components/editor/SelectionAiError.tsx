/**
 * Selection AI error state — friendly message + settings shortcut + dismiss.
 * Pure presentation; error text is produced by useSelectionAi.
 */
import { useTranslation } from "react-i18next";
import { useViewStore } from "../../stores/view-store";

export function SelectionAiError({
  error,
  onClose,
}: {
  error: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("editor");
  const openOverlay = useViewStore((s) => s.openOverlay);

  return (
    <div className="rounded-[var(--radius-md)] border border-error/20 bg-status-error-bg px-2 py-1.5 text-3xs text-error" role="alert">
      {error}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          className="underline"
          onClick={() => openOverlay("settings", { topicId: "ai" })}
        >
          {t("selectionAi.openSettings")}
        </button>
        <button
          type="button"
          className="underline opacity-80"
          onClick={onClose}
        >
          {t("selectionAi.closeError")}
        </button>
      </div>
    </div>
  );
}
