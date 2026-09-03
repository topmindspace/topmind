import { Suspense, type ReactNode } from "react";
import { RiLoader4Line } from "@remixicon/react";
import { useTranslation } from "react-i18next";
import { ICON } from "../../lib/icons";
import { cn } from "../../lib/cn";

/** Shared Suspense boundary for route-level / overlay code-splitting. */
export function LazyBoundary({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const { t } = useTranslation("shell");
  return (
    <Suspense
      fallback={
        <div
          className={cn(
            "flex min-h-[8rem] flex-1 flex-col items-center justify-center gap-2.5 text-text-quaternary",
            className,
          )}
          role="status"
          aria-live="polite"
        >
          <RiLoader4Line size={ICON.sm} className="animate-spin text-accent-color/70" />
          <div className="text-3xs font-medium tracking-tight">{label || t("lazyBoundary.loading")}</div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
